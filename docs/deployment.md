# 공개 데모 배포

## 목적

로컬에서 검증한 FollowUp Agent를 공개 URL에서 시연하기 위해 Render Blueprint로
Web, API, PostgreSQL을 함께 정의한다. 이번 구성은 포트폴리오와 기술 시연을 위한
무료 데모 환경이며 운영 서비스 구성이 아니다.

## 배포 구조

```text
Browser
  └─ Render Static Site: React Web
       └─ Render Web Service: NestJS API
            ├─ OpenAI Responses API
            └─ Render PostgreSQL
```

루트의 `render.yaml`이 다음 리소스를 선언한다.

| 리소스 | 용도 | 플랜 |
|---|---|---|
| `followup-agent-web` | React 정적 Web Demo | Free Static Site |
| `followup-agent-api` | NestJS Agent API | Free Web Service |
| `followup-agent-postgres` | 고객, 상담, 후속 업무 데이터 | Free PostgreSQL |

Web과 API URL은 Blueprint가 생성한 `RENDER_EXTERNAL_URL`을 서로 참조한다.
따라서 저장소에 임의의 `onrender.com` 주소를 하드코딩하지 않는다.

## 빌드와 시작 흐름

API 배포는 다음 순서로 실행된다.

```text
pnpm install --frozen-lockfile --prod=false
→ API build
→ 빌드된 Migration 실행
→ 멱등 Seed 실행
→ NestJS API 시작
```

API Build에는 `NODE_ENV=production`이 적용되지만 Nest CLI와 TypeScript 같은 빌드 도구는
devDependencies에 있다. 따라서 Render Build 명령은 `--prod=false`를 명시해 빌드 도구까지
설치하며, 실제 실행 단계에서는 빌드된 JavaScript만 사용한다.

`start:deploy`가 배포용 Database 준비 명령을 실행한 뒤 `dist/main.js`를 시작한다.
Database 연결은 한 번에 10초까지만 기다리고, 최초 리소스 준비 지연과 같은 일시적 실패는
5초 간격으로 최대 6회 재시도한다. 연결되면 한 세션에서 Migration과 Seed를 순서대로
적용하며, 최종 실패 시 NestJS를 시작하지 않고 원인을 로그에 남긴다. Seed는 고객 코드와
상담 코드로 Upsert하므로 무료 인스턴스 재시작 때 다시 실행해도 정의된 C001 데이터가
중복되지 않는다.

API는 Render가 주입하는 `PORT`를 사용하며 `0.0.0.0`에 바인딩한다.
`GET /health`를 Render Health Check 경로로 사용한다.

Web은 Vite production build 결과인 `apps/web/dist`를 Static Site로 제공한다.
SPA 경로는 `index.html`로 rewrite한다.

## 환경변수와 안전 기본값

| 이름 | 공급 방식 | 역할 |
|---|---|---|
| `DATABASE_URL` | Render PostgreSQL 참조 | 내부 DB 연결 |
| `CORS_ORIGIN` | Web의 `RENDER_EXTERNAL_URL` 참조 | 정확한 Web Origin만 허용 |
| `VITE_API_BASE_URL` | API의 `RENDER_EXTERNAL_URL` 참조 | Web API 대상 |
| `OPENAI_API_KEY` | Dashboard Secret 입력 | OpenAI 인증 |
| `OPENAI_MODEL` | Blueprint 값 | Agent 모델 |
| `AGENT_ALLOW_AUTO_WRITE` | `false` | Write Tool 승인 필수 |

`OPENAI_API_KEY`는 `sync: false`로 선언하므로 Git에 저장되지 않는다.
배포에는 개인 기본 키 대신 이 데모 전용 OpenAI Project Key를 사용하고, 해당 프로젝트의
사용 한도를 낮게 설정한다.

공개 Agent 실행 API는 동일 IP 기준 분당 5회로 제한한다. 승인 재개에는 일반 API 한도를
적용하고 Health Check는 제한에서 제외한다. 이 제한은 무료 단일 API 인스턴스의 메모리에
저장되므로 분산 공격이나 인스턴스 재시작을 아우르는 사용량 보장은 아니다.

## 배포 절차

1. `render.yaml`이 `main`에 병합되고 GitHub에 푸시됐는지 확인한다.
2. [Render Blueprint 생성 화면](https://dashboard.render.com/blueprint/new?repo=https://github.com/KYUJEONGLEE/Followup-Agent)을 연다.
3. Render 계정과 GitHub 저장소 접근을 연결한다.
4. Blueprint가 Web, API, PostgreSQL을 모두 Free 플랜으로 표시하는지 확인한다.
5. `OPENAI_API_KEY`에 데모 전용 Secret을 입력한다.
6. Blueprint를 적용하고 세 리소스가 준비될 때까지 배포 로그를 확인한다.
7. 생성된 Web URL과 API URL을 아래 Smoke Test로 검증한다.

유료 플랜이나 추가 리소스가 표시되면 적용하지 말고 `render.yaml`과 Dashboard 선택을
다시 확인한다.

## 공개 Smoke Test

API URL을 확인한 뒤 Health 응답을 검증한다.

```powershell
Invoke-RestMethod https://{api-host}/health
```

예상 응답은 `{ "status": "ok" }`다.

Web URL에서 다음 순서로 검증한다.

1. `안녕하세요.` 요청이 Tool 없이 완료되는지 확인한다.
2. `김민수 고객의 기본 정보와 최근 상담 내용을 같이 알려줘.` 요청에서
   `get_customer`, `get_consultations` Trace와 최종 답변을 확인한다.
3. 후속 업무 생성 요청이 승인 전에 `awaiting_approval`로 대기하는지 확인한다.
4. 거절 시 DB 변경 없이 종료되는지 확인한다.
5. 승인 검증이 필요하면 테스트 업무 한 건만 생성하고 결과를 확인한다.

배포 로그나 공개 URL을 확인하기 전에는 배포 성공으로 기록하지 않는다.

## 로컬 배포 경로 검증 결과

2026-08-24에 다음 항목을 로컬에서 검증했다.

- Render Blueprint YAML 문법 및 공식 JSON Schema 검증 통과
- pnpm frozen lockfile 설치 통과
- API/Web lint와 production build 통과
- 빌드된 JavaScript Migration과 Seed 실행 통과
- `start:deploy`로 API 기동 및 Health 응답 확인
- 실제 OpenAI와 PostgreSQL에서
  `llm → get_customer → llm → get_consultations → llm` 실행 확인
- 동일 IP의 여섯 번째 Agent 실행 요청이 `429`로 제한되는 E2E 확인

공개 Render 배포와 공개 URL Smoke Test는 Blueprint를 실제 적용한 뒤 별도로 기록한다.

## 무료 플랜 제약

- Free Web Service는 15분 동안 요청이 없으면 중지되며 다음 요청의 기동에 시간이 걸릴 수 있다.
- Free PostgreSQL은 생성 30일 후 만료되고 백업을 제공하지 않는다.
- 무료 DB 만료 후 새 DB를 만들면 Migration과 Seed로 기본 데이터는 복구할 수 있지만,
  사용자가 만든 후속 업무 데이터는 별도 백업 없이 복구되지 않는다.
- 인증과 사용자별 권한은 아직 구현하지 않았다.
- 승인 checkpoint는 API 프로세스 메모리에 있어 재시작 후 승인 대기를 재개할 수 없다.

무료 플랜의 현재 정책은 [Render Free 공식 문서](https://render.com/docs/free),
Blueprint 필드는 [Render Blueprint 공식 명세](https://render.com/docs/blueprint-spec)를 기준으로 한다.

## 운영 전환 시 필요한 후속 작업

- 인증과 사용자별 권한
- 분산 Rate Limit 또는 전체 비용 예산 집행
- 영속 checkpoint 저장소
- 유료 PostgreSQL, 백업과 복구 절차
- 로그, Metric, Alert
- Secret rotation과 배포 환경 분리
