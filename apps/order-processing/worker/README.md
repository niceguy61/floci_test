# order-processing/worker

현재 구현:

- `worker.mjs`
  - SQS에서 주문 메시지를 읽는다.
  - DynamoDB 상태를 `PROCESSING`, `COMPLETED`로 갱신한다.
  - SNS 토픽으로 상태 변경 이벤트를 발행한다.
