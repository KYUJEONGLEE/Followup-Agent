# 핵심 Agent 시나리오 E2E 검증

## 1. 목적

AGENT-20에서는 Agent MVP의 주요 기능을 개별 컴포넌트가 아니라
실제 사용자 요청 경계에서 검증한다.

```text
HTTP 요청
→ AgentController
→ AgentService
→ LangGraph Workflow
→ Tool Registry
→ PostgreSQL Repository
→ HTTP 응답
```

OpenAI 호출만 Scripted LLM으로 대체한다.
이를 통해 모델 응답의 비결정성과 외부 API 상태를 제거하면서
Controller부터 실제 PostgreSQL까지의 Backend 실행 흐름을 반복 가능하게 검증한다.

이 테스트가 실제 모델의 Tool 선택 품질을 증명하는 것은 아니다.
실제 OpenAI Responses API 선택 검증은 `pnpm agent:verify`로 분리한다.

## 2. 검증 시나리오

| 구분 | 사용자 요청 | 기대 Tool 흐름 | DB 결과 |
|---|---|---|---|
| Tool 미사용 | `안녕하세요.` | `llm` | 변경 없음 |
| 다단계 Read | 김민수 기본 정보와 상담 이력 조회 | `get_customer → get_consultations` | 변경 없음 |
| 승인 Write | 조회·상담 확인 후 후속 업무 생성 | Read 2개 → 승인 대기 → `create_follow_up_task` | 승인 전 0건, 승인 후 1건 |
| 승인 거절 | 후속 업무 제안 후 승인 대기 | 승인 요청 → 거절 | 0건 |
| 미존재 고객 | C999 후속 업무 생성 | 승인 → Write Tool `not_found` | 0건 |
| 중복 승인 | 동일 실행 ID를 두 번 승인 | 첫 승인만 실제 실행 | 계속 1건 |

## 3. 정상 조회 흐름

Scripted LLM은 첫 Tool 결과에 실제 Seed의 `C001`이 있을 때만
두 번째 Tool을 요청한다. 두 번째 Tool 결과에 `CONS001`이 있을 때만
최종 답변을 반환한다.

```text
llm
→ get_customer({ name: "김민수" })
→ llm
→ get_consultations({ customer_id: "C001" })
→ llm
```

따라서 Trace의 순서만 맞춘 것이 아니라,
첫 Tool의 실제 PostgreSQL 결과가 다음 Tool 입력에 전달되는 것도 함께 검증한다.

## 4. 승인 Write 흐름

```text
get_customer
→ get_consultations
→ create_follow_up_task Function Call
→ approval:requested
→ HTTP 응답: awaiting_approval
→ DB 확인: 0건
→ POST /agent/runs/{executionId}/approval
→ approval:approved
→ create_follow_up_task 실행
→ DB 확인: 1건
```

생성된 행은 다음 관계까지 확인한다.

- 고객: `C001`
- 원본 상담: `CONS001`
- 상태: `pending`
- 제목과 설명: 승인 화면에 표시된 Tool arguments와 일치

## 5. 안전성과 실패 경로

### 승인 거절

거절 응답의 Trace에는 `approval:rejected`가 기록되지만
`tool:create_follow_up_task`는 존재하지 않는다.
이는 실행 후 롤백이 아니라 Write Handler 자체를 호출하지 않았음을 의미한다.

### 미존재 고객

`C999`는 사용자가 승인해도 Repository의 활성 고객 검증을 통과하지 못한다.
Tool은 `not_found` 결과를 LLM에 전달하고 PostgreSQL에는 행을 생성하지 않는다.

### 중복 승인

같은 `executionId`에 `approve`를 다시 보내면 첫 완료 응답을 반환한다.
DB에는 Partial Unique Index와 실행 문맥 기반 멱등성 키로 한 행만 유지된다.

## 6. 실행 방법

Docker Desktop에서 PostgreSQL을 준비한다.

```powershell
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

새 PowerShell 세션이라면 통합 테스트용 연결값을 설정한다.

```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/followup_agent'
pnpm api:test:integration
```

전체 회귀 검증은 다음 순서로 실행한다.

```powershell
pnpm api:lint
pnpm api:build
pnpm api:test
pnpm api:test:e2e
pnpm api:test:integration
```

## 7. 2026-08-24 검증 결과

| 검사 | 결과 |
|---|---:|
| ESLint | 통과 |
| NestJS Build | 통과 |
| 단위 테스트 | 8 Suites, 52 Tests 통과 |
| 외부 의존성 대체 API E2E | 2 Suites, 7 Tests 통과 |
| PostgreSQL 통합/E2E | 4 Suites, 17 Tests 통과 |
| AGENT-20 시나리오 | 6 Tests 통과 |
| 테스트 종료 후 AGENT-20 임시 업무 | 0건 |

## 8. 검증 경계

- Scripted LLM을 사용하므로 실제 모델의 Tool 선택 정확도 평가는 아니다.
- 실제 PostgreSQL을 사용하지만 단일 로컬 인스턴스 기준이다.
- 승인 checkpoint는 `MemorySaver`이므로 서버 재시작 복구는 검증하지 않는다.
- 인증·사용자별 권한, retry, timeout과 장애 복구는 후속 범위다.

## 9. 코드 위치

- 핵심 E2E: `apps/api/test/agent-core-scenarios.integration-spec.ts`
- API 계약 E2E: `apps/api/test/agent.e2e-spec.ts`
- 승인 Workflow 통합 테스트: `apps/api/test/approval-workflow.integration-spec.ts`
- Write Tool 통합 테스트: `apps/api/test/write-tool.integration-spec.ts`
- Read Tool 통합 테스트: `apps/api/test/read-tools.integration-spec.ts`
