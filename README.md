# FollowUp Agent

자연어 업무 요청을 기반으로 필요한 정보를 조회하고,
내부 정책을 참고해 판단을 보조하며,
사용자의 요청에 따라 후속 업무까지 실행하는 AI Agent 프로젝트입니다.

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

## 문서

- [Project Brief](./docs/00-project-brief.md)

## 개발 진행

현재 프로젝트 요구사항 정의 및 기술 검증을 진행하고 있습니다.

주요 검증 대상은 다음과 같습니다.

- OpenAI Tool Calling
- Agent Workflow
- RAG
- Tool 실행 및 상태 관리
- Write 작업 중복 실행 방지

## Tech Stack

기술 검증 결과에 따라 세부 구현 기술을 확정할 예정입니다.

- TypeScript
- NestJS
- PostgreSQL
- OpenAI API