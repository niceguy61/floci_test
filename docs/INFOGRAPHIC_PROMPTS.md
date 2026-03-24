# GPT Infographic Prompts For Hands-ons

이 문서는 각 hands-on의 `workflow.svg`를 GPT 기반 이미지 생성으로 다시 만들기 위한 프롬프트 모음입니다.

## 공통 스타일 규칙

아래 규칙은 모든 hands-on 공통입니다.

- 출력 목적: GitHub README에 들어갈 **가로형 SVG 또는 PNG 인포그래피**
- 비율: `16:9` 또는 `4:1`
- 배경: 흰색
- 스타일: 깔끔한 기술 인포그래피, 과도한 장식 금지
- 요소:
  - User
  - Web UI
  - API
  - AWS services
  - Output / Result
- 텍스트는 짧고 읽기 쉬워야 함
- 아이콘 느낌은 좋지만, 정보가 우선
- 초보자가 **5초 안에 흐름을 읽을 수 있어야 함**
- 색상은 최대 4~5색
- 박스와 화살표는 명확하게
- 한 화면에 너무 많은 설명문 금지

## Prompt: image-gallery

Create a clean horizontal architecture infographic for a beginner-friendly AWS hands-on called "Image Gallery". Show this exact flow: User/Browser -> Web UI -> API Server -> S3 (original image, resized display image, thumbnail) and DynamoDB (metadata). Add short labels for "original", "display", "thumbnail", and "metadata". Make it look like a polished technical infographic for GitHub README, white background, readable typography, minimal but clear icons, subtle color coding by service type, simple arrows, no dark mode, no extra decorative noise.

## Prompt: order-processing

Create a clean horizontal architecture infographic for a beginner-friendly AWS hands-on called "Order Processing". Show this exact flow: User -> Web UI -> API Server -> DynamoDB (order state) + SQS Queue -> Worker -> DynamoDB update + SNS Topic -> Event Queue. Make the async boundary visually obvious. Style: modern technical infographic, white background, concise labels, readable GitHub README graphic, simple icons, pastel service colors, no clutter.

## Prompt: auth-portal

Create a clean horizontal architecture infographic for a beginner-friendly AWS hands-on called "Auth Portal". Show this exact flow: User -> Signup/Login UI -> Auth API -> Cognito User Pool / App Client -> Access Token -> Protected Profile. This is a Cognito-first flow, not full API Gateway/Lambda production architecture. Make signup, confirm, login, and token-based profile access visually clear. White background, concise labels, clear arrows, GitHub README friendly infographic style.

## Prompt: todo-logs

Create a clean horizontal architecture infographic for a beginner-friendly AWS hands-on called "Todo Logs". Show this exact flow: User -> Todo UI -> API Server -> DynamoDB (todo state) and CloudWatch Logs (activity trail). Highlight that CRUD state and operational logs are separate. White background, minimal AWS-style infographic, easy to read, suitable for GitHub README.

## Prompt: alert-center

Create a clean horizontal architecture infographic for a beginner-friendly AWS hands-on called "Alert Center". Show this exact flow: User -> Alert UI -> API Server -> SNS Topic -> Subscriber Queue A and Subscriber Queue B. Emphasize fan-out: one publish, two subscribers. White background, simple arrows, soft service colors, very readable technical infographic for GitHub README.

## Prompt: file-pipeline

Create a clean horizontal architecture infographic for a beginner-friendly AWS hands-on called "File Pipeline". Show this exact flow: User -> Upload UI -> API Server -> S3 (original file), DynamoDB (job state), SQS Queue -> Worker -> DynamoDB status updated to completed. Emphasize queued processing and status transitions. White background, modern infographic style, concise labels, GitHub README friendly.

## Prompt: secret-vault

Create a clean horizontal architecture infographic for a beginner-friendly AWS hands-on called "Secret Vault". Show this exact flow: User -> Secret UI -> API Server -> KMS Key reference + Secrets Manager store -> masked list view and detailed value view. Highlight that list view is masked and detail view reveals the secret. White background, minimal secure-looking infographic, clean labels, GitHub README ready.

## Prompt: feature-flags

Create a clean horizontal architecture infographic for a beginner-friendly AWS hands-on called "Feature Flags". Show this exact flow: User -> Feature Flag UI -> API Server -> SSM Parameter Store -> list / read / overwrite flag values. Highlight path-based config storage like /app/flags/*. White background, simple technical infographic, concise labels, suitable for GitHub README.

## Prompt: stream-inspector

Create a clean horizontal architecture infographic for a beginner-friendly AWS hands-on called "Stream Inspector". Show this exact flow: User -> Publish UI -> API Server -> Kinesis Stream -> shard iterator -> read back recent records. Highlight partition key, sequence number, and read-back inspection. White background, clean AWS-style infographic, minimal clutter, GitHub README friendly.

## Prompt: cloudformation-playground

Create a clean horizontal architecture infographic for a beginner-friendly AWS hands-on called "CloudFormation Playground". Show this exact flow: User -> Stack UI -> API Server -> CloudFormation Stack -> S3 Bucket resource. Highlight template-based infrastructure creation and stack status tracking. White background, technical infographic style, easy to scan, suitable for GitHub README.
