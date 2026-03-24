# image-gallery/api

현재 구현:

- `server.mjs`
  - 정적 웹 UI 제공
  - `/api/health`
  - `/api/images` 목록 조회
  - `/api/images` 업로드
  - `/api/images/:id` 상세 조회
  - `/api/images/:id/file` 이미지 바이너리 제공

특징:

- 외부 의존성 없이 Node 내장 모듈과 `aws` CLI만 사용한다.
- `endpoint=http://localhost:4566`, `profile=floci`를 기본값으로 쓴다.
