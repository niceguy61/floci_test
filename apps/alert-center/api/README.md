# alert-center/api

현재 구현:

- `server.mjs`
  - 정적 웹 UI 제공
  - `/api/health`
  - `/api/publish`
  - `/api/subscribers`
  - `/api/topic`

이 서버는 SNS publish와 SQS queue peek를 모두 `aws` CLI로 처리한다.
