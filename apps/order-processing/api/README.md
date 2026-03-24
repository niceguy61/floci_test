# order-processing/api

현재 구현:

- `server.mjs`
  - 정적 웹 UI 제공
  - `/api/health`
  - `/api/orders` 목록 조회
  - `/api/orders` 주문 생성
  - `/api/orders/:id` 상세 조회
  - `/api/events` 최근 SNS fan-out 이벤트 조회

특징:

- 외부 의존성 없이 Node 내장 모듈과 `aws` CLI만 사용한다.
- `endpoint=http://localhost:4566`, `profile=floci`를 기본값으로 쓴다.
