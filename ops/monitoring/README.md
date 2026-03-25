# Monitoring Stack

이 디렉터리는 `floci` hands-on 앱을 `Grafana + Prometheus + Loki + Promtail`로 관찰하는 공용 로컬 모니터링 설정입니다.

현재 공용 규약을 적용한 앱:

- `image-gallery`
- `order-processing`
- `auth-portal`
- `alert-center`
- `file-pipeline`
- `product-catalog-cache`
- `secret-vault`
- `feature-flags`
- `stream-inspector`
- `todo-logs`
- `cloudformation-playground`

- `Prometheus`: 앱 `/metrics` 스크레이프
- `floci exporter`: AWS local service 상태를 Prometheus 형식으로 노출
- `Loki`: 앱 JSON 로그 저장
- `Promtail`: `apps/*/.runtime/*.log` tail
- `Grafana`: 두 데이터소스를 자동 프로비저닝

서비스 메트릭 exporter:

- URL: `http://127.0.0.1:9464/metrics`
- health: `http://127.0.0.1:9464/health`

기본 포트:

- `Grafana`: `http://127.0.0.1:3012`
- `Prometheus`: `http://127.0.0.1:9091`
- `Loki`: `http://127.0.0.1:3101`
