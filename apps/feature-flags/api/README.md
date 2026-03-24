# feature-flags/api

현재 구현:

- `server.mjs`
  - 정적 웹 UI 제공
  - `/api/health`
  - `/api/flags` 목록 조회
  - `/api/flags` 생성/수정
  - `/api/flags/:name` 단건 조회

모든 플래그는 `/app/flags/` prefix 아래에 저장한다.
