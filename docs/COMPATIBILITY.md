# AWS Native vs floci Compatibility

이 문서는 `AWS native`와 `floci`의 차이를 서비스별로 분리해 정리한 문서입니다.

핵심 원칙:

- `AWS native`는 기본 endpoint와 기본 자격증명 흐름을 사용합니다.
- `floci`는 기본적으로 `http://localhost:4566` endpoint와 `floci` profile 또는 `.aws-local` 설정을 전제로 합니다.
- `공식 문서상 지원`과 `현재 이 저장소에서 runnable`은 다를 수 있습니다.

## 공통 CLI 차이

### AWS native

```bash
aws s3 ls
aws dynamodb list-tables
```

### floci

```bash
aws --profile floci --endpoint-url http://localhost:4566 s3 ls
aws --profile floci --endpoint-url http://localhost:4566 dynamodb list-tables
```

저장소에서는 더 안전하게 아래 wrapper를 권장합니다.

```bash
bash ops/aws-local.sh s3 ls
bash ops/aws-local.sh dynamodb list-tables
```

이유:

- 사용자 홈 `~/.aws`가 깨져 있어도 영향을 덜 받음
- `endpoint`, `profile`, `.aws-local` 경로를 자동으로 맞춤

## 서비스별 비교

| 서비스 | AWS native에서 보통 | floci에서 현재 상태 | 명령 차이 | 비고 |
|---|---|---|---|---|
| S3 | 기본 endpoint, 일반 bucket/object 사용 | runnable | `--profile floci --endpoint-url http://localhost:4566` 필요 | path-style URL 감안 필요 |
| DynamoDB | 기본 endpoint, 테이블/아이템 조회 | runnable | 동일 | hands-on에서 메타데이터/상태 저장용으로 사용 |
| SQS | 기본 endpoint, queue 사용 | runnable | 동일 | queue URL이 `localhost:4566` 기준으로 나옴 |
| SNS | 기본 endpoint, topic publish | runnable | 동일 | fan-out hands-on에서 사용 |
| Cognito | 일반 confirmation/login 흐름 | runnable with caveat | 동일 | 현재 hands-on은 `confirm-sign-up 123456` 경로 사용 |
| CloudWatch Logs | 일반 로그 그룹/스트림 | runnable | 동일 | `todo-logs`에서 사용 |
| Secrets Manager | 일반 비밀 저장/조회 | runnable | 동일 | `secret-vault`에서 사용 |
| KMS | 일반 key 생성/조회 | runnable | 동일 | `secret-vault`에서 사용 |
| SSM Parameter Store | 일반 파라미터 저장/조회 | runnable | 동일 | `feature-flags`에서 사용 |
| Kinesis | stream 생성/put/get | runnable | 동일 | `stream-inspector`에서 사용 |
| CloudFormation | stack 생성/조회 | runnable | 동일 | `cloudformation-playground`에서 사용 |
| Lambda | AWS runtime이 실제 실행 | 문서상 지원, 현재 환경에선 보류 | 동일 | 현재 환경에서 runtime container가 `Permission denied` |
| EventBridge | 문서상 API 지원 | 설계/보류 | 동일 | Lambda와 함께 실습하는 경로는 현재 보류 |
| RDS | 문서상 API 지원 | 보류 | 동일 | `create-db-instance`가 현재 환경에선 `BindException` |
| ElastiCache | 문서상 API 지원 | 보류 | `create-cache-cluster` 아님, `create-replication-group` 경로 | 현재 환경에선 replication group 생성도 실패 |

## 현재 runnable hands-on과 사용 서비스

| Hands-on | 핵심 서비스 |
|---|---|
| `image-gallery` | `S3`, `DynamoDB` |
| `order-processing` | `SQS`, `SNS`, `DynamoDB` |
| `auth-portal` | `Cognito` |
| `todo-logs` | `DynamoDB`, `CloudWatch Logs` |
| `alert-center` | `SNS`, `SQS` |
| `file-pipeline` | `S3`, `SQS`, `DynamoDB` |
| `secret-vault` | `Secrets Manager`, `KMS` |
| `feature-flags` | `SSM Parameter Store` |
| `stream-inspector` | `Kinesis` |
| `cloudformation-playground` | `CloudFormation`, `S3` |

## 보류된 고급 예제

### 1. EventBridge + Lambda

- 공식 문서상 지원 서비스
- 현재 환경에서는 Lambda runtime container 기동 단계가 막힘
- 즉, 문서형 예제로는 가능하지만 runnable hands-on은 보류

### 2. RDS + ElastiCache 상품 검색 캐시

- 공식 문서상 지원 서비스
- 하지만 현재 환경에서:
  - `RDS create-db-instance`: `java.net.BindException: Permission denied`
  - `ElastiCache create-replication-group`: 생성 실패
- 포트는 열려 있어도 backend 서비스가 실제로 붙지 않는 상태로 확인됨

## 추천 읽는 순서

1. 루트 [README.md](/mnt/d/github/floci_test/README.md)
2. [apps/README.md](/mnt/d/github/floci_test/apps/README.md)
3. 이 문서
4. 각 hands-on README

## 한 줄 결론

`floci`는 `AWS native`와 똑같이 쓰는 도구가 아니라, `endpoint/profile/runtime 차이를 이해하고 쓰는 로컬 AWS 학습 환경`입니다.
