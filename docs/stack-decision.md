# 공통 스택 결정

## 결정

우선순위 3개 핸즈온의 공통 기반은 아래로 통일한다.

- Runtime: `Node.js 22`
- Language: `TypeScript`
- Workspace: `pnpm workspaces`
- Frontend: `React + Vite`
- AWS 연결 방식: `AWS SDK for JavaScript v3`를 염두에 둔 TypeScript 구조
- 로컬 AWS endpoint: `http://localhost:4566`
- AWS profile: `floci`

## 이유

- `macOS`와 `WSL Ubuntu`에서 설명과 실행이 가장 단순하다.
- 프론트와 백엔드를 같은 언어로 통일하면 입문자에게 유리하다.
- `floci`와의 연결 규칙을 모든 예제에서 동일하게 유지할 수 있다.

## 공통 규칙

모든 예제는 아래를 기본값으로 둔다.

- `AWS_ENDPOINT=http://localhost:4566`
- `AWS_DEFAULT_REGION=us-east-1`
- `AWS_ACCESS_KEY_ID=test`
- `AWS_SECRET_ACCESS_KEY=test`
- 가능하면 명령마다 `--profile floci --endpoint-url http://localhost:4566`를 명시한다.
- 기존 `~/.aws`를 건드리지 않기 위해 저장소 내부 `.aws-local/` 프로필 파일을 기본으로 사용한다.

## 아직 하지 않은 것

- 실제 의존성 설치
- 프론트엔드 번들러 설정 구체화
- 테스트 러너 설치

이 문서는 현재 스캐폴딩 기준의 의사결정 문서다. 실제 앱 구현이 시작되면 각 예제 특성에 맞춰 세부 설정을 보완한다.
