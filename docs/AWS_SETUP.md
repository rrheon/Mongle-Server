# AWS 인프라 설정 가이드

> FamTree 백엔드를 위한 AWS 리소스 설정 가이드

## 사전 요구사항

- AWS 계정
- AWS CLI 설치 및 설정
- Serverless Framework 설치 (`npm install -g serverless`)

---

## 1. AWS Cognito 설정

### 1.1 User Pool 생성

AWS Console → Cognito → User Pools → Create user pool

**설정 옵션:**
```
인증 방법: 이메일
비밀번호 정책:
  - 최소 8자
  - 숫자 포함
  - 대문자 포함
  - 소문자 포함
  - 특수문자 포함
MFA: 선택적 (추후 활성화 권장)
이메일 확인: 필수
```

### 1.2 App Client 생성

User Pool → App Integration → App clients → Create app client

```
App type: Public client
App client name: famtree-ios
Authentication flows:
  - ALLOW_USER_PASSWORD_AUTH
  - ALLOW_REFRESH_TOKEN_AUTH
  - ALLOW_USER_SRP_AUTH
```

### 1.3 환경 변수 기록

```bash
COGNITO_USER_POOL_ID=ap-northeast-2_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_REGION=ap-northeast-2
```

---

## 2. RDS PostgreSQL 설정

### 2.1 데이터베이스 생성

AWS Console → RDS → Create database

```
엔진: PostgreSQL 15
템플릿: Free tier (개발) / Production (운영)
인스턴스: db.t3.micro (개발) / db.t3.small (운영)
스토리지: 20GB gp2
DB 인스턴스 식별자: famtree-db
마스터 사용자 이름: postgres
마스터 암호: [강력한 암호 설정]
```

### 2.2 보안 그룹 설정

인바운드 규칙:
```
Type: PostgreSQL
Protocol: TCP
Port: 5432
Source: Lambda 보안 그룹 또는 VPC CIDR
```

### 2.3 연결 문자열

```bash
DATABASE_URL="postgresql://postgres:PASSWORD@famtree-db.xxxxxx.ap-northeast-2.rds.amazonaws.com:5432/famtree"
```

---

## 3. VPC 설정 (Lambda + RDS 연결)

### 3.1 VPC 구성

```
VPC CIDR: 10.0.0.0/16
Public Subnet: 10.0.1.0/24, 10.0.2.0/24
Private Subnet: 10.0.3.0/24, 10.0.4.0/24
```

### 3.2 Lambda VPC 설정

serverless.yml에 추가:
```yaml
provider:
  vpc:
    securityGroupIds:
      - sg-xxxxxxxxx
    subnetIds:
      - subnet-xxxxxxxx
      - subnet-xxxxxxxx
```

---

## 4. Serverless 배포

### 4.1 AWS 자격 증명 설정

```bash
aws configure
# AWS Access Key ID
# AWS Secret Access Key
# Default region: ap-northeast-2
```

### 4.2 환경 변수 설정

```bash
export DATABASE_URL="postgresql://..."
export COGNITO_USER_POOL_ID="ap-northeast-2_xxx"
export COGNITO_CLIENT_ID="xxx"
```

### 4.3 배포

```bash
# 개발 환경
npm run deploy:dev

# 프로덕션
npm run deploy:prod
```

### 4.4 배포 결과 확인

```
endpoints:
  ANY - https://xxxxxxxxxx.execute-api.ap-northeast-2.amazonaws.com/{proxy+}
functions:
  api: famtree-api-dev-api
```

---

## 5. 데이터베이스 마이그레이션

### 5.1 Prisma 마이그레이션

```bash
# 스키마 변경 반영
npx prisma db push

# 또는 마이그레이션 파일 생성
npx prisma migrate dev --name init
```

### 5.2 시드 데이터 (질문)

```bash
npx prisma db seed
```

---

## 6. 테스트

### 6.1 헬스 체크

```bash
curl https://your-api-url/health
```

### 6.2 Swagger 문서

```
https://your-api-url/docs
```

---

## 7. 모니터링

### CloudWatch 설정

- Lambda 함수 로그 자동 생성
- API Gateway 액세스 로그 활성화
- 에러 알람 설정 권장

### 권장 알람

- Lambda 에러율 > 1%
- Lambda 실행 시간 > 10초
- API Gateway 5xx 에러

---

## 비용 최적화 팁

1. **Lambda**: 메모리 512MB로 시작, 필요시 조정
2. **RDS**: 개발 시 db.t3.micro, 사용하지 않을 때 중지
3. **API Gateway**: HTTP API 사용 (REST API 대비 70% 저렴)
4. **예약 인스턴스**: 장기 사용 시 RDS 예약 인스턴스 검토

---

## 트러블슈팅

### Lambda 타임아웃
- VPC 설정 확인 (NAT Gateway 필요)
- RDS 연결 확인
- 타임아웃 값 증가 (serverless.yml)

### Cognito 토큰 검증 실패
- User Pool ID 확인
- 리전 확인
- 토큰 만료 확인

### RDS 연결 실패
- 보안 그룹 인바운드 규칙 확인
- VPC 서브넷 확인
- 연결 문자열 확인
