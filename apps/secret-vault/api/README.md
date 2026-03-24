# secret-vault/api

현재 구현:

- `server.mjs`
  - 정적 웹 UI 제공
  - `/api/health`
  - `/api/secrets` 목록 조회
  - `/api/secrets` 생성
  - `/api/secrets/:name` 상세 조회

목록 API는 비밀 값을 그대로 노출하지 않고 마스킹된 형태만 보여준다.
