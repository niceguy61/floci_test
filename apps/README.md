# Hands-on Index

이 디렉터리는 `floci`를 이용해 AWS 핵심 서비스 감각을 익히는 **실행 가능한 hands-on 11개**를 담고 있습니다.  
대상은 아래와 같습니다.

- AWS를 처음 배우는 개발자
- 백엔드 개발자
- `macOS` 또는 `WSL Ubuntu`에서 로컬 AWS 실습을 반복하고 싶은 사람

## 현재 포함된 hands-on

| 이름 | 서비스 조합 | 기본 주소 | 핵심 학습 포인트 |
|---|---|---|---|
| [이미지 업로드 갤러리](./image-gallery/README.md) | `S3 + DynamoDB` | `http://127.0.0.1:3001` | 객체 저장, 메타데이터 분리, 리사이즈, thumbnail |
| [주문 접수와 비동기 처리](./order-processing/README.md) | `SQS + SNS + DynamoDB` | `http://127.0.0.1:3002` | 큐 기반 비동기 처리, fan-out |
| [회원가입/로그인 포털](./auth-portal/README.md) | `Cognito` 중심 | `http://127.0.0.1:3003` | 회원가입, 확인, 로그인, 보호된 프로필 |
| [할 일 관리 API + 상태 로그](./todo-logs/README.md) | `DynamoDB + CloudWatch Logs` | `http://127.0.0.1:3004` | CRUD + 운영 로그 |
| [알림 센터](./alert-center/README.md) | `SNS + SQS` | `http://127.0.0.1:3005` | fan-out 메시징 |
| [파일 처리 파이프라인](./file-pipeline/README.md) | `S3 + SQS + DynamoDB` | `http://127.0.0.1:3006` | 업로드 후 비동기 처리 |
| [비밀 보관함](./secret-vault/README.md) | `Secrets Manager + KMS` | `http://127.0.0.1:3007` | 비밀 저장, 마스킹, 조회 |
| [기능 플래그 대시보드](./feature-flags/README.md) | `SSM Parameter Store` | `http://127.0.0.1:3008` | 설정값과 feature flag 관리 |
| [스트림 인스펙터](./stream-inspector/README.md) | `Kinesis` | `http://127.0.0.1:3009` | stream write / read / shard iterator |
| [CloudFormation Playground](./cloudformation-playground/README.md) | `CloudFormation + S3` | `http://127.0.0.1:3010` | IaC, stack 상태 추적 |
| [상품 카탈로그 캐시](./product-catalog-cache/README.md) | `RDS + ElastiCache` | `http://127.0.0.1:3011` | cache-aside, cache hit / miss, 데이터 원본과 캐시 분리 |

## 지원 환경

### 지원함

- `macOS`
- `Windows + WSL Ubuntu`

### 지원하지 않음

- `Windows CMD`
- `Windows PowerShell`

이 저장소의 스크립트와 설명은 모두 `bash` 기준입니다.

## 반드시 필요한 소프트웨어

아래는 hands-on을 실행하기 위한 최소 요구사항입니다.

| 소프트웨어 | 권장 버전 | 왜 필요한가 |
|---|---|---|
| Docker | `20.10+` | `floci` 컨테이너 실행 |
| Docker Compose | `v2+` | `floci` 실행 및 재기동 |
| Node.js | `22+` | 각 hands-on API 서버 실행 |
| npm | Node와 함께 설치 | 루트 스크립트 실행과 `sharp` 같은 로컬 의존성 설치 |
| AWS CLI v2 | 최신 버전 권장 | `floci` endpoint 호출 |
| Git | 최신 버전 권장 | 저장소 관리 |
| curl | 최신 버전 권장 | health check, smoke 보조 |

## macOS 설치 가이드

### 1. Homebrew 설치

아직 Homebrew가 없다면:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Docker Desktop 설치

```bash
brew install --cask docker
```

그 다음 Docker Desktop을 한 번 직접 열어서 실행 상태로 둡니다.

### 3. Node.js 설치

```bash
brew install node
```

설치 확인:

```bash
node -v
npm -v
```

### 4. AWS CLI 설치

```bash
brew install awscli
```

설치 확인:

```bash
aws --version
```

## WSL Ubuntu 설치 가이드

### 1. 필수 패키지 설치

```bash
sudo apt update
sudo apt install -y curl unzip ca-certificates gnupg lsb-release git
```

### 2. Docker 준비

가장 쉬운 경로는 **Docker Desktop + WSL Integration**입니다.

1. Windows에 Docker Desktop 설치
2. Docker Desktop 설정에서 `WSL Integration` 활성화
3. WSL Ubuntu 터미널에서 확인:

```bash
docker --version
docker compose version
```

### 3. Node.js 22 설치

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

설치 확인:

```bash
node -v
npm -v
```

### 4. AWS CLI 설치

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
unzip /tmp/awscliv2.zip -d /tmp
sudo /tmp/aws/install
```

설치 확인:

```bash
aws --version
```

## 저장소 초기화

루트에서 한 번만 실행합니다.

```bash
npm install
```

이 단계는 현재 `image-gallery`에서 사용하는 `sharp` 설치를 포함합니다.

## hands-on을 시작하기 전에 공통으로 할 것

### 1. floci 실행

```bash
bash ops/bootstrap-floci.sh
```

### 2. 로컬 AWS profile 준비

```bash
bash ops/create-aws-profile.sh
```

이 스크립트는 실제 `~/.aws` 대신 저장소 내부 `.aws-local/`에 프로필을 만듭니다.

### 3. 기본 연결 확인

```bash
bash ops/verify-floci.sh
```

### 4. endpoint 규칙 기억하기

모든 CLI 명령은 아래 규칙을 따릅니다.

- endpoint: `http://localhost:4566`
- profile: `floci`
- 권장 실행기: `bash ops/aws-local.sh`

예:

```bash
bash ops/aws-local.sh s3 ls
bash ops/aws-local.sh dynamodb list-tables
```

## 전체 검증

가장 먼저 만든 3개 hands-on을 한 번에 검증하려면:

```bash
npm run priority3:setup
npm run priority3:smoke
```

기존 10개를 한 번에 준비/검증하려면:

```bash
npm run all10:setup
npm run all10:smoke
```

새 `RDS + ElastiCache` 예제까지 포함한 11개 전체 준비/검증:

```bash
npm run all11:setup
npm run all11:smoke
```

개별 hands-on은 각 폴더 README에 있는 `setup` / `smoke`를 실행합니다.

## 초보자가 이해하기 쉽게 보는 방법

추천 순서:

1. [이미지 업로드 갤러리](./image-gallery/README.md)
2. [주문 접수와 비동기 처리](./order-processing/README.md)
3. [회원가입/로그인 포털](./auth-portal/README.md)
4. [할 일 관리 API + 상태 로그](./todo-logs/README.md)
5. [알림 센터](./alert-center/README.md)
6. [파일 처리 파이프라인](./file-pipeline/README.md)
7. [비밀 보관함](./secret-vault/README.md)
8. [기능 플래그 대시보드](./feature-flags/README.md)
9. [스트림 인스펙터](./stream-inspector/README.md)
10. [CloudFormation Playground](./cloudformation-playground/README.md)
11. [상품 카탈로그 캐시](./product-catalog-cache/README.md)

## 현재 보류된 고급 예제

- `EventBridge + Lambda 이벤트 파이프라인`
  - 여전히 runnable hands-on으로는 보류입니다.

기존에 이 섹션에 있던 `RDS + ElastiCache 상품 검색 캐시 예제`는 이제
[상품 카탈로그 캐시](./product-catalog-cache/README.md)로 구현되었습니다.

- 추가 조건:
  - `RDS + ElastiCache`를 실제로 띄우므로 `docker.sock` 접근 권한과 추가 포트 노출이 필요합니다.
  - 현재 저장소의 [ops/docker-compose.floci.yml](/mnt/d/github/floci_test/ops/docker-compose.floci.yml#L1)은 이를 반영합니다.
