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
| 다단계 Tool 실행 | 검증 완료 | 검증 예정 |
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

## 5. 검증 범위와 남은 확인 사항

- 이번 Spike는 단일 Tool `get_customer`만 다룬다. 다단계 Tool Calling은 아직 LangGraph 방식으로 검증하지 않았다.
- 고객 정보는 테스트 데이터이며 DB, 외부 API, 사용자 승인, 재시도, checkpoint는 연결하지 않았다.
- 단일 Tool 흐름에서는 직접 구현 Loop보다 LangGraph 코드와 State 항목이 더 늘어난다.
- 따라서 이번 결과만으로 복잡한 업무 Workflow에서의 유지보수성 우위를 결론낼 수는 없다.


## 6. 기술적 결정

### 현재 결정: 단순 Tool Calling의 기본 도입은 보류

단일 Tool Calling은 기존의 직접 구현 Loop로도 충분히 처리할 수 있다.
LangGraph는 실행 경로를 Node와 Edge로 명시하고 State 변화를 추적하기 쉽게 만들지만,
현재 검증 범위에서는 추가되는 State 설계와 라이브러리 의존성에 비해 얻는 이점이 결정적이지 않았다.

따라서 단순한 `LLM → Tool → LLM → 종료` 흐름은 직접 구현 Loop를 기본으로 유지한다.
이는 LangGraph를 사용하지 않겠다는 결론이 아니라, 아래 조건이 확인될 때 다시 채택을 검토한다는 뜻이다.

- 여러 Tool을 순서대로 호출해야 하는 경우
- 사용자 승인 또는 중단 후 재개가 필요한 경우
- Tool 실패에 따라 재시도, 대체 경로, 종료를 명시적으로 분기해야 하는 경우
- 실행 경로와 중간 State를 운영 환경에서 추적해야 하는 경우

