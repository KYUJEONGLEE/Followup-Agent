# Agent API 요청·응답 계약

## 1. Agent 실행

```text
POST /agent/runs
Content-Type: application/json
```

### 요청

```json
{
  "message": "김민수 고객의 후속 업무를 만들어줘.",
  "writeApprovalMode": "required"
}
```

| 필드 | 타입 | 필수 | 규칙 |
|---|---|---:|---|
| `message` | `string` | 예 | Trim 후 1~2,000자 |
| `writeApprovalMode` | `required \| auto` | 아니요 | 기본값 `required` |

`writeApprovalMode`는 요청자의 실행 선호다.
`auto`는 서버의 `AGENT_ALLOW_AUTO_WRITE=true` 설정이 허용할 때만 적용한다.
서버가 허용하지 않으면 실제 적용 모드는 `required`로 낮춘다.

계약에 없는 필드, 빈 메시지와 지원하지 않는 승인 모드는
`400 Bad Request`로 거부한다.

## 2. 완료 응답

Tool이 필요 없거나 Read Tool만 실행한 경우,
또는 허용된 Write Tool 실행까지 끝난 경우 다음 응답을 반환한다.

```json
{
  "executionId": "2d298af0-cb89-4cd5-ad9d-cb572fe7de52",
  "status": "completed",
  "answer": "후속 업무를 생성했습니다.",
  "approval": null,
  "writeApprovalMode": "required",
  "trace": [
    {
      "sequence": 1,
      "type": "node",
      "name": "llm"
    },
    {
      "sequence": 2,
      "type": "approval",
      "decision": "requested",
      "mode": "required",
      "toolName": "create_follow_up_task"
    },
    {
      "sequence": 3,
      "type": "approval",
      "decision": "approved",
      "mode": "required",
      "toolName": "create_follow_up_task"
    },
    {
      "sequence": 4,
      "type": "tool",
      "name": "create_follow_up_task",
      "arguments": {
        "customer_id": "C001",
        "source_consultation_id": "CONS001",
        "title": "생활 습관 확인",
        "description": "다음 상담 전에 확인합니다.",
        "due_at": null
      }
    },
    {
      "sequence": 5,
      "type": "node",
      "name": "llm"
    }
  ]
}
```

| 필드 | 타입 | 의미 |
|---|---|---|
| `executionId` | `string` | 요청과 checkpoint를 연결하는 UUID |
| `status` | `completed` | Workflow 완료 상태 |
| `answer` | `string` | 최종 답변 |
| `approval` | `null` | 대기 중인 승인이 없음 |
| `writeApprovalMode` | `required \| auto` | 서버가 실제 적용한 정책 |
| `trace` | `AgentTraceEntry[]` | Node, 승인과 Tool 실행 순서 |

## 3. 승인 대기 응답

`required` 정책에서 LLM이 Write Tool을 선택하면 DB를 변경하지 않고
LangGraph checkpoint를 저장한 뒤 다음 응답을 반환한다.

```json
{
  "executionId": "2d298af0-cb89-4cd5-ad9d-cb572fe7de52",
  "status": "awaiting_approval",
  "answer": null,
  "approval": {
    "id": "5225e953-e55c-4e9c-9507-65d9d1d860b2",
    "toolName": "create_follow_up_task",
    "arguments": {
      "customer_id": "C001",
      "source_consultation_id": "CONS001",
      "title": "생활 습관 확인",
      "description": "다음 상담 전에 확인합니다.",
      "due_at": null
    }
  },
  "writeApprovalMode": "required",
  "trace": [
    {
      "sequence": 1,
      "type": "node",
      "name": "llm"
    },
    {
      "sequence": 2,
      "type": "approval",
      "decision": "requested",
      "mode": "required",
      "toolName": "create_follow_up_task"
    }
  ]
}
```

MVP는 완료와 승인 대기 응답 모두 `200 OK`를 사용하고,
본문의 `status`로 실행 상태를 구분한다.

## 4. 승인 또는 거절

```text
POST /agent/runs/{executionId}/approval
Content-Type: application/json
```

```json
{
  "approvalId": "5225e953-e55c-4e9c-9507-65d9d1d860b2",
  "decision": "approve"
}
```

| 필드 | 타입 | 의미 |
|---|---|---|
| `approvalId` | UUID v4 | 사용자가 확인한 응답의 `approval.id`, 필수 |
| `decision` | `approve \| reject` | 보류된 Write Tool 실행 여부 |

### 승인

`approve`는 checkpoint에서 보류된 Write 호출을 재개한다.
Tool 결과를 다시 LLM에 전달한 뒤 최종 답변이면 `completed`를 반환한다.
LLM이 다음 Write를 요청하면 새로운 `approval.id`와 함께 다시 `awaiting_approval`로 대기한다.

같은 `executionId`, `approvalId`, 결정을 다시 보내면 정상 종료된 실행에 한해 완료된 응답을 반환한다.
동시에 들어온 같은 승인 ID와 결정은 한 프로세스 안에서 진행 중인 재개 작업을 공유하므로
Write Tool과 LLM을 중복 실행하지 않는다.

이전 승인 ID를 재전송해도 다음 Write를 승인할 수 없다. 현재 checkpoint의 승인 ID와
일치하지 않는 요청은 `409 Conflict`로 거부한다. Web은 현재 승인 화면의 ID를 전송한다.
`approvalId`가 없는 이전 클라이언트 요청은 `400 Bad Request`다. API와 Web을 함께 배포해야 한다.
승인 ID는 확인한 작업을 구분하기 위한 값이며 사용자 인증·인가를 대신하지 않는다.

승인 이후 Tool 또는 최종 LLM 호출이 실패해 Graph에 실행할 Node가 남아 있으면,
재승인 요청은 `completed`가 아닌 `409 Conflict`로 응답한다. 이때 업무가 이미 생성됐을
수 있으므로 새 생성 요청을 반복하기 전에 실행 결과를 확인해야 한다.
승인 API는 실패한 Node의 자동 재시도나 이미 수행된 Write의 롤백을 제공하지 않는다.

### 거절

`reject`는 Write Tool을 실행하지 않고 다음처럼 종료한다.

```json
{
  "executionId": "2d298af0-cb89-4cd5-ad9d-cb572fe7de52",
  "status": "rejected",
  "answer": "사용자가 데이터 변경 요청을 거절했습니다.",
  "approval": null,
  "writeApprovalMode": "required",
  "trace": []
}
```

## 5. Trace 계약

모든 Trace 항목은 1부터 증가하는 `sequence`를 가진다.

- Node: `type: node`, Graph Node 이름
- Approval: `type: approval`, 요청·승인·거절 결정과 적용 모드
- Tool: `type: tool`, Tool 이름과 검증을 통과한 arguments
- Tool 결과 원문, 내부 오류 Stack과 자격 증명은 Trace에 노출하지 않는다.

승인 Trace와 Tool Trace는 분리한다.
정상 응답에서는 사용자의 승인과 실제 Tool 실행을 각각 확인할 수 있다.
시스템 예외의 HTTP 오류 응답에는 현재 Trace가 포함되지 않는다.

## 6. 승인 오류

| HTTP | 상황 |
|---:|---|
| 400 | 잘못된 실행 UUID, 누락·잘못된 approvalId, decision 또는 요청 필드 |
| 404 | `executionId`에 해당하는 checkpoint 없음 |
| 409 | 승인 ID 불일치, 승인이 필요 없는 실행, 다른 승인 요청 처리 중, 반대 결정 적용됨, 또는 이전 승인 실행 미완료 |

데이터 미존재는 시스템 오류가 아니다.
Tool 결과로 표현하고 Agent가 최종 답변에서 안내한다.

## 7. Checkpoint 범위

현재 `executionId`를 LangGraph `thread_id`로 사용하고
`MemorySaver`에 checkpoint를 저장한다.

이는 단일 Backend 프로세스에서 중단·재개 구조를 검증하기 위한 MVP 계약이다.
프로세스가 재시작되면 대기 상태가 사라지고, 여러 서버 인스턴스가 checkpoint를
공유하지 못한다. 운영 환경에서는 영속 checkpointer와 사용자 인증·인가가 필요하다.

## 8. 코드와 테스트

- 실행 요청 DTO: `apps/api/src/agent/contracts/run-agent-request.dto.ts`
- 승인 요청 DTO: `apps/api/src/agent/contracts/resume-agent-request.dto.ts`
- 응답 계약: `apps/api/src/agent/contracts/agent-run-response.ts`
- Workflow: `apps/api/src/agent/agent-workflow.service.ts`
- API E2E: `apps/api/test/agent.e2e-spec.ts`
- 승인 실패 API E2E: `apps/api/test/approval-failure.e2e-spec.ts`
- 승인 재전송 API E2E: `apps/api/test/approval-replay.e2e-spec.ts`
- PostgreSQL 승인 통합 테스트: `apps/api/test/approval-workflow.integration-spec.ts`
- 핵심 API→PostgreSQL E2E: `apps/api/test/agent-core-scenarios.integration-spec.ts`
