# OpenAI Tool Calling 기술 검증

## 검증 배경

Agent가 사용자의 자연어 요청에 따라 외부 기능을 선택하고 실행하기 위해
Tool Calling이 실제로 어떤 실행 구조를 가지는지 확인한다.

단순 API 사용법을 확인하는 것이 아니라,
향후 Agent Backend에서 LLM과 Tool 실행 계층의 책임을 어떻게 분리할지 결정하는 것을 목적으로 한다.

## 검증할 질문

1. LLM은 자연어 요청에서 적절한 Tool을 선택할 수 있는가?
2. Tool의 arguments는 어떤 형태로 반환되는가?
3. 여러 Tool이 필요한 경우 호출 흐름은 어떻게 구성되는가?
4. Tool이 필요하지 않은 요청은 어떻게 처리되는가?
5. Tool 입력이 잘못됐거나 실행에 실패하면 어떤 처리가 필요한가?
6. Tool 실행 책임은 Agent 구조에서 어느 계층이 가져야 하는가?

## 최소 실험

테스트 Tool

- get_customer
- get_consultations

테스트 케이스

- 단일 Tool 필요
- 여러 Tool 필요
- Tool 불필요
- 존재하지 않는 데이터 조회
- 잘못된 입력

## 관찰 결과

- `"김민수 고객 정보를 알려줘"` 요청에서 모델이 `get_customer` Tool을 선택했다.
- 모델은 Tool을 직접 실행하지 않고 `get_customer`와 `{"name":"김민수"}` 인자를 반환했다.
- Tool arguments는 JSON 문자열로 반환되어 애플리케이션에서 파싱이 필요했다.
- 실제 `getCustomer()` 함수 실행은 애플리케이션에서 수행했다.
- Tool 실행 결과를 모델에 다시 전달하자 해당 데이터를 기반으로 최종 자연어 응답을 생성했다.
- Tool 호출과 실행 결과는 `call_id`를 통해 연결되는 것을 확인했다.

- 고객 이름만 제공된 요청에서 모델은 먼저 `get_customer`를 호출했다.
- `get_customer` 실행 결과로 반환된 `customer_id`를 바탕으로
  `get_consultations`를 추가 호출하는 것을 확인했다.
- 앞선 Tool의 결과가 다음 Tool의 입력으로 필요한 경우,
  모델이 여러 번의 Tool 호출을 순차적으로 이어갈 수 있음을 확인했다.
- 두 번째 응답이 다시 `function_call`인 경우 `output_text`는 비어 있으며,
  추가 Tool 실행이 필요하다.

## 발견한 문제

TODO


## 실제 프로젝트에 반영할 결정

TODO