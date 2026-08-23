# FollowUp Agent

자연어 업무 요청을 기반으로 필요한 정보를 조회하고,
내부 정책을 참고해 판단을 보조하며,
사용자의 요청에 따라 후속 업무까지 실행하는 AI Agent 프로젝트입니다.

## 개발 상태

OpenAI Tool Calling과 LangGraph Workflow 기술 검증을 완료하고,
LangGraph를 MVP의 Agent Workflow Orchestration Layer로 채택했습니다.

현재는 NestJS 기반 Agent Backend MVP를 단계별로 구현하고 있습니다.
`experiments`는 기술 검증 코드이며, 실제 MVP Backend는 `apps/api`에 구성합니다.

NestJS 개발 환경과 Backend 실행 기반을 구성했으며,
Customer, Consultation, FollowUpTask 도메인과 PostgreSQL 스키마 설계를 완료했습니다.
설계한 스키마를 TypeORM Migration으로 적용하고 C001 테스트 데이터를 구성했습니다.
Agent 동기 API의 요청, 응답, 오류와 실행 Trace 계약을 정의했습니다.
Tool 정의, 입력 검증, Handler 실행을 연결하는 공통 Registry를 구현했습니다.
고객 정보와 상담 이력 Read Tool이 실제 PostgreSQL Seed 데이터를 조회합니다.
LangGraph Workflow와 Agent HTTP API를 연결해 실제 LLM이 Read Tool을 선택하고
그 결과를 다음 판단에 사용하는 반복 실행 흐름을 구현했습니다.
후속 업무 Write Tool과 DB 멱등성 처리를 구현했으며,
사용자 승인 Workflow가 완성되기 전까지 활성 Agent Registry에는 등록하지 않습니다.

## 프로젝트 목표

- 자연어 요청에 따라 필요한 Tool을 선택하고 실행
- 여러 Tool을 순차적으로 사용하는 업무 Workflow 구성
- 내부 정책 문서를 활용한 RAG 기반 정보 검색
- 고객 데이터와 정책을 종합한 판단 근거 제공
- 사용자 승인 기반의 Write 작업 실행
- Agent 실행 실패 및 중복 실행 상황에 대한 안정성 검증
- 기존 GateLM과 연동하여 Agent → Gateway → LLM Provider 흐름 구성

## 대표 시나리오

운영 담당자가 다음과 같이 요청합니다.

> 최근 상담 이후 후속 관리가 필요한 고객을 찾아서 필요한 조치와 이유를 알려줘.

Agent는 고객 정보와 상담 이력을 조회하고,
관련 운영 정책을 검색하여 후속 관리가 필요한 후보와 근거를 제시합니다.

사용자가 후속 업무 생성을 요청하면 실제 업무를 생성하고 결과를 반환합니다.

## 저장소 구조

```text
FollowUp-Agent
├─ apps/
│  └─ api/                       # 실제 NestJS Agent Backend
├─ experiments/
│  ├─ tool-calling/              # OpenAI Tool Calling 기술 검증
│  └─ langgraph/                 # LangGraph Workflow 기술 검증
├─ docs/
│  ├─ domain-model.md            # 도메인 관계와 PostgreSQL 스키마 설계
│  └─ technical-decisions/       # 기술 검증 결과와 결정 기록
├─ package.json
└─ pnpm-workspace.yaml
```

## 개발 환경

현재 검증한 환경은 다음과 같습니다.

- Node.js 22.23.1
- pnpm 9.15.0

현재 Backend는 시작할 때 PostgreSQL 연결을 초기화하므로 API 실행에는 PostgreSQL이 필요합니다.
단위 테스트와 외부 의존성을 대체한 E2E 테스트는 Docker 없이 실행할 수 있습니다.

## 설치

저장소 루트에서 의존성을 설치합니다.

```powershell
pnpm install
```

pnpm Workspace가 루트의 기술 검증 패키지와 `apps/api` 패키지의 의존성을 함께 설치합니다.

## 환경변수

예제 파일을 복사하여 API 전용 `.env`를 준비합니다.

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

| 이름 | 필수 | 기본값 | 역할 |
|---|---|---|---|
| `NODE_ENV` | 아니요 | `development` | 실행 환경 (`development`, `test`, `production`) |
| `PORT` | 아니요 | `3000` | API가 사용할 포트 |
| `DATABASE_URL` | 예 | 없음 | PostgreSQL 연결에 사용할 URL |
| `CORS_ORIGIN` | 아니요 | 없음 | 브라우저 접근을 허용할 Web Origin |
| `OPENAI_API_KEY` | 예 | 없음 | OpenAI Responses API 인증 키 |
| `OPENAI_MODEL` | 아니요 | `gpt-5.6` | Agent가 사용할 OpenAI 모델 |

현재 `DATABASE_URL`은 PostgreSQL URL 형식만 검증합니다.
Migration과 Seed 스크립트가 이 URL을 사용해 PostgreSQL에 연결합니다.

`.env`에는 비밀번호나 API Key가 포함될 수 있으므로 Git에 커밋하지 않습니다.
`.env.example`에는 로컬 개발용 예시값만 기록합니다.

## PostgreSQL Migration 및 Seed

Docker Desktop을 실행한 뒤 PostgreSQL 컨테이너를 시작합니다.

```powershell
pnpm db:up
```

`compose.yaml`은 PostgreSQL 18.3 이미지를 사용하며 Health Check가 통과할 때까지 기다립니다.

빈 데이터베이스에 아직 적용되지 않은 Migration을 실행합니다.

```powershell
pnpm db:migrate
pnpm db:migration:show
```

C001 김민수 고객과 상담 이력 2건을 구성하고 결과를 확인합니다.

```powershell
pnpm db:seed
pnpm db:verify
```

Seed는 `customer_code`와 `consultation_code`를 기준으로 Upsert하므로 반복 실행해도
C001 고객과 정의된 상담 이력이 중복 생성되지 않습니다.

가장 최근 Migration을 롤백하려면 다음 명령을 사용합니다.

```powershell
pnpm db:revert
```

롤백은 스키마와 저장 데이터를 제거할 수 있으므로 로컬 검증 DB에서만 사용합니다.
컨테이너를 중지하고 제거하되 데이터 볼륨을 유지하려면 다음 명령을 사용합니다.

```powershell
pnpm db:down
```

## Backend 실행

개발 모드로 실행합니다.

```powershell
pnpm api:start:dev
```

일반 실행은 다음 명령을 사용합니다.

```powershell
pnpm api:start
```

빌드된 JavaScript를 실행하려면 다음 명령을 사용합니다.

```powershell
pnpm api:build
pnpm --filter @followup-agent/api start:prod
```

`start:prod`는 빌드 결과를 실행하는 명령이며,
프로덕션 배포나 운영 인프라 구성이 완료됐다는 의미는 아닙니다.

## Health API

Backend 실행 후 다음 요청으로 프로세스 상태를 확인합니다.

```powershell
Invoke-RestMethod http://localhost:3000/health
```

예상 응답은 다음과 같습니다.

```json
{
  "status": "ok"
}
```

현재 Health API는 NestJS 프로세스가 HTTP 요청을 처리할 수 있는지만 확인합니다.
PostgreSQL, OpenAI, LangGraph와 같은 외부 의존성의 준비 상태는 확인하지 않습니다.

## Agent API

Agent 실행은 동기식 `POST /agent/runs` 요청으로 시작합니다.

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/agent/runs `
  -ContentType 'application/json' `
  -Body '{"message":"김민수 고객의 기본 정보와 최근 상담 내용을 같이 알려줘."}'
```

응답에는 실행 식별자, 최종 답변과 실제 Node/Tool 실행 순서를 담은 `trace`가 포함됩니다.
LLM이 Function Call을 반환하면 공통 Tool Registry가 해당 Tool을 실행하고,
그 결과를 다시 LLM에 전달합니다. Function Call이 없을 때 Workflow가 종료됩니다.

## 품질 검증

| 명령 | 역할 |
|---|---|
| `pnpm api:lint` | API와 테스트 코드의 ESLint 검사 |
| `pnpm api:build` | TypeScript strict 검사 및 NestJS build |
| `pnpm test` | 환경변수와 Health Controller 단위 테스트 |
| `pnpm test:e2e` | Health API HTTP E2E 테스트 |
| `pnpm test:integration` | 실제 PostgreSQL을 사용하는 Read/Write Tool 통합 테스트 |
| `pnpm agent:verify` | 실제 PostgreSQL과 OpenAI를 사용하는 Agent Workflow 검증 |

전체 검증은 다음 순서로 실행합니다.

```powershell
pnpm api:lint
pnpm api:build
pnpm test
pnpm test:e2e
pnpm test:integration
```

`pnpm test:integration`을 실행하기 전에 `pnpm db:up`, `pnpm db:migrate`,
`pnpm db:seed`로 테스트 데이터베이스를 준비해야 합니다.

`pnpm agent:verify`는 일반 테스트와 달리 실제 OpenAI API를 호출하므로
`OPENAI_API_KEY`, `OPENAI_MODEL`, `DATABASE_URL`이 설정된 환경에서 필요할 때만 실행합니다.
인사, 단일 Tool, 다단계 Tool 경로와 `C001` 인자 전달을 검증합니다.

## 현재 적용된 Backend 기본 설정

- TypeScript strict
- ESLint
- 환경변수 Fail-fast 검증
- Helmet 기반 보안 HTTP Header
- 환경변수 기반 CORS 정책
- 전역 ValidationPipe
- Shutdown Hook
- Health API
- Jest 단위 테스트
- Supertest E2E 테스트

이는 향후 API 구현을 위한 최소 보안·운영 기반이며,
인증·인가와 운영 보안 구성이 완료됐다는 의미는 아닙니다.

## 기술 검증 실행

LangGraph의 State 전달과 조건 분기 실험은 다음 명령으로 실행할 수 있습니다.

```powershell
pnpm tsx experiments/langgraph/basic-graph.ts
```

실제 OpenAI Tool Calling 실험은 루트 `.env`의 `OPENAI_API_KEY`가 필요합니다.

```powershell
pnpm tsx experiments/tool-calling/index.ts
```

## 현재 제한 사항

- 인증·인가 및 Rate Limit 미구현
- Health API는 DB readiness를 확인하지 않음
- Tool 실패 재시도, timeout과 오류 응답 매핑 미구현
- Checkpoint, 사용자 승인과 중단 후 재개 미구현
- Write Tool은 구현됐지만 승인 정책 연결 전이므로 Agent API에서 비활성 상태

현재 Read Agent Workflow와 비활성 Write Tool까지 구현했으며,
다음 단계에서 `required | auto` 승인 정책과 실행 재개 흐름을 연결합니다.

## 문서

- [Project Brief](./docs/00-project-brief.md)
- [도메인 모델 및 PostgreSQL 스키마 설계](./docs/domain-model.md)
- [Agent API 요청·응답 계약](./docs/api-contract.md)
- [Tool 인터페이스 및 실행 구조](./docs/tool-execution.md)
- [후속 업무 Write Tool](./docs/write-tool.md)
- [Tool Calling 기술 결정](./docs/technical-decisions/tool-calling.md)
- [LangGraph 기술 결정](./docs/technical-decisions/langgraph.md)
