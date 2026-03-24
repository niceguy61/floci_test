# auth-portal/api

현재 구현:

- `server.mjs`
  - 정적 웹 UI 제공
  - `/api/health`
  - `/api/signup`
  - `/api/confirm`
  - `/api/login`
  - `/api/profile`

특징:

- 외부 의존성 없이 Node 내장 모듈과 `aws` CLI만 사용한다.
- 현재 bootstrap은 `Cognito` 인증 흐름을 우선 검증한다.
- 이후 단계에서 `API Gateway v2`와 `Lambda`로 옮겨갈 수 있는 형태를 유지한다.
