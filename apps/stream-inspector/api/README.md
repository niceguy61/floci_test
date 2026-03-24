# stream-inspector/api

현재 구현:

- `server.mjs`
  - 정적 웹 UI 제공
  - `/api/health`
  - `/api/stream`
  - `/api/records` 발행
  - `/api/records` 조회

조회 API는 shard iterator를 내부에서 계산해 가장 앞부터 최근 레코드를 읽는다.
