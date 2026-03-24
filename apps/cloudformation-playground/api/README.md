# cloudformation-playground/api

현재 구현:

- `server.mjs`
  - 정적 웹 UI 제공
  - `/api/health`
  - `/api/stacks` 목록 조회
  - `/api/stacks` 생성
  - `/api/stacks/:name` 상세 조회

생성 API는 내부에서 S3 bucket 템플릿을 만들어 CloudFormation `create-stack`을 호출한다.
