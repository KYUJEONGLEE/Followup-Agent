# Agent API 요청·응답 계약

## 1. 목적과 범위

이 문서는 AGENT-14에서 확정한 FollowUp Agent의 동기 HTTP API 계약을 정의한다.
Controller와 LangGraph Workflow 연결은 AGENT-17에서 구현하며,
이번 단계에서는 소비자가 의존할 요청, 응답, 오류와 실행 trace 형식을 고정한다.

## 2. Endpoint

```text
POST /agent/runs
Content-Type: application/json
```

MVP는 요청을 받은 연결에서 LLM과 Tool 실행을 마친 뒤 최종 결과를 반환하는 동기 방식이다.
정상 응답의 HTTP 상태는 `200 OK`다.

## 3. 요청 계약

```json
{
  "message": "김민수 고객의 기본 정보와 최근 상담 내용을 알려줘."
}
```

| 필드 | 타입 | 필수 | 검증 규칙 |
|---|---|---:|---|
| `message` | `string` | 예 | 앞뒤 공백 제거 후 1자 이상 2,000자 이하 |

- JSON 객체에 `message` 이외의 필드가 있으면 `400 Bad Request`로 거부한다.
- 빈 문자열, 공백 문자열과 문자열이 아닌 값은 거부한다.
- 사용자 입력을 Tool 이름이나 실행 순서로 해석하는 규칙은 API 계약에 넣지 않는다.

## 4. 정상 응답 계약

```json
{
  "executionId": "2d298af0-cb89-4cd5-ad9d-cb572fe7de52",
  "answer": "김민수 고객은 현재 active 상태이며, 최근 상담에서는 생활 습관 확인이 필요하다고 기록되어 있습니다.",
  "trace": [
    {
      "sequence": 1,
      "type": "node",
      "name": "llm"
    },
    {
      "sequence": 2,
      "type": "tool",
      "name": "get_customer",
      "arguments": {
        "name": "김민수"
      }
    },
    {
      "sequence": 3,
      "type": "node",
      "name": "llm"
    },
    {
      "sequence": 4,
      "type": "tool",
      "name": "get_consultations",
      "arguments": {
        "customer_id": "C001"
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
| `executionId` | `string` | 요청 단위로 생성하는 UUID |
| `answer` | `string` | 모든 Tool 실행이 끝난 뒤 생성한 최종 답변 |
| `trace` | `AgentTraceEntry[]` | 실제 Node와 Tool 실행 순서를 나타내는 배열 |

### Trace 계약

모든 Trace 항목은 1부터 증가하는 `sequence`를 가진다.

- Node 항목: `type: "node"`, Graph Node의 `name`
- Tool 항목: `type: "tool"`, Tool `name`과 검증을 통과한 `arguments`
- Tool 결과 원문과 내부 오류 Stack은 API Trace에 노출하지 않는다.
- Tool을 사용하지 않은 요청은 LLM Node 항목만 반환할 수 있다.

## 5. 오류 응답 계약

```json
{
  "statusCode": 400,
  "code": "AGENT_REQUEST_INVALID",
  "message": "요청 본문이 올바르지 않습니다.",
  "details": [
    {
      "field": "message",
      "reason": "1자 이상 2,000자 이하의 문자열이어야 합니다."
    }
  ],
  "timestamp": "2026-08-20T10:00:00.000Z"
}
```

| HTTP | 오류 코드 | 의미 | `executionId` |
|---:|---|---|---|
| 400 | `AGENT_REQUEST_INVALID` | 요청 DTO 검증 실패 | 없음 |
| 500 | `AGENT_EXECUTION_FAILED` | 내부 Workflow 또는 Tool 실행 실패 | 있으면 반환 |
| 502 | `AGENT_LLM_FAILED` | LLM Provider 호출 실패 | 있으면 반환 |
| 504 | `AGENT_TIMEOUT` | Agent 동기 실행 제한 시간 초과 | 있음 |

- 데이터 미존재는 시스템 오류가 아니다. Tool 결과로 표현하고 Agent가 최종 답변에서 안내한다.
- 내부 Stack Trace, 환경변수, DB 연결 정보와 LLM 자격 증명은 반환하지 않는다.
- `executionId`가 생성된 이후의 오류에는 가능한 경우 같은 ID를 반환한다.

## 6. 동기 처리 범위와 확장 지점

MVP에서는 하나의 HTTP 요청 안에서 Workflow를 완료한다.
실행 시간이 길어지면 계약 버전을 변경하거나 별도 Endpoint를 추가해 다음 구조로 확장할 수 있다.

```text
POST /agent/runs       → 202 Accepted
GET /agent/runs/{id}  → 실행 상태 또는 최종 결과
```

비동기 실행, SSE Streaming, 실행 취소와 Checkpoint 재개는 현재 계약에 포함하지 않는다.

## 7. 코드 위치와 테스트 기준

- 요청 DTO: `apps/api/src/agent/contracts/run-agent-request.dto.ts`
- 정상 응답 타입: `apps/api/src/agent/contracts/agent-run-response.ts`
- 오류 응답 타입: `apps/api/src/agent/contracts/agent-error-response.ts`
- DTO 검증 테스트: `apps/api/src/agent/contracts/run-agent-request.dto.spec.ts`

요청 DTO 테스트는 실제 전역 설정과 같은 `ValidationPipe` 옵션을 사용한다.
AGENT-17에서는 Controller E2E 테스트로 이 문서의 HTTP 상태와 JSON 구조를 검증한다.
