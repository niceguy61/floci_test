# 1차 실행 가능한 핸즈온

현재 이 저장소에서 실제로 실행하고 검증한 핸즈온은 아래 3개입니다.

- [이미지 업로드 갤러리](./image-gallery/README.md)
- [주문 접수와 비동기 처리](./order-processing/README.md)
- [회원가입/로그인 포털](./auth-portal/README.md)

공통 규칙:

- endpoint: `http://localhost:4566`
- profile: `floci`
- AWS config location: `.aws-local/config`, `.aws-local/credentials`
- 지원 환경: `macOS`, `WSL Ubuntu`

## 빠른 시작

```bash
bash ops/bootstrap-floci.sh
pnpm priority3:setup
```

## 전체 검증

```bash
pnpm priority3:smoke
```

## 예제별 실행

### 이미지 업로드 갤러리

```bash
bash apps/image-gallery/scripts/setup.sh
node apps/image-gallery/api/server.mjs
```

기본 주소: `http://127.0.0.1:3001`

### 주문 접수와 비동기 처리

```bash
bash apps/order-processing/scripts/setup.sh
node apps/order-processing/worker/worker.mjs
node apps/order-processing/api/server.mjs
```

기본 주소: `http://127.0.0.1:3002`

### 회원가입/로그인 포털

```bash
bash apps/auth-portal/scripts/setup.sh
node apps/auth-portal/api/server.mjs
```

기본 주소: `http://127.0.0.1:3003`

## 현재 범위

- `image-gallery`: S3 + DynamoDB
- `order-processing`: SQS + SNS + DynamoDB
- `auth-portal`: Cognito 중심 인증 bootstrap

`auth-portal`은 현재 `Cognito-first` 구현이며, `API Gateway v2 + Lambda`는 후속 확장 단계입니다.
