# Agent Web Demo 구조 및 검증

## 1. 목적

AGENT-21에서는 API와 테스트 코드로만 확인하던 Agent Backend를
브라우저에서 직접 조작할 수 있는 최소 Web Demo로 연결한다.

```text
Browser
→ React Web
→ NestJS Agent API
→ LangGraph
→ Tool Registry
→ PostgreSQL
```

화면을 크게 확장하는 것이 아니라 Backend의 핵심 차별점인
다단계 Tool Calling, 실행 Trace와 사용자 승인을 눈으로 확인하는 것이 목적이다.

## 2. 구현 범위

Web은 다음 상태를 한 화면에서 처리한다.

| 상태 | 화면 동작 |
|---|---|
| 요청 전 | 예시 요청, 직접 입력과 Write 실행 정책 선택 |
| 실행 중 | 입력과 중복 제출을 잠그고 진행 상태 표시 |
| 완료 | Markdown 최종 답변, 실행 ID와 전체 Trace 표시 |
| 승인 대기 | Write Tool 이름과 arguments, 승인·거절 버튼 표시 |
| 거절 | 거절 결과와 `approval:rejected` Trace 표시 |
| 오류 | API가 반환한 오류 또는 연결 실패 메시지 표시 |

API Client는 Backend의 `AgentRunResponse` 판별형 계약을 Web TypeScript 타입으로
표현한다. `status`가 `completed`, `awaiting_approval`, `rejected` 중 무엇인지에 따라
답변과 승인 UI를 분기한다.

## 3. API 연결

개발 환경의 기본 `VITE_API_BASE_URL`은 `/api`다.
Vite 개발 서버가 아래와 같이 Proxy한다.

```text
http://localhost:5173/api/agent/runs
→ http://localhost:3000/agent/runs
```

따라서 로컬 Web은 같은 Origin처럼 API를 호출할 수 있다.
별도 Origin으로 배포할 때는 Web의 `VITE_API_BASE_URL`과 API의 `CORS_ORIGIN`을
실제 주소에 맞춰 설정해야 한다.

## 4. 사용자 승인 흐름

```text
Web 요청
→ POST /agent/runs
→ status: awaiting_approval
→ Tool arguments 표시
→ 사용자가 승인 또는 거절
→ POST /agent/runs/{executionId}/approval
→ 완료 또는 거절 응답 표시
```

승인 전에는 Web이 Write Tool을 직접 실행하지 않는다.
Web은 사용자의 결정을 API에 전달하고, 보류된 LangGraph 실행을 재개하는 책임은
Backend가 계속 담당한다.

## 5. 실행 방법

API 환경변수와 PostgreSQL을 준비한다.

```powershell
Copy-Item apps/api/.env.example apps/api/.env
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

첫 번째 PowerShell에서 API를 실행한다.

```powershell
pnpm api:start:dev
```

두 번째 PowerShell에서 Web을 실행한다.

```powershell
pnpm web:dev
```

브라우저에서 `http://localhost:5173`을 연다.

## 6. 2026-08-24 검증 결과

### 정적 검증

| 검사 | 결과 |
|---|---:|
| Web ESLint | 통과 |
| TypeScript + Vite Build | 통과 |
| Vitest | 1 File, 3 Tests 통과 |
| Backend 단위 테스트 | 8 Suites, 52 Tests 통과 |
| API E2E | 2 Suites, 7 Tests 통과 |
| PostgreSQL 통합/E2E | 4 Suites, 17 Tests 통과 |

### 실제 Full-stack 브라우저 검증

- 고객·상담 조회에서 실제 OpenAI가 `get_customer(name="김민수")`를 호출했다.
- 첫 Tool 결과의 `C001`을 `get_consultations(customer_id="C001")`에 사용했다.
- PostgreSQL의 `CONS001` 상담 내용이 최종 Markdown 답변에 표시됐다.
- 실제 Write 요청이 `awaiting_approval`로 멈추고 arguments가 화면에 표시됐다.
- 거절 후 `approval:rejected`가 표시되고 DB 업무는 0건을 유지했다.
- 승인 후 `C001 / CONS001 / pending` 업무 1건이 생성되고 완료 답변이 표시됐다.
- 승인 검증용 업무는 정확한 UUID로 정리한 뒤 잔여 0건을 확인했다.
- 1280px Desktop과 390px Mobile 화면에서 레이아웃을 확인했다.
- 브라우저 Console Error는 0건이었다.

## 7. 검증 경계

- Web은 현재 실행 한 건만 표시하며 대화 이력을 저장하지 않는다.
- 응답은 동기 요청이며 Streaming을 지원하지 않는다.
- API 계약 타입을 Web에 별도로 선언하므로 계약 변경 시 함께 갱신해야 한다.
- 인증과 사용자별 승인 권한은 구현하지 않았다.
- 로컬 Full-stack까지 검증했으며 공개 URL 배포는 다음 작업 범위다.
- RAG는 Web Demo 완료 후 별도 Tool과 검색 품질 평가로 추가한다.

## 8. 코드 위치

- 화면 상태와 승인 흐름: `apps/web/src/App.tsx`
- Agent API Client와 응답 타입: `apps/web/src/api/agent.ts`
- Trace 표현: `apps/web/src/components/TraceTimeline.tsx`
- UI 단위 테스트: `apps/web/src/App.test.tsx`
- 개발 Proxy와 Vitest 설정: `apps/web/vite.config.ts`
