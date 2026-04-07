# 🚨 Mongle 보안 점검 — 사용자 수동 작업 체크리스트

> 자동으로 처리할 수 없는, **사용자가 직접 콘솔/터미널에서 수행해야 하는** 작업 목록입니다.
> 작성일: 2026-04-06

---

## ⛔ Phase 0 — 비상 대응 (오늘 안에 처리)

### 1. 노출된 시크릿 즉시 무효화

> ✅ **확인 결과**: `.env`, `Mongle.pem` 파일은 `.gitignore`에 등록되어 있고 **git에 커밋된 적이 없습니다**. (Phase 0 초기 점검 시 추정이었으나 실제 검증 결과 추적되지 않음을 확인)
> 따라서 git history rewrite는 **불필요**합니다.
>
> 다만 다음 경로로 노출 가능성이 여전히 있으므로 **선택적으로** 키 회전을 권장합니다:
> - 협업자 로컬 저장소나 백업본
> - CI/CD 캐시 (Lambda 배포 패키지에 포함되었을 가능성)
> - 과거 스크린샷, 채팅, 이메일 등
>
> **민감도가 가장 높은 항목(JWT 시크릿, Firebase 키, DB 비밀번호)은 회전하는 것이 안전합니다.**

#### 1-1. AWS RDS PostgreSQL 비밀번호 재설정
- [ ] AWS Console → RDS → Mongle DB 인스턴스 → **Modify** → New master password
- [ ] 새 비밀번호를 안전한 곳(1Password, AWS Secrets Manager 등)에 보관
- [ ] **주의**: 변경 후 서버가 즉시 새 비밀번호로 재배포되어야 함

#### 1-2. JWT 서명 키 재생성
- [ ] 다음 명령으로 새 키 두 개 생성:
  ```bash
  openssl rand -hex 64   # JWT_SECRET 용
  openssl rand -hex 64   # JWT_REFRESH_SECRET 용
  ```
- [ ] **주의**: 서명 키 변경 시 **모든 사용자가 강제 로그아웃** 됩니다 (재로그인 필요)
- [ ] 사용자 공지 후 배포 권장

#### 1-3. Firebase 서비스 계정 키 재발급
- [ ] Firebase Console → 프로젝트 설정 → 서비스 계정 → **새 비공개 키 생성**
- [ ] 기존 키 즉시 **삭제** (Firebase Console → Service accounts → Manage service accounts → IAM → 기존 키 disable)
- [ ] 새 키를 환경변수로 안전하게 주입 (절대 .env에 저장하지 말 것)

#### 1-4. Apple Sign-In 인증서 (`Mongle.pem`) 점검
- [ ] `Mongle.pem` 파일도 git에 커밋되어 있는지 확인
- [ ] Apple Developer → Certificates, Identifiers & Profiles → Sign in with Apple key 회전 권장
- [ ] 새 키 발급 후 기존 키 revoke

#### 1-5. 소셜 로그인 클라이언트 키 재발급 (선택, 우선순위 중)
- [ ] **Kakao**: https://developers.kakao.com → 내 애플리케이션 → 앱 키 재발급
- [ ] **Google**: Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 클라이언트 ID 재발급
  - iOS, Android, Web 각각 따로 재발급
- [ ] **AdMob**: 광고 단위 ID 재발급은 신중히 (수익 통계 끊김)
- [ ] 재발급 후 iOS `Secrets.swift`, Android `local.properties`에 새 키 입력 필요

> ⚠️ **재발급 후 반드시 알려주세요**. 클라이언트 코드에 새 키를 반영해야 합니다.

---

### 2. iOS `credentials.plist` git 추적 확인

iOS 프로젝트의 `credentials.plist`도 git에 커밋된 적 있는지 확인:

- [ ] 다음 명령 실행:
  ```bash
  cd /Users/yong/Desktop/FamTree
  git ls-files | grep -E "credentials\.plist|Secrets\.swift"
  git log --all --full-history -- credentials.plist
  ```
- [ ] **결과가 비어 있으면**: 이미 안전. 추가 조치 불필요.
- [ ] **결과가 나오면**: 위 Phase 0의 git filter-repo 절차를 적용
  ```bash
  brew install git-filter-repo
  cp -r /Users/yong/Desktop/FamTree /Users/yong/Desktop/FamTree.backup
  cd /Users/yong/Desktop/FamTree
  git filter-repo --path credentials.plist --invert-paths
  git push --force --all
  ```

---

### 3. AWS Secrets Manager 또는 SSM Parameter Store 설정

서버는 더 이상 `.env` 파일을 사용하지 않고, AWS의 안전한 시크릿 저장소에서 런타임에 로드해야 합니다.

#### 3-1. Secrets Manager 시크릿 생성
- [ ] AWS Console → Secrets Manager → **Store a new secret** → Other type
- [ ] 다음 키-값 등록:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `JWT_REFRESH_SECRET`
  - `FIREBASE_PRIVATE_KEY`
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_PROJECT_ID`
  - `GOOGLE_CLIENT_ID`
  - `APPLE_BUNDLE_ID` (또는 SERVICES_ID)
  - `KAKAO_REST_API_KEY`
- [ ] 시크릿 이름: `mongle/prod/secrets`
- [ ] Lambda 실행 역할에 `secretsmanager:GetSecretValue` 권한 부여

#### 3-2. Lambda 환경변수에서 시크릿 ARN만 노출
- [ ] `serverless.yml` 환경변수에서 모든 평문 값 제거
- [ ] `SECRETS_ARN` 환경변수로 시크릿 ARN만 주입
- [ ] 코드는 부팅 시 1회 호출로 시크릿 로드 (캐싱)

> ✅ **이 작업이 완료되면 알려주세요.** 서버 코드에서 `process.env` 사용 방식을 시크릿 매니저 SDK 호출로 전환하는 작업을 도와드릴 수 있습니다.

---

## 📋 Phase 1 코드 작업 후 처리해야 할 사항

### 4. 데이터베이스 마이그레이션 적용 (이메일 로그인 제거 후)

이메일 로그인 제거에 따른 `password_hash` 컬럼 삭제 마이그레이션이 추가됩니다.

- [ ] 마이그레이션 파일 검토:
  ```bash
  cd /Users/yong/Desktop/MongleServer
  cat prisma/migrations/*remove_password_hash*/migration.sql
  ```
- [ ] **개발 환경**에서 먼저 적용:
  ```bash
  npx prisma migrate deploy
  ```
- [ ] **운영 환경 적용 전 백업**:
  ```bash
  pg_dump -h <RDS_HOST> -U <USER> -d <DB> > backup_$(date +%Y%m%d).sql
  ```
- [ ] 운영 환경 적용

### 5. 의존성 정리

- [ ] 서버: `bcryptjs` 제거 후 `npm install` 실행
  ```bash
  cd /Users/yong/Desktop/MongleServer
  npm install
  ```
- [ ] iOS: 빌드 후 컴파일 에러 확인
- [ ] Android: `./gradlew assembleDebug` 로 빌드 검증

### 6. 배포 전 점검

- [ ] **백엔드**: 모든 환경 변수가 Secrets Manager에서 정상 로드되는지 확인
- [ ] **iOS TestFlight**: 새 키로 빌드한 버전을 내부 테스터에게 배포
- [ ] **Android Internal Testing**: Play Console 내부 테스트 트랙에 배포
- [ ] 소셜 로그인 3종 모두 정상 작동 확인

---

## 📋 Phase 2~5 추가 작업 (별도 요청 시 진행)

### Phase 2 — iOS CRITICAL
- [ ] Kakao/Google 키 재발급 후 받은 새 키로 `Secrets.swift` 또는 `.xcconfig` 업데이트
- [ ] `git rm --cached credentials.plist`
- [ ] Apple Sign-In nonce 추가 (코드 작업 — 별도 요청)
- [ ] Keychain 서비스명 통일 (코드 작업 — 별도 요청)

### Phase 3 — Android CRITICAL
- [ ] `local.properties`에 새 키 입력 (build.gradle.kts에서 로드)
- [ ] EncryptedSharedPreferences 도입 (코드 작업 — 별도 요청)
- [ ] AndroidManifest `<data android:scheme="http" />` 제거 (코드 작업 — 별도 요청)

### Phase 4 — HIGH 일괄
- [ ] Zod 스키마 도입 (서버, 코드 작업)
- [ ] Refresh token 블랙리스트 (서버, 코드 + Redis 인프라)
- [ ] OkHttp Certificate Pinning (Android, 코드 작업)

---

## ✅ 진행 상황 추적

| Phase | 작업 | 상태 | 비고 |
|-------|------|------|------|
| 0 | RDS 비밀번호 회전 | ⬜ | |
| 0 | JWT 시크릿 회전 | ⬜ | 사용자 강제 로그아웃 발생 |
| 0 | Firebase 키 회전 | ⬜ | |
| 0 | Apple `.pem` 회전 | ⬜ | |
| 0 | Kakao 앱 키 회전 | ⬜ | |
| 0 | Google OAuth 키 회전 | ⬜ | |
| 0 | git history 정리 | ⬜ | 백업 후 진행 |
| 0 | AWS Secrets Manager 설정 | ⬜ | |
| 1 | 이메일 로그인 제거 마이그레이션 적용 | ⬜ | 코드 작업은 자동 처리됨 |
| 1 | 운영 DB 백업 | ⬜ | 마이그레이션 전 |

---

## 🆘 문제 발생 시

각 단계에서 문제가 발생하면 그대로 두고 다음 채팅 세션에서 어느 단계까지 진행했는지 알려주세요.
- "RDS 비밀번호는 바꿨는데 git filter-repo가 오류남"
- "Secrets Manager 등록은 했는데 Lambda에서 권한 오류"

같은 식으로 알려주시면 그 지점부터 이어서 도와드리겠습니다.
