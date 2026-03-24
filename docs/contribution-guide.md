# 핸즈온 추가 가이드

새 핸즈온을 추가할 때는 아래 순서를 따른다.

1. `apps/<slug>/` 디렉터리를 만든다.
2. `README.md`를 `templates/HANDSON_TEMPLATE.md` 기준으로 채운다.
3. `web`, `api`, 필요 시 `worker` 또는 `auth` 디렉터리를 만든다.
4. `scripts/setup.sh`에 리소스 생성 절차를 넣는다.
5. `checks/smoke.sh`에 endpoint와 profile이 명시된 검증 절차를 넣는다.
6. 루트 `README.md`의 관련 섹션에 핸즈온 링크를 연결한다.

기본 연결 규칙:

- endpoint: `http://localhost:4566`
- profile: `floci`
- isolated aws config: `.aws-local/config`, `.aws-local/credentials`
- region: `us-east-1`

금지:

- `PowerShell` 또는 `CMD` 전용 절차 추가
- 실제 AWS 계정을 기본 전제로 하는 설명
- `--endpoint-url` 누락
