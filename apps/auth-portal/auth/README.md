# auth-portal/auth

현재 구현:

- `runtime.mjs`
  - setup 스크립트가 만든 `.runtime/cognito.json`을 읽는다.
  - user pool ID와 app client ID를 API 서버와 smoke check가 공유하게 한다.
