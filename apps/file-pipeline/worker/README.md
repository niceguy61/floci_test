# file-pipeline/worker

현재 구현:

- `worker.mjs`
  - SQS 메시지를 읽는다.
  - DynamoDB 상태를 `PROCESSING`, `COMPLETED`로 바꾼다.
  - 업로드된 파일의 크기를 읽어 결과 메타데이터에 기록한다.
