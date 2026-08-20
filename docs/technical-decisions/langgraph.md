# LangGraph Workflow 기술 검증

## 1. 검증 배경

Task 2에서 LLM이 Tool 호출을 요청하는 동안 반복 실행하는
Tool Execution Loop를 직접 구현했다.

현재 구조만으로도 다단계 Tool 호출은 처리할 수 있지만,
실제 Agent에서는 상태 관리, 조건 분기, 사용자 승인,
실패 처리와 같은 Workflow가 추가될 수 있다.

동일한 업무 흐름을 LangGraph로 구성하여
직접 구현한 실행 Loop와 비교하고,
실제 Agent Backend에 LangGraph를 도입할 필요가 있는지 검증한다.


## 2. 검증 질문

- 직접 구현한 Tool Execution Loop와 LangGraph의 실행 구조는 어떻게 다른가?
- Agent의 상태를 어떤 방식으로 관리하는가?
- Tool 호출 여부에 따른 조건 분기를 어떻게 표현하는가?
- 여러 Node 사이에서 Tool 실행 결과를 어떻게 전달하는가?
- 사용자 승인과 같은 중간 단계를 추가하기 쉬운가?
- 실패 및 재시도 흐름을 명시적으로 표현할 수 있는가?
- 얻는 이점이 추가되는 복잡도보다 큰가?


## 3. 비교 기준

| 항목 | 직접 구현 Loop | LangGraph |
|---|---|---|
| 다단계 Tool 실행 | 검증 완료 | 검증 완료 |
| 단일 Tool 실행 | 검증 완료 | 검증 완료 |
| 상태 관리 | 응답 객체와 지역 변수로 관리 | 공통 State로 검증 완료 |
| 조건 분기 | `while` 내부 조건문 | Conditional Edge로 검증 완료 |
| 사용자 승인 단계 | 검증 예정 | 검증 예정 |
| 실패 흐름 표현 | 검증 예정 | 검증 예정 |
| 코드 복잡도 | 검증 예정 | 검증 예정 |


## 4. 관찰 결과

### 조건 분기 및 State 전달

- 공통 State를 통해 Node 간 중간 결과를 전달할 수 있음을 확인했다.
- `decide_request` 결과에 따라 서로 다른 실행 경로로 분기할 수 있었다.
- `trace`를 통해 실제 실행된 Node 순서를 확인할 수 있었다.
- 현재 분기 판단은 `"고객"` 키워드를 사용하는 임시 규칙이며,
  실제 LLM의 Tool 선택을 검증한 것은 아니다.
- `lookup_customer` 역시 외부 시스템 호출이 아닌 테스트 데이터 반환 함수다.

### 실제 LLM Tool Calling Flow

단일 Tool인 `get_customer(name)`를 OpenAI Responses API에 등록하고,
직접 구현 Loop에서 사용했던 Tool Calling 방식을 LangGraph의 Node와 Edge로 재현했다.

고객 조회 요청 `김민수 고객 정보를 알려줘.`의 실행 경로는 다음과 같았다.

```text
START
→ call_llm:function_call:get_customer
→ execute_tool:get_customer(김민수)
→ call_llm:final_answer
→ END
```

- 첫 번째 LLM Node가 `get_customer` Function Call을 반환했다.
- Tool Node가 가짜 고객 데이터를 실행하고 `function_call_output`을 만들었다.
- 두 번째 LLM Node가 Tool 결과를 받아 최종 답변을 생성했다.

인사 요청 `안녕하세요.`에서는 Function Call이 없었고 다음 경로로 종료됐다.

```text
START
→ call_llm:final_answer
→ END
```

이를 통해 Tool 호출 여부가 키워드 규칙이 아니라 실제 LLM의 Function Calling 결과에 따라 분기되는 것을 확인했다.

### Node 사이에서 전달한 State

- `userMessage`: 최초 사용자 요청
- `previousResponseId`: Tool 결과를 전달할 다음 Responses API 호출의 연결 정보
- `pendingToolCall`: LLM이 요청한 Tool 이름, 인자, 호출 ID
- `toolOutput`: 앱이 실행한 Tool 결과를 직렬화한 값
- `finalAnswer`: Tool 호출이 끝난 뒤 LLM이 생성한 답변
- `trace`: 실제 통과한 Node 순서

직접 구현 Loop에서도 동일한 API 호출과 Tool 실행을 수행한다. 차이는 반복문의 조건문이 다음 단계를 결정하는 대신, LangGraph에서는 `pendingToolCall`을 보고 Conditional Edge가 Tool Node 또는 종료를 선택한다는 점이다.

### 의존 관계가 있는 다단계 Tool Calling

고객 정보와 최근 상담 이력을 함께 요청하는 시나리오를 실행했다.
`get_consultations`는 고객 이름이 아닌 `customer_id`를 입력으로 받으므로,
첫 번째 Tool 결과가 두 번째 Tool 호출에 필요하다.

```text
START
→ call_llm:function_call:get_customer
→ execute_tool:get_customer({"name":"김민수"})
→ call_llm:function_call:get_consultations
→ execute_tool:get_consultations({"customer_id":"C001"})
→ call_llm:final_answer
→ END
```

- 첫 번째 LLM Node가 `get_customer(name="김민수")`를 선택했다.
- 고객 조회 결과의 `C001`을 받은 뒤, LLM이 `get_consultations(customer_id="C001")`를 선택했다.
- Backend와 Graph에는 `get_customer → get_consultations`의 개별 호출 순서를 정의하지 않았다.
- Graph는 `LLM → Tool → LLM`이라는 일반적인 반복 구조만 관리한다.
- `trace`에 Tool 이름과 실제 arguments를 남겨, 다단계 호출 순서와 데이터 의존성을 확인했다.

### MVP Workflow Diagram

```mermaid
flowchart TD
    START([START]) --> LLM[LLM Node]
    LLM -->|function_call 있음| TOOL[Tool Node]
    TOOL -->|function_call_output| LLM
    LLM -->|function_call 없음| END([END])
```

## 5. 검증 범위와 남은 확인 사항

- 단일 Tool `get_customer`와, 결과 의존성이 있는 `get_customer → get_consultations` 순차 호출을 검증했다.
- 고객 정보는 테스트 데이터이며 DB, 외부 API, 사용자 승인, 재시도, checkpoint는 연결하지 않았다.
- 단일 Tool 흐름에서는 직접 구현 Loop보다 LangGraph 코드와 State 항목이 더 늘어난다.
- 따라서 이번 결과만으로 복잡한 업무 Workflow에서의 유지보수성 우위를 결론낼 수는 없다.


## 6. 기술적 결정

### 결정: MVP Agent Workflow에 LangGraph를 채택

단일 Tool Calling은 기존의 직접 구현 Loop로도 충분히 처리할 수 있다.
LangGraph는 실행 경로를 Node와 Edge로 명시하고 State 변화를 추적하기 쉽게 만들지만,
단순한 흐름만 다루면 추가되는 State 설계와 라이브러리 의존성이 더 클 수 있다.

그러나 이 프로젝트의 MVP는 여러 Tool을 LLM 판단으로 순차 실행하고,
이전 Tool 결과를 다음 Tool 입력으로 전달하는 Agent Workflow를 다룬다.
따라서 실행 경로, 중간 State, Tool 호출 trace를 명시적으로 관리하기 위해
LangGraph를 MVP의 Agent Workflow Orchestration Layer로 채택한다.

이는 LangGraph가 직접 구현 Loop보다 항상 우수하다는 결론이 아니다.
직접 Loop는 단순 Tool Calling의 기준 구현으로 유지하며,
MVP에서는 Workflow를 확장하고 설명하기 위한 구조적 선택으로 LangGraph를 사용한다.

MVP 이후 아래 요구가 추가될 때 State와 Edge를 확장한다.

- 사용자 승인 또는 중단 후 재개가 필요한 경우
- Tool 실패에 따라 재시도, 대체 경로, 종료를 명시적으로 분기해야 하는 경우
- 실행 경로와 중간 State를 운영 환경에서 추적해야 하는 경우

### MVP 구현에서의 적용 시점

이 문서의 Spike는 LangGraph 채택 여부를 판단하기 위한 기술 검증이다.
실제 NestJS Agent Backend와 PostgreSQL 기반 Read Tool에 LangGraph를 연결하는 작업은
MVP 구현 순서의 7단계에서 수행한다.

그 전 단계에서는 NestJS 환경, 도메인·스키마, Migration·Seed, API 계약,
Tool 인터페이스와 Read Tool을 먼저 준비한다.
