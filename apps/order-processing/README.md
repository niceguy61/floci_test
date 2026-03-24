# 주문 접수와 비동기 처리

상태: `runnable bootstrap`

이 핸즈온은 `SQS + SNS + DynamoDB` 조합으로 주문 상태를 비동기로 처리하는 예제다.

## 목표

- 동기 API와 비동기 워커를 분리하는 감각 익히기
- `floci` endpoint `http://localhost:4566` 기준으로 큐와 토픽을 다루기

## 무엇을 만들었나

- 주문 생성 웹 UI
- 주문 상태 목록과 최근 이벤트 패널
- `aws` CLI를 내부에서 호출하는 zero-dependency Node API 서버
- SQS 폴링 워커
- queue/topic/subscription/table 생성 스크립트
- 실제 주문 생성부터 완료 상태 전이와 알림 이벤트까지 검증하는 smoke check

## 로컬 실행 순서

```bash
bash ops/bootstrap-floci.sh
bash apps/order-processing/scripts/setup.sh
node apps/order-processing/worker/worker.mjs
node apps/order-processing/api/server.mjs
```

서버가 뜨면 브라우저에서 `http://127.0.0.1:3002`로 접속한다.

## 검증

```bash
bash apps/order-processing/checks/smoke.sh
```

## 핵심 서비스

- `SQS`: 주문 처리 큐
- `SNS`: 상태 변경 알림
- `DynamoDB`: 주문 상태 저장

## endpoint 규칙

```bash
aws --profile floci --endpoint-url http://localhost:4566 sqs list-queues
aws --profile floci --endpoint-url http://localhost:4566 sns list-topics
```

이 핸즈온은 사용자 홈의 `~/.aws`를 수정하지 않고, 저장소 내부 `.aws-local/` 설정 파일을 사용한다.

## 생성되는 리소스

- 주문 큐: `order-processing-queue`
- 알림 큐: `order-processing-events`
- 알림 토픽: `order-processing-topic`
- DynamoDB table: `orders`
