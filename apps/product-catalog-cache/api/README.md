# Product Catalog Cache API

- `GET /api/health`: 현재 `RDS` / `ElastiCache` runtime 정보 확인
- `GET /metrics`: Prometheus scrape endpoint
- `GET /api/products?q=...`: cache-aside 검색
- `GET /api/products/:sku`: 단건 조회
- `POST /api/products`: 상품 생성/수정 후 캐시 비우기
