# 이미지 업로드 갤러리

상태: `runnable bootstrap`

이 핸즈온은 `S3 + DynamoDB` 조합으로 파일 업로드와 메타데이터 저장을 학습하는 첫 예제다.

## 목표

- `floci` endpoint `http://localhost:4566`에 연결해 S3와 DynamoDB를 사용하는 감각 익히기
- 웹 UI에서 업로드, 목록, 상세 조회 흐름 만들기

## 무엇을 만들었나

- 이미지 업로드용 간단한 웹 UI
- `aws` CLI를 내부에서 호출하는 zero-dependency Node 서버
- S3 bucket / DynamoDB table 생성 스크립트
- 실제 업로드까지 검증하는 smoke check

## 로컬 실행 순서

```bash
bash ops/bootstrap-floci.sh
bash ops/create-aws-profile.sh
bash apps/image-gallery/scripts/setup.sh
node apps/image-gallery/api/server.mjs
```

서버가 뜨면 브라우저에서 `http://127.0.0.1:3001`로 접속한다.

## 검증

```bash
bash apps/image-gallery/checks/smoke.sh
```

## 핵심 서비스

- `S3`: 이미지 원본 저장
- `DynamoDB`: 제목, 설명, S3 key 저장

## 현재 포함된 것

- 업로드/목록/상세 조회 UI
- Node API 서버
- 리소스 생성 스크립트
- smoke check

## endpoint 규칙

모든 CLI 검증은 아래 형식을 따른다.

```bash
aws --profile floci --endpoint-url http://localhost:4566 s3 ls
```

이 핸즈온은 사용자 홈의 `~/.aws`를 수정하지 않고, 저장소 내부 `.aws-local/` 설정 파일을 사용한다.

## 생성되는 리소스

- S3 bucket: `image-gallery-bucket`
- DynamoDB table: `image_metadata`
