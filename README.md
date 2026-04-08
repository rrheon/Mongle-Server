# 몽글 서버 (Mongle Server)

> 가족이 매일 하나의 질문에 함께 답하며 서로를 더 깊이 알아가는 가족 소통 앱 **몽글**의 백엔드 API 서버

---

## 현재 상태

| 항목 | 상태 |
|------|------|
| 로컬 개발 환경 | ✅ 완료 |
| PostgreSQL 연결 | ✅ 완료 |
| API 구현 | ✅ 완료 |
| Swagger 문서 | ✅ 완료 |
| iOS 앱 연동 | ✅ 완료 |
| Android 앱 연동 | ✅ 완료 |
| AWS 배포 (Lambda + API Gateway) | ✅ 완료 (dev stage) |
| 커스텀 도메인 | ⏳ 대기 (monggle.app 미보유) |

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express + tsoa (Swagger 자동 생성) |
| Database | PostgreSQL + Prisma ORM |
| 인증 | JWT (Access/Refresh Token) + 소셜 로그인 (Apple/Kakao/Google) |
| 배포 | AWS Lambda + API Gateway (Serverless Framework) |
| API 문서 | Swagger/OpenAPI 3.0 (자동 생성) |

---

## 로컬 개발 환경

### 서버 시작

```bash
cd /Users/yong/Desktop/MongleServer

# 개발 모드 (자동 재시작)
npm run dev

# 또는 빌드 후 실행
npm run build && node dist/app.js
```

### 서버 중지

```bash
pkill -f "node dist/app.js"
```

### API 테스트

```bash
# Health Check
curl http://localhost:3000/health

# Swagger UI
open http://localhost:3000/docs
```

---

## 프로젝트 구조

```
MongleServer/
├── src/
│   ├── controllers/      # API 엔드포인트 (9개)
│   │   ├── HealthController.ts
│   │   ├── AuthController.ts
│   │   ├── UserController.ts
│   │   ├── FamilyController.ts
│   │   ├── QuestionController.ts
│   │   ├── AnswerController.ts
│   │   ├── MoodController.ts
│   │   ├── NotificationController.ts
│   │   └── NudgeController.ts
│   ├── services/         # 비즈니스 로직 (9개)
│   ├── models/           # Request/Response DTO
│   ├── middleware/       # 인증(JWT), 에러 핸들러
│   ├── utils/            # Prisma, JWT, 초대코드 생성
│   ├── routes/           # tsoa 자동 생성 라우트
│   ├── app.ts            # Express 앱 설정
│   └── lambda.ts         # AWS Lambda 핸들러
├── prisma/
│   ├── schema.prisma     # DB 스키마 (8개 테이블)
│   └── seed.ts           # 시드 데이터 (36개 질문)
├── docs/
│   ├── PROJECT_PLAN.md
│   ├── AWS_SETUP.md
│   └── API_SPEC.md
├── serverless.yml        # Serverless 배포 설정
├── tsoa.json             # Swagger 생성 설정
└── package.json
```

---

## 데이터베이스 스키마

| 테이블 | 설명 |
|--------|------|
| `users` | 사용자 계정 (하트 잔액 포함) |
| `families` | 가족 그룹 (초대코드) |
| `questions` | 질문 뱅크 (6가지 카테고리) |
| `daily_questions` | 가족별 오늘의 질문 |
| `answers` | 사용자 답변 |
| `notifications` | 알림 목록 |
| `mood_records` | 일별 기분 기록 |
| `user_access_logs` | 접속 기록 |

---

## API 엔드포인트

### 인증 (Auth)

| Method | Path | 설명 |
|--------|------|------|
| POST | `/auth/social` | 소셜 로그인 (Apple/Kakao/Google) |
| POST | `/auth/refresh` | 토큰 갱신 |
| DELETE | `/auth/account` | 계정 삭제 |

### 사용자 (Users)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/users/me` | 내 정보 조회 |
| PUT | `/users/me` | 내 정보 수정 |
| GET | `/users/me/streak` | 연속 답변 스트릭 |
| GET | `/users/{userId}` | 특정 유저 조회 |

### 가족 (Families)

| Method | Path | 설명 |
|--------|------|------|
| POST | `/families` | 가족 그룹 생성 |
| POST | `/families/join` | 초대코드로 참여 |
| GET | `/families/my` | 내 가족 조회 |
| GET | `/families/{id}` | 가족 상세 조회 |
| GET | `/families/{id}/members` | 가족 구성원 목록 |
| DELETE | `/families/leave` | 가족 탈퇴 |
| DELETE | `/families/members/{memberId}` | 구성원 내보내기 (방장 전용) |

### 질문 (Questions)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/questions/today` | 오늘의 질문 조회 |
| POST | `/questions/skip` | 질문 넘기기 (하트 1개 차감) |
| GET | `/questions/date/{date}` | 날짜별 질문 조회 |
| GET | `/questions/{id}` | 질문 상세 |
| GET | `/questions` | 질문 히스토리 (페이지네이션) |
| POST | `/questions/custom` | 나만의 질문 작성 (하트 3개 차감) |

### 답변 (Answers)

| Method | Path | 설명 |
|--------|------|------|
| POST | `/answers` | 답변 작성 (하트 +1) |
| GET | `/answers/my/{questionId}` | 내 답변 조회 |
| GET | `/answers/family/{questionId}` | 가족 답변 목록 |
| PUT | `/answers/{id}` | 답변 수정 |
| DELETE | `/answers/{id}` | 답변 삭제 |

### 알림 (Notifications)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/notifications` | 알림 목록 |
| PATCH | `/notifications/{id}/read` | 읽음 처리 |
| PATCH | `/notifications/read-all` | 전체 읽음 처리 |

### 기분 (Moods)

| Method | Path | 설명 |
|--------|------|------|
| POST | `/moods` | 오늘의 기분 저장 (upsert) |
| GET | `/moods?days=14` | 기분 히스토리 조회 |

### 재촉하기 (Nudge)

| Method | Path | 설명 |
|--------|------|------|
| POST | `/nudge` | 가족에게 재촉 알림 (하트 1개 차감) |

### 초대 링크 랜딩 (Static HTML)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/join/:code` | 초대 코드 랜딩 페이지. 로드 즉시 `monggle://join/{code}` 커스텀 스킴으로 자동 전환하여 설치된 앱을 연다 (커스텀 도메인 미보유 상태의 임시 경로) |
| GET | `/.well-known/apple-app-site-association` | iOS Universal Link용 AASA 파일 (도메인 확보 후 활성화 예정) |
| GET | `/.well-known/assetlinks.json` | Android App Link 검증용 (도메인 확보 후 활성화 예정) |

---

## 하트 시스템

| 이벤트 | 변화 |
|--------|------|
| 답변 작성 | +1 |
| 하루 첫 접속 | +1 |
| 질문 넘기기 | -1 |
| 나만의 질문 작성 | -3 |
| 재촉하기 | -1 |

---

## 주요 스크립트

| 스크립트 | 설명 |
|---------|------|
| `npm run dev` | 개발 서버 실행 (nodemon) |
| `npm run build` | TypeScript 빌드 |
| `npm run swagger` | Swagger 스펙 생성 |
| `npm run routes` | tsoa 라우트 재생성 |
| `npm run db:generate` | Prisma 클라이언트 생성 |
| `npm run db:push` | 스키마를 DB에 반영 |
| `npm run db:migrate` | DB 마이그레이션 |
| `npm run db:seed` | 시드 데이터 입력 (36개 질문) |
| `npm run db:studio` | Prisma Studio 실행 |
| `npm run deploy:dev` | 개발 환경 배포 |
| `npm run deploy:prod` | 프로덕션 배포 |

---

## AWS 배포

### Phase 1: RDS PostgreSQL 설정

```
AWS Console → RDS → Create database
- Engine: PostgreSQL 15
- Template: Free tier
- Instance: db.t3.micro
```

### Phase 2: 환경 변수 설정

```bash
DATABASE_URL="postgresql://user:pass@xxx.rds.amazonaws.com:5432/mongle"
JWT_SECRET="your-jwt-secret"
JWT_REFRESH_SECRET="your-refresh-secret"
```

### Phase 3: Serverless 배포

```bash
npm run deploy:dev
```

---

## 관련 저장소

| 저장소 | 설명 |
|--------|------|
| `FamTree` (iOS) | Swift + TCA 기반 iOS 앱 |
| `Mongle-Android` | Kotlin + Jetpack Compose Android 앱 |

정적 약관/개인정보 문서는 `public/legal/` 하위에 ko/en/ja 3개 언어로 보관되어 있으며,
클라이언트는 Notion 페이지 URL 로 직접 링크한다.

자세한 API 명세: `http://localhost:3000/docs` 또는 `docs/API_SPEC.md`
