# file-pipeline/api

현재 구현:

- `server.mjs`
  - 정적 웹 UI 제공
  - `/api/health`
  - `/api/files` 목록 조회
  - `/api/files` 업로드

이 서버는 업로드 직후 S3 저장, DynamoDB 메타데이터 기록, SQS enqueue를 담당한다.
