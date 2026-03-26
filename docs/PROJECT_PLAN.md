# FamTree Server 프로젝트 계획

> 최종 업데이트: 2025-01-07

## 프로젝트 개요

FamTree 앱의 백엔드 API 서버. AWS Serverless 아키텍처 기반.

### 기술 스택

| 구분 | 기술 |
|------|------|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express + tsoa |
| Database | PostgreSQL (AWS RDS) |
| ORM | Prisma |
| Auth | AWS Cognito |
| Deploy | Serverless Framework → API Gateway + Lambda |
| Docs | Swagger/OpenAPI 3.0 (자동 생성) |

---

## 아키텍처

```
┌─────────────┐     ┌─────────────────────────────────────────────┐
│   iOS App   │     │                    AWS                       │
│  (FamTree)  │────▶│  ┌───────────┐     ┌───────────────────┐   │
└─────────────┘     │  │    API    │     │      Lambda       │   │
                    │  │  Gateway  │────▶│   (Express+tsoa)  │   │
                    │  └───────────┘     └─────────┬─────────┘   │
                    │                              │              │
                    │  ┌───────────┐     ┌────────▼────────┐    │
                    │  │  Cognito  │     │   RDS PostgreSQL │    │
                    │  │(User Pool)│     │    (Prisma ORM)  │    │
                    │  └───────────┘     └─────────────────┘    │
                    └─────────────────────────────────────────────┘
```

---

## 프로젝트 구조

```
FamTreeServer/
├── src/
│   ├── controllers/      # API 엔드포인트 (tsoa 데코레이터)
│   │   ├── UserController.ts
│   │   ├── FamilyController.ts
│   │   ├── QuestionController.ts
│   │   ├── AnswerController.ts
│   │   ├── TreeController.ts
│   │   └── HealthController.ts
│   ├── services/         # 비즈니스 로직
│   │   ├── UserService.ts
│   │   ├── FamilyService.ts
│   │   ├── QuestionService.ts
│   │   ├── AnswerService.ts
│   │   └── TreeService.ts
│   ├── models/           # Request/Response DTO
│   │   └── index.ts
│   ├── middleware/       # Express 미들웨어
│   │   ├── auth.ts       # JWT 인증
│   │   └── errorHandler.ts
│   ├── utils/            # 유틸리티
│   │   ├── prisma.ts     # Prisma 클라이언트
│   │   ├── inviteCode.ts # 초대 코드 생성
│   │   └── treeStage.ts  # 나무 단계 계산
│   ├── routes/           # tsoa 자동 생성
│   ├── app.ts            # Express 앱
│   ├── lambda.ts         # Lambda 핸들러
│   └── swagger.ts        # Swagger UI 핸들러
├── prisma/
│   └── schema.prisma     # DB 스키마
├── docs/                 # 문서
├── scripts/              # 스크립트
├── serverless.yml        # Serverless 설정
├── tsoa.json             # tsoa 설정
├── tsconfig.json         # TypeScript 설정
└── package.json
```

---

## API 엔드포인트

### Health
| Method | Path | 설명 |
|--------|------|------|
| GET | /health | 서버 상태 확인 |

### Users
| Method | Path | 설명 | Auth |
|--------|------|------|------|
| GET | /users/me | 내 정보 조회 | ✅ |
| PUT | /users/me | 내 정보 수정 | ✅ |

### Families
| Method | Path | 설명 | Auth |
|--------|------|------|------|
| POST | /families | 가족 생성 | ✅ |
| POST | /families/join | 가족 참여 | ✅ |
| GET | /families/my | 내 가족 조회 | ✅ |
| GET | /families/{id} | 가족 상세 | ✅ |
| GET | /families/{id}/members | 구성원 목록 | ✅ |
| DELETE | /families/leave | 가족 떠나기 | ✅ |

### Questions
| Method | Path | 설명 | Auth |
|--------|------|------|------|
| GET | /questions/today | 오늘의 질문 | ✅ |
| GET | /questions/date/{date} | 날짜별 질문 | ✅ |
| GET | /questions/{id} | 질문 상세 | ✅ |
| GET | /questions | 질문 히스토리 | ✅ |

### Answers
| Method | Path | 설명 | Auth |
|--------|------|------|------|
| POST | /answers | 답변 작성 | ✅ |
| GET | /answers/my/{questionId} | 내 답변 | ✅ |
| GET | /answers/family/{questionId} | 가족 답변 | ✅ |
| PUT | /answers/{id} | 답변 수정 | ✅ |
| DELETE | /answers/{id} | 답변 삭제 | ✅ |

### Tree
| Method | Path | 설명 | Auth |
|--------|------|------|------|
| GET | /tree/progress | 나무 진행 상태 | ✅ |
| GET | /tree/detail | 나무 상세 (기여도) | ✅ |

---

## 작업 순서

### Phase 1: 로컬 개발 환경 (현재)
- [x] 프로젝트 구조 생성
- [x] TypeScript + Express 설정
- [x] tsoa + Swagger 설정
- [x] Prisma 스키마 정의
- [x] 컨트롤러/서비스 구현
- [ ] 로컬 PostgreSQL 연결
- [ ] Swagger 문서 확인

### Phase 2: AWS 인프라 구축
- [ ] AWS 계정 설정
- [ ] Cognito User Pool 생성
- [ ] RDS PostgreSQL 생성
- [ ] VPC/보안그룹 설정
- [ ] 환경 변수 설정

### Phase 3: 배포 및 테스트
- [ ] Serverless 배포 (dev)
- [ ] API Gateway 확인
- [ ] Cognito 연동 테스트
- [ ] iOS 앱 연동

### Phase 4: 프로덕션
- [ ] 프로덕션 환경 구성
- [ ] CI/CD 파이프라인
- [ ] 모니터링 설정

---

## 실행 방법

### 1. 의존성 설치
```bash
cd FamTreeServer
npm install
```

### 2. 환경 변수 설정
```bash
cp .env.example .env
# .env 파일 수정
```

### 3. Prisma 클라이언트 생성
```bash
npm run db:generate
```

### 4. 개발 서버 실행
```bash
npm run dev
```

### 5. Swagger 확인
```
http://localhost:3000/docs
```

---

## AWS 리소스 예상 비용 (월)

| 서비스 | 예상 비용 | 비고 |
|--------|----------|------|
| API Gateway | $1-5 | 요청당 과금 |
| Lambda | $0-5 | 프리티어 포함 |
| RDS PostgreSQL | $15-30 | db.t3.micro |
| Cognito | $0 | MAU 50,000까지 무료 |
| **총계** | **$15-40** | 초기 단계 |

---

## 참고 자료

- [tsoa Documentation](https://tsoa-community.github.io/docs/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Serverless Framework](https://www.serverless.com/framework/docs)
- [AWS Cognito](https://docs.aws.amazon.com/cognito/)
