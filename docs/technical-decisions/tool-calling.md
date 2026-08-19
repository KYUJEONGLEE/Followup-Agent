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

TODO


## 발견한 문제

TODO


## 실제 프로젝트에 반영할 결정

TODO