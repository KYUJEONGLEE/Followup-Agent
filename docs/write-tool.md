# 후속 업무 Write Tool

## 1. 목적과 현재 상태

AGENT-18에서는 고객에게 후속 관리 업무를 생성하는
`create_follow_up_task` Tool과 PostgreSQL Repository를 구현한다.

AGENT-19에서 `ToolsModule`의 활성 Registry와 LangGraph 승인 Workflow를 연결했다.
LLM은 이 Tool을 선택할 수 있지만 Backend가 `effect: write`를 확인하므로,
기본 정책에서는 사용자 승인 전 실제 Handler를 실행하지 않는다.

```text
LLM → Write Function Call → Backend 승인 정책
                         ├─ required → checkpoint → interrupt
                         └─ auto     → Write Tool
```

## 2. 입력 계약

```json
{
  "customer_id": "C001",
  "source_consultation_id": "CONS001",
  "title": "생활 습관 확인",
  "description": "다음 상담 전에 최근 생활 습관을 확인합니다.",
  "due_at": "2026-08-25T09:00:00+09:00"
}
```

| 필드 | 규칙 |
|---|---|
| `customer_id` | 필수, 활성 고객의 업무 코드 |
| `source_consultation_id` | 상담에 기반하지 않으면 `null` |
| `title` | 공백 제외 1~200자 |
| `description` | 공백 제외 1~2,000자 또는 `null` |
| `due_at` | Timezone을 포함한 ISO 8601 문자열 또는 `null` |

OpenAI strict Function Calling과 Backend Zod 검증을 함께 사용한다.
선택 가능한 값도 Function Schema의 `required`에 포함하고 `null`로 표현한다.

## 3. 데이터 생성 규칙

Repository는 LLM에 내부 UUID를 요구하지 않는다.

1. `customer_id` 업무 코드로 활성 고객 UUID를 조회한다.
2. 상담 ID가 있으면 같은 고객 소유인지 확인한다.
3. 검증된 UUID로 `follow_up_tasks`에 `pending` 업무를 생성한다.
4. 생성된 DB 값을 다시 고객·상담 업무 코드 형태로 반환한다.

고객이 없거나 상담이 다른 고객 소유이면 DB를 변경하지 않고
`not_found` Tool 결과를 반환한다.

## 4. 멱등성

LLM은 `idempotency_key`를 입력하지 않는다.
Backend가 신뢰할 수 있는 Tool 실행 문맥으로 키를 만든다.

```text
SHA-256(executionId + ":" + callId)
→ agent:<64자리 hex>
```

같은 Tool 실행을 재시도하면 동일한 키가 생성된다.

| 상황 | 결과 |
|---|---|
| 처음 실행 | 새 업무 생성, `created: true` |
| 같은 키와 같은 내용 | 기존 업무 반환, `created: false` |
| 같은 키와 다른 내용 | 실행 충돌로 거부 |

PostgreSQL의 `uq_follow_up_tasks_idempotency_key` Partial Unique Index가
동시 요청에서도 최종 중복 생성을 방지한다.

## 5. Tool effect와 승인 경계

```text
get_customer          → read
get_consultations     → read
create_follow_up_task → write
```

`effect`는 LLM 설명이 아닌 Backend 승인 정책에 사용한다.
Write Function Call이 발생하면 다음처럼 분기한다.

```text
writeApprovalMode = required
→ 실행 내용을 checkpoint에 저장
→ interrupt
→ 사용자 승인 후 Write Tool 실행 또는 거절 후 종료

writeApprovalMode = auto
→ 서버가 auto 권한을 허용한 경우 즉시 Write Tool 실행
```

기본 정책은 `required`이며, 요청값만으로 더 높은 권한을 얻을 수 없도록
Backend 정책이 최종 실행 모드를 결정해야 한다.

요청자가 `auto`를 선택하더라도 `AGENT_ALLOW_AUTO_WRITE=true`일 때만
실제 `auto`가 적용된다. 허용되지 않은 요청은 `required`로 낮춘다.

승인 재개 Endpoint는 `executionId`로 checkpoint를 찾고, 사용자가 확인한
응답의 `approval.id`와 요청의 `approvalId`가 일치하는지 검사한다.

```text
POST /agent/runs/{executionId}/approval
{ "approvalId": "응답의 approval.id", "decision": "approve" | "reject" }
```

같은 승인 ID와 결정을 다시 보내면 정상 종료된 응답을 반환하고 Tool을 재실행하지 않는다.
동시에 들어온 같은 승인 ID와 결정도 한 프로세스 안에서는 하나의 재개 작업을 공유한다.
다음 Write가 제안되면 새 승인 ID를 발급하므로 이전 승인 재전송은 다음 작업을 승인하지 않는다.
승인 ID 누락·잘못된 형식은 `400`, 다른 승인 ID나 반대 결정은 `409 Conflict`로 거부한다.
승인 이후 Tool 또는 LLM이 실패해 실행할 Node가 남아 있는 경우도 재승인 시 `409`로 응답하며,
업무가 이미 생성됐을 수 있어 자동 재시도하지 않는다.

승인 ID는 작업 구분용이며 사용자 인증·인가를 대신하지 않는다.
상세 요청·응답과 오류 계약은 [Agent API 계약](./api-contract.md)을 기준으로 한다.

현재 checkpointer는 `MemorySaver`이므로 단일 프로세스 MVP 검증 범위다.
서버 재시작과 다중 인스턴스 환경에서는 PostgreSQL 또는 Redis 기반의
영속 checkpointer로 교체해야 한다.

## 6. 검증

단위 테스트는 다음 항목을 확인한다.

- `write` effect와 strict Function Schema
- 입력 trim, 길이, datetime과 추가 필드 검증
- 실행 문맥 기반 멱등성 키
- 신규 생성과 재시도 결과 구분
- 고객·상담 미존재와 멱등성 충돌 처리

PostgreSQL 통합 테스트는 다음 항목을 확인한다.

- C001과 CONS001을 사용하는 업무 생성
- 동일 실행을 두 번 호출해도 한 행만 존재
- 같은 키의 다른 요청 거부
- 없는 고객에 대한 생성 거부
- 다른 고객 소유 상담 연결 거부
- 테스트 데이터 정리
- 승인 전 미생성, 승인 후 1건 생성
- 거절 시 미생성
- 같은 실행의 중복 승인 후에도 1건 유지
- `auto` 정책의 즉시 실행

## 7. 코드 위치

- Write Tool: `apps/api/src/tools/write/create-follow-up-task.tool.ts`
- Repository: `apps/api/src/tools/repositories/follow-up-task.repository.ts`
- 단위 테스트: `apps/api/src/tools/write/create-follow-up-task.tool.spec.ts`
- DB 통합 테스트: `apps/api/test/write-tool.integration-spec.ts`
