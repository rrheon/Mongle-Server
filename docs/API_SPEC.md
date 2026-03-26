# FamTree API 명세서

> API 버전: 1.0.0
> Base URL: `https://api.famtree.app` (예정)

## 인증

모든 API는 JWT Bearer Token 인증이 필요합니다 (Health 제외).

```
Authorization: Bearer <cognito_access_token>
```

---

## 공통 응답 형식

### 성공 응답
```json
{
  "data": { ... }
}
```

### 에러 응답
```json
{
  "message": "에러 메시지",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

### HTTP 상태 코드
| 코드 | 설명 |
|------|------|
| 200 | 성공 |
| 201 | 생성됨 |
| 204 | 성공 (내용 없음) |
| 400 | 잘못된 요청 |
| 401 | 인증 필요 |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 409 | 충돌 |
| 422 | 유효성 검사 실패 |
| 500 | 서버 오류 |

---

## API 엔드포인트

### Health

#### GET /health
서버 상태 확인

**Response 200**
```json
{
  "status": "ok",
  "timestamp": "2025-01-07T12:00:00.000Z",
  "version": "1.0.0"
}
```

---

### Users

#### GET /users/me
현재 로그인한 사용자 정보 조회

**Response 200**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "홍길동",
  "profileImageUrl": null,
  "role": "SON",
  "familyId": "uuid",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

#### PUT /users/me
사용자 정보 수정

**Request Body**
```json
{
  "name": "새이름",
  "profileImageUrl": "https://...",
  "role": "FATHER"
}
```

**Response 200**: UserResponse

---

### Families

#### POST /families
새 가족 생성

**Request Body**
```json
{
  "name": "우리 가족",
  "creatorRole": "FATHER"
}
```

**Response 201**
```json
{
  "id": "uuid",
  "name": "우리 가족",
  "inviteCode": "ABC12345",
  "createdById": "uuid",
  "members": [
    {
      "id": "uuid",
      "name": "아빠",
      "role": "FATHER",
      ...
    }
  ],
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

#### POST /families/join
초대 코드로 가족 참여

**Request Body**
```json
{
  "inviteCode": "ABC12345",
  "role": "SON"
}
```

**Response 200**: FamilyResponse

#### GET /families/my
내 가족 정보 조회

**Response 200**: FamilyResponse | null

#### GET /families/{familyId}
가족 상세 정보 조회

**Response 200**: FamilyResponse

#### GET /families/{familyId}/members
가족 구성원 목록

**Response 200**
```json
{
  "members": [
    { "id": "uuid", "name": "아빠", "role": "FATHER", ... },
    { "id": "uuid", "name": "엄마", "role": "MOTHER", ... }
  ]
}
```

#### DELETE /families/leave
가족 떠나기

**Response 204**: No Content

---

### Questions

#### GET /questions/today
오늘의 질문 조회

**Response 200**
```json
{
  "id": "uuid",
  "question": {
    "id": "uuid",
    "content": "가장 좋아하는 음식은 무엇인가요?",
    "category": "DAILY",
    "createdAt": "2025-01-01T00:00:00.000Z"
  },
  "date": "2025-01-07"
}
```

#### GET /questions/date/{date}
특정 날짜의 질문 조회

**Parameters**
- `date`: YYYY-MM-DD 형식

**Response 200**: DailyQuestionResponse | null

#### GET /questions/{questionId}
질문 상세 조회

**Response 200**: QuestionResponse

#### GET /questions
질문 히스토리 (페이지네이션)

**Query Parameters**
- `page`: 페이지 번호 (default: 1)
- `limit`: 페이지 크기 (default: 20)

**Response 200**
```json
{
  "data": [
    { "id": "uuid", "question": {...}, "date": "2025-01-07" },
    ...
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

### Answers

#### POST /answers
답변 작성

**Request Body**
```json
{
  "questionId": "uuid",
  "content": "저는 김치찌개를 가장 좋아해요!",
  "imageUrl": "https://..."
}
```

**Response 201**
```json
{
  "id": "uuid",
  "content": "저는 김치찌개를 가장 좋아해요!",
  "imageUrl": "https://...",
  "user": { ... },
  "questionId": "uuid",
  "createdAt": "2025-01-07T12:00:00.000Z",
  "updatedAt": "2025-01-07T12:00:00.000Z"
}
```

#### GET /answers/my/{questionId}
특정 질문에 대한 내 답변 조회

**Response 200**: AnswerResponse | null

#### GET /answers/family/{questionId}
가족 구성원들의 답변 목록

**Response 200**
```json
{
  "answers": [
    { "id": "uuid", "content": "...", "user": {...}, ... },
    ...
  ],
  "totalCount": 3,
  "myAnswer": { ... } | null
}
```

#### PUT /answers/{answerId}
답변 수정

**Request Body**
```json
{
  "content": "수정된 내용",
  "imageUrl": "https://..."
}
```

**Response 200**: AnswerResponse

#### DELETE /answers/{answerId}
답변 삭제

**Response 204**: No Content

---

### Tree

#### GET /tree/progress
가족 나무 진행 상태

**Response 200**
```json
{
  "id": "uuid",
  "familyId": "uuid",
  "stage": "SPROUT",
  "totalAnswers": 15,
  "nextStageAt": 30,
  "progressPercent": 25
}
```

#### GET /tree/detail
가족 나무 상세 정보 (기여도 포함)

**Response 200**
```json
{
  "id": "uuid",
  "familyId": "uuid",
  "stage": "SPROUT",
  "totalAnswers": 15,
  "nextStageAt": 30,
  "progressPercent": 25,
  "contributions": [
    {
      "userId": "uuid",
      "userName": "아빠",
      "answerCount": 8,
      "contributionPercent": 53
    },
    {
      "userId": "uuid",
      "userName": "엄마",
      "answerCount": 7,
      "contributionPercent": 47
    }
  ]
}
```

---

## Enum 값

### UserRole
- `FATHER`: 아버지
- `MOTHER`: 어머니
- `SON`: 아들
- `DAUGHTER`: 딸
- `OTHER`: 기타

### QuestionCategory
- `DAILY`: 일상
- `MEMORY`: 추억
- `VALUE`: 가치관
- `DREAM`: 꿈/목표
- `GRATITUDE`: 감사
- `SPECIAL`: 특별한 날

### TreeStage
- `SEED`: 씨앗 (0-9)
- `SPROUT`: 새싹 (10-29)
- `SAPLING`: 묘목 (30-59)
- `YOUNG_TREE`: 어린 나무 (60-99)
- `MATURE_TREE`: 성숙한 나무 (100-149)
- `FLOWERING`: 꽃피는 나무 (150+)
