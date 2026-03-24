# 회원가입/로그인 포털

상태: `runnable bootstrap (Cognito-first)`

이 핸즈온은 `Cognito + API Gateway v2 + Lambda` 조합으로 인증된 웹 앱 흐름을 학습하는 예제다.

## 목표

- 회원가입, 로그인, 보호된 API 호출의 기본 감각 익히기
- `floci` endpoint `http://localhost:4566` 기준으로 인증 관련 리소스 접근 규칙 익히기

## 무엇을 만들었나

- 회원가입 / 로그인 / 프로필 확인 웹 UI
- `aws` CLI를 내부에서 호출하는 zero-dependency Node API 서버
- Cognito user pool / app client 생성 스크립트
- 회원가입 -> 관리자 확인 -> 로그인 -> 보호된 프로필 조회까지 검증하는 smoke check

## 현재 구현 범위

이번 bootstrap은 `Cognito` 인증 흐름을 실제로 끝까지 검증하는 데 초점을 둔다.

- 실제로 동작하는 것: `Cognito`
- 다음 단계로 남겨둔 것: `API Gateway v2`, `Lambda`를 실제 리소스로 연결하는 확장
- 현재 확인된 confirmation code 흐름: `confirm-sign-up` with `123456`

즉, 학습 포인트는 유지하되, 가장 불확실한 계층은 후속 단계로 분리했다.

## 로컬 실행 순서

```bash
bash ops/bootstrap-floci.sh
bash apps/auth-portal/scripts/setup.sh
node apps/auth-portal/api/server.mjs
```

서버가 뜨면 브라우저에서 `http://127.0.0.1:3003`으로 접속한다.

## 검증

```bash
bash apps/auth-portal/checks/smoke.sh
```

## 핵심 서비스

- `Cognito`: 사용자 인증
- `API Gateway v2`: 외부 API 진입점
- `Lambda`: 보호된 API 처리

## 주의

`Lambda`가 포함되므로 루트 `ops/docker-compose.floci.yml`의 Docker socket 마운트와 포트 설정을 그대로 유지해야 한다.

## endpoint 규칙

모든 CLI 검증은 아래 형식을 따른다.

```bash
aws --profile floci --endpoint-url http://localhost:4566 cognito-idp list-user-pools --max-results 10
```

이 핸즈온은 사용자 홈의 `~/.aws`를 수정하지 않고, 저장소 내부 `.aws-local/` 설정 파일을 사용한다.
