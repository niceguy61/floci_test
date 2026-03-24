# floci 모니터링 요약

이 문서는 `floci`를 Docker 환경에서 실행할 때 어떤 방식으로 상태를 모니터링할지 정리한 메모입니다.  
현재 공개된 `floci` 공식 문서 기준으로는 전용 모니터링 대시보드나 Prometheus endpoint 문서가 보이지 않습니다. 따라서 아래 내용은 다음 두 층으로 나눠 읽는 것이 정확합니다.

- 공식 문서/소스에서 확인된 사실
- 그 사실을 바탕으로 한 운영 권장사항

## 1. 공식적으로 확인된 내용

### 1.1 실행 구조

공식 문서 기준 `floci`는 기본적으로 다음 포트를 중심으로 동작합니다.

- `4566`: 모든 AWS API 호출용 HTTP 포트
- `6379-6399`: ElastiCache Redis proxy 포트 범위
- `7001-7099`: RDS proxy 포트 범위

즉, 대부분의 관리 평면 호출은 `http://localhost:4566` 하나로 들어갑니다.

### 1.2 공식 문서가 직접 설명하는 운영 방식

현재 공개 문서에서 직접 확인되는 운영 방식은 주로 다음입니다.

- Docker / Docker Compose 기반 실행
- AWS CLI / SDK를 `endpoint-url` 또는 endpoint override로 `4566`에 연결
- 저장 모드 설정
- 서비스별 포트 노출 설정

### 1.3 공식 문서에서 찾지 못한 항목

제가 확인한 공식 문서 및 공개 저장소 기준으로는 다음 항목을 찾지 못했습니다.

- `floci` 전용 Web UI / 관리 콘솔 문서
- Prometheus scrape endpoint 문서
- Grafana 대시보드 문서
- Kubernetes 배포 가이드, Helm chart, Operator 문서

또한 공개 저장소의 `pom.xml`에서도 `prometheus`, `micrometer`, `quarkus-smallrye-health` 같은 의존성은 확인되지 않았습니다.  
이 말은 "절대 없다"는 뜻은 아니고, 적어도 현재 공개 자료 기준으로는 공식적으로 안내된 내장 모니터링 기능을 찾지 못했다는 뜻입니다.

## 2. 결론적으로 어떻게 모니터링해야 하나

`floci`는 현재 기준으로 "자체 모니터링 UI를 제공하는 제품"보다는, "로컬 AWS 에뮬레이터 컨테이너"로 보는 편이 맞습니다.  
따라서 모니터링도 `floci` 자체보다 **컨테이너 상태 + 로그 + 포트 가용성 + 합성 트랜잭션(synthetic check)** 중심으로 잡는 것이 현실적입니다.

추천 우선순위:

1. 컨테이너 생존 여부
2. `4566` 포트 응답 여부
3. 실제 AWS API 호출이 성공하는지
4. Redis/RDS proxy 포트가 필요한 경우 해당 포트도 확인
5. 로그 수집 및 오류 패턴 감시

## 3. Docker에서의 모니터링

### 3.1 가장 기본적인 체크

Docker 환경에서 최소한 아래 항목은 봐야 합니다.

- 컨테이너가 떠 있는지
- 재시작이 반복되는지
- `4566` 포트가 열려 있는지
- 로그에 예외가 반복되는지
- persistent 모드라면 데이터 디렉터리 사용량이 비정상적으로 커지지 않는지

예시 명령:

```bash
docker compose ps
docker compose logs -f floci
docker inspect floci --format '{{.State.Status}} {{.RestartCount}}'
ss -ltnp | rg '4566|6379|7001'
```

### 3.2 가장 현실적인 상태 확인: 합성 트랜잭션

단순 포트 체크만으로는 "프로세스는 살아 있지만 AWS API가 실제로 안 되는 상태"를 놓칠 수 있습니다.  
그래서 가장 현실적인 체크는 AWS CLI로 짧은 호출을 하나 날려 보는 것입니다.

예시:

```bash
AWS_ACCESS_KEY_ID=test \
AWS_SECRET_ACCESS_KEY=test \
AWS_DEFAULT_REGION=us-east-1 \
aws --endpoint-url http://localhost:4566 sts get-caller-identity
```

또는 서비스별로 더 직접적인 체크를 할 수도 있습니다.

```bash
AWS_ACCESS_KEY_ID=test \
AWS_SECRET_ACCESS_KEY=test \
AWS_DEFAULT_REGION=us-east-1 \
aws --endpoint-url http://localhost:4566 s3 ls
```

이런 체크가 통과하면 최소한 다음은 확인할 수 있습니다.

- `floci` 프로세스가 살아 있다
- `4566` 포트가 응답한다
- AWS request/response 경로가 실제로 동작한다

### 3.3 Docker 관점 권장 조합

실무적으로는 아래 정도면 충분합니다.

- `docker compose logs -f` 또는 Loki/Fluent Bit로 로그 수집
- 외부 probe 스크립트로 `sts get-caller-identity` 같은 합성 체크 수행
- 필요 시 Portainer 또는 Docker Desktop으로 컨테이너 상태 시각화

## 4. Web UI 관점에서는 무엇을 쓰나

현재 공개 자료 기준으로는 `floci` 자체의 Web UI는 찾지 못했습니다.  
따라서 "floci 전용 UI"를 기대하기보다, 실행 환경의 UI를 붙이는 방식이 맞습니다.

- Docker Desktop
- Portainer
- Grafana + Loki / Prometheus

즉, Web UI는 `floci`가 제공하는 것이 아니라 **주변 운영 도구가 제공**한다고 보는 편이 정확합니다.

## 5. 어떤 지표를 보면 좋은가

내장 애플리케이션 메트릭이 공식적으로 문서화되지 않았기 때문에, 처음에는 아래 정도만 잡아도 충분합니다.

- 컨테이너 up/down
- restart count
- CPU / Memory
- 로그 에러 수
- `4566` 응답 여부
- `sts get-caller-identity` 성공 여부
- `s3 ls`, `sqs list-queues`, `dynamodb list-tables` 같은 주요 서비스 합성 체크 성공 여부
- Redis/RDS proxy 포트 연결 가능 여부
- persistent 모드 사용 시 디스크 사용량

## 6. 최소 권장 운영 패턴

### 로컬 Docker 개발 환경

- `docker compose logs -f floci`
- `4566` 포트 체크
- `aws --endpoint-url ... sts get-caller-identity` 합성 체크

### 팀 공용 개발 서버 / CI

- 컨테이너 로그 중앙 수집
- 주기적 합성 체크
- restart count / 포트 불능 알림

## 7. 왜 Kubernetes는 여기서 다루지 않나

현재 공개 자료 기준으로는 `floci`의 Kubernetes 전용 공식 배포/운영 문서를 찾지 못했습니다.  
그래서 이 문서는 문서 신뢰도를 유지하기 위해 Kubernetes 운영 패턴을 본문 범위에서 제외하고, 공식 경로인 Docker 중심으로만 정리합니다.

즉, 지금 단계에서는 다음처럼 이해하는 편이 정확합니다.

- Docker / Docker Compose: 공식 문서 기반 운영 가능
- Kubernetes: 가능성은 열려 있지만 공식 운영 가이드 부재

## 8. 요약

현재 기준으로 `floci` 모니터링의 핵심은 아래 한 줄로 정리할 수 있습니다.

> `floci` 자체의 전용 모니터링 UI를 기대하기보다, 컨테이너 상태, 로그, 포트, 합성 AWS API 체크를 중심으로 감시하는 것이 가장 현실적입니다.

Docker에서는 `docker logs + synthetic check`가 기본입니다.

## 참고 자료

- Floci 홈: https://hectorvent.dev/floci/
- Floci AWS CLI / SDK Setup: https://hectorvent.dev/floci/getting-started/aws-setup/
- Floci Docker Compose 설정: https://hectorvent.dev/floci/configuration/docker-compose/
- Floci Ports Reference: https://hectorvent.dev/floci/configuration/ports/
- Floci GitHub 저장소: https://github.com/hectorvent/floci
