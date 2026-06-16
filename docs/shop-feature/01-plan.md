# Shop 기능 — 서버 기획 / 도메인 설계 (01-plan)

상태: 기획안 (코드 미작성). 다음 단계 = QA 검증 → 구현.
기준 계약: [`00-contract.md`](./00-contract.md) (변경 불가). 본 문서는 그 계약을 서버 도메인으로 어떻게 실현할지의 설계다.

> 조사 전제: 현재 `src/` 에는 Shop 관련 소스/모델/스키마가 **전혀 없다**. 단, `dist/` 에
> 과거 시도의 **컴파일 잔재**(`dist/controllers/ShopController.d.ts`, `dist/services/ShopService.d.ts`,
> `dist/constants/shopCatalog.d.ts`)가 남아 있다. 이 잔재는 `dist/models/index.d.ts` 에 더 이상
> 존재하지 않는 타입(`ShopCatalogItemDto` 등)을 import 하므로 **빌드 불가능한 옛 버전**이며,
> src 에서 제거/리버트된 것으로 보인다. 본 기획은 이 잔재를 "선행 설계 참고"로만 사용하고,
> **계약(00-contract.md)을 단일 진실로** 삼는다. 잔재와 계약이 충돌하는 지점(배경 소유 경계)은
> §6 결정 필요 항목에 명시한다.

---

## 0. 조사 결과 — 기존 서버의 실제 구조 (설계 근거)

### 0.1 하트(heart) 저장 위치 — **그룹별 잔액은 `FamilyMembership.hearts`**
하트 필드가 두 곳에 존재한다. 어느 것이 "그룹별 잔액"의 진실인지가 핵심이다.

| 필드 | 위치 | 의미 | 근거 |
|---|---|---|---|
| `User.hearts` | `prisma/schema.prisma:18` | 전역(레거시) 하트. 일부 응답에서 표시만 됨 | `schema.prisma:18`, `FamilyService.ts:666` |
| **`FamilyMembership.hearts`** | `prisma/schema.prisma:105` (`@default(5)`) | **그룹별 잔액. 모든 차감/지급의 진실** | `schema.prisma:105` |

차감/지급은 전부 `FamilyMembership.hearts` 에서 일어난다 — 답변 수정(`AnswerService.ts:421-424`),
패스/스킵 `-3`(`QuestionService.ts:192`, `:443`), 재촉 `-1`(`NudgeService.ts:95`), 광고 보상 `+amount`(`UserService.ts:242-245`),
데일리 `+1`(`UserService.ts:117`). **Shop 구매 차감도 반드시 여기서** 한다 (계약 line 62-63 일치).
신규 하트 필드/테이블을 만들지 않는다.

### 0.2 광고 보상 하트 지급 패턴 — `grantAdHearts` (구매 차감이 모방할 원본)
`UserService.grantAdHearts` (`UserService.ts:233-248`):
```
userId(JWT) → prisma.user.findUnique({ where: { userId } })  // user.id(PK), user.familyId 획득
guard: !user → notFound;  !user.familyId → badRequest('활성 그룹이 없습니다.')
prisma.familyMembership.update({
  where: { userId_familyId: { userId: user.id, familyId: user.familyId } },
  data: { hearts: { increment: amount } },
}) → updated.hearts 반환
```
컨트롤러: `UserController.ts:107-116`, `@Post('me/hearts/ad-reward')`, `HeartRewardResponse { heartsRemaining }`
(`models/index.ts:40-42`). **구매(purchase)는 이 패턴을 `decrement` + 잔액가드로 뒤집은 형태**가 된다.

### 0.3 잔액 가드가 있는 차감의 정석 — `AnswerService.updateAnswer` (race-safe)
`AnswerService.ts:388-438` 가 동시성까지 처리한 모범 사례다. 구매는 이 패턴을 그대로 따른다.
1. 사전 검사: `findUnique` 로 `hearts < N` 이면 `badRequest`.
2. `$transaction([... , familyMembership.updateMany({ where: { ..., hearts: { gte: N } }, data: { hearts: { decrement: N } } })])`.
3. `updateMany` 결과 `count === 0` 이면(사전검사~트랜잭션 사이 race) `badRequest('하트 부족')` 으로 환원.
→ Shop 구매의 잔액 정합성·동시성은 **이 3단계를 그대로 차용**한다. (where 의 `gte: price` 가드가 핵심)

### 0.4 인증 / 유저 식별
- tsoa `@Security('jwt')` + `expressAuthentication`(`middleware/auth.ts:55-97`)가 `{ userId, email }` 주입.
- 컨트롤러는 `req.user.userId` 만 받고 서비스로 넘긴다(`AnswerController.ts:41`). 이 `userId` 는
  **`User.userId` 컬럼(JWT `sub`)이며 PK 가 아니다**. 서비스에서 항상 `findUnique({ where: { userId } })`
  로 `user.id`(PK)·`user.familyId` 를 해석한 뒤 쿼리에 주입한다 (0.2 패턴과 동일).
- "활성 그룹" = `User.familyId`(`schema.prisma:20`). 멀티그룹 유저도 현재 활성 그룹 1개를 이 필드가 가리킨다.

### 0.5 가족 구성원 조회
`prisma.familyMembership.findMany({ where: { familyId }, include: { user: true } })` (`FamilyService.ts:212-216`).
→ "그룹 단위 소유"를 판단할 때 멤버 열거가 필요하면 이 쿼리를 쓴다. 단, 아래 설계는 **멤버를 열거하지 않고
familyId 한 줄로 그룹 소유를 표현**하므로 이 쿼리는 inventory 의 그룹 배경 조회에서만 간접적으로 쓰인다.

### 0.6 카탈로그 시드 컨벤션
`prisma/seed.ts` 는 질문 데이터를 **하드코딩 TS 배열 상수**로 두고 seed 한다(`seed.ts:6~`).
`prisma/migrations/` 디렉토리는 **없다**(= `prisma db push` 기반 스키마 관리로 추정).
→ "카탈로그를 어디에 둘지" 결정의 직접 근거 (§2.1).

### 0.7 컨트롤러/서비스/DTO 컨벤션 (모방 대상)
- 컨트롤러: 얇은 위임. `@Route('shop')`, 메서드마다 `@Security('jwt')` + `@SuccessResponse`,
  `req.user.userId` → service. (`AnswerController.ts` 전체)
- DTO: `src/models/index.ts` 에 `export interface` 로 도메인별 섹션 주석과 함께 정의
  (`HeartRewardResponse` `models/index.ts:40-42` 등).
- 에러: `Errors.badRequest / notFound / forbidden / conflict`(`middleware/errorHandler.ts:22-34`).

---

## 1. 기능 범위 — 5개 엔드포인트

모두 `@Security('jwt')`. 컨트롤러 `@Route('shop')` → `ShopController`, 로직은 `ShopService`.
신규 컨트롤러이므로 deploy 전 **`npm run build`(= tsoa spec-and-routes && tsc) 필수** (계약 line 69-70, 과거 404 함정).

1. **GET `/shop/catalog` → `ShopItemDTO[]`**
   판매 가능한 전체 아이템(배경 6 + 장식 9 = 15종)을 `sortOrder` 오름차순으로 반환. 소유/잔액 정보 없음,
   순수 카탈로그. 인증만 요구(개인화 없음 → 캐시 가능). 서버 상수(§2.1)를 그대로 매핑한다.

2. **GET `/shop/inventory` → `ShopInventoryDTO`**
   호출 유저의 현황을 합쳐 반환: 개인 소유/장착 장식(`ownedDecorationIds`, `equippedDecorations`) +
   **현재 그룹의 공유 배경**(`ownedBackgroundIds`, `appliedBackgroundId`). 기본 배경 `bg_cozy_home` 은
   항상 `ownedBackgroundIds` 에 포함, `appliedBackgroundId` 가 비어 있으면 기본값으로 본다. 무가족 유저는
   배경 두 필드를 기본값만 채운다(§4).

3. **POST `/shop/purchase` `{ itemId }` → `{ heartsRemaining }`**
   서버 권위 구매. itemId 의 가격만큼 **현재 그룹 멤버십 하트에서 차감**하고 잔액 반환. 차감은 0.3 의 race-safe
   3단계. 배경이면 그룹 소유로, 장식이면 개인 소유로 기록(§3). 이미 보유/가격 0/존재X/잔액부족은 §3 규칙.

4. **POST `/shop/decoration/equip` `{ slot, itemId? }` → `{ equippedDecorations }`**
   개인 장식을 슬롯에 장착/해제. `itemId` 있으면 장착(소유·종류·slot 일치 검증), 없으면 해당 slot 해제.
   슬롯당 1개. 갱신 후 3개 슬롯 전체 상태(`EquippedDecorationsDTO`)를 반환.

5. **POST `/shop/background/apply` `{ itemId }` → `ShopInventoryDTO`**
   현재 그룹의 적용 배경을 변경(그룹 공유 → 가족 전원 홈에 반영). 그룹이 소유한 배경 또는 기본 배경만 적용 가능.
   변경 후 inventory 전체를 반환(2번과 동일 응답 형태)해 클라가 즉시 동기화.

---

## 2. 도메인 모델 / 데이터 소유 경계

### 2.1 카탈로그: **서버 상수(시드 in-code) 권고** — DB 테이블 두지 않음
- 근거: ① 카탈로그 15종은 iOS 자산(`assetName`)과 1:1로 묶여 **앱 빌드와 동시 배포되는 고정 데이터**다.
  서버 DB 에만 행을 추가해도 대응 자산이 없는 앱은 렌더 못함 → DB 가변성의 이득이 없다.
  ② 기존 컨벤션이 고정 데이터를 **하드코딩 TS 상수로 seed**한다(`seed.ts`, §0.6). ③ migrations 디렉토리가
  없어(§0.6) 테이블 추가 비용 대비 상수의 단순성이 우월. ④ 선행 잔재도 `constants/shopCatalog`
  (`dist/constants/shopCatalog.d.ts`: `SHOP_CATALOG`, `CATALOG_BY_ID`, `DEFAULT_BACKGROUND_ID`)로 상수 채택.
- 권고: `src/constants/shopCatalog.ts` 에 `SHOP_CATALOG: ShopCatalogItem[]` + `CATALOG_BY_ID: Record<string,...>`
  + `DEFAULT_BACKGROUND_ID = 'bg_cozy_home'`. 값은 00-contract §카탈로그 표를 그대로(가격/slot/seasonal/sortOrder).
  `name` 은 계약 표 한국어를 기본으로 두되 다국어는 §6 결정사항.

### 2.2 배경 소유/적용 = **그룹(가족) 단위** → 신규 테이블 `GroupBackground` + `Family` 확장
계약(line 64)상 배경은 "구매 시 가족 전원 개방", `ownedBackgroundIds`/`appliedBackgroundId` 가 그룹 단위다.
- **소유(owned)**: 신규 테이블 권고.
  ```
  model GroupBackground {            // 그룹이 보유한(=구매한) 배경. 기본배경은 행 없이 항상 보유 취급
    id           String   @id @default(uuid())
    familyId     String   @map("family_id")
    backgroundId String   @map("background_id")   // 카탈로그 id (bg_*)
    purchasedById String? @map("purchased_by_id") // 구매자 추적(감사용, optional)
    createdAt    DateTime @default(now())
    @@unique([familyId, backgroundId])            // 중복 구매 멱등 보장
    @@map("group_backgrounds")
  }
  ```
  근거: 보유 배경은 N개(가변 다중)라 `Family` 의 스칼라 컬럼으로 못 담는다. `family_memberships` 가 아닌
  `families` 에 묶어야 "전원 공유" 의미가 성립. `@@unique` 는 0.3 의 멱등성과 짝.
- **적용(applied)**: 그룹당 1개 → `Family` 모델에 스칼라 컬럼 추가 권고.
  `Family.appliedBackgroundId String? @map("applied_background_id")` (`schema.prisma:85-97` 확장).
  null 이면 기본배경(`bg_cozy_home`)으로 해석.
  - 대안(테이블 분리)은 1:1 데이터에 과설계 → 컬럼 추가가 단순. (§6 에서 재확인)

### 2.3 장식 소유/장착 = **유저 단위** → 신규 테이블 `UserDecoration` + `FamilyMembership`? 아니오, `User` 기준
계약(line 65)상 장식은 개인. 활성 그룹과 무관하게 유저가 들고 다닌다(홈 캐릭터는 그룹 화면이지만 장식은 "내 캐릭터" 꾸미기).
- **소유(owned)**: 신규 테이블.
  ```
  model UserDecoration {
    id           String   @id @default(uuid())
    userId       String   @map("user_id")          // User.id(PK)
    decorationId String   @map("decoration_id")    // deco_*
    createdAt    DateTime @default(now())
    @@unique([userId, decorationId])               // 중복 구매 멱등
    @@map("user_decorations")
  }
  ```
- **장착(equipped)**: 슬롯당 1개(head/back/feet) → `User` 모델에 3 스칼라 컬럼 권고.
  `equippedHead String? / equippedBack String? / equippedFeet String?` (`@map`). null = 미장착.
  - 대안(equipped 테이블 slot @unique)도 가능하나 슬롯 3개 고정이라 컬럼이 단순. (§6)
  - **결정 필요(§6)**: 장식 소유를 `User`(전역) vs `FamilyMembership`(그룹별)에 둘지. 계약은 "유저 단위"라
    User 기준이 자연스러우나, 하트가 그룹별이라 "그룹 A 하트로 산 장식을 그룹 B 에서 쓰는가?"는 제품 결정.
    권고 기본값: **User 전역**(장식=내 캐릭터 정체성). 구매 차감만 활성 그룹 하트.

### 2.4 하트 차감 = **기존 `FamilyMembership.hearts` 재사용** (신규 금지)
§0.1~0.3 그대로. 구매 가격만큼 활성 그룹 멤버십에서 race-safe decrement. 신규 잔액 저장소 없음.

---

## 3. 비즈니스 규칙 상세

### 3.1 purchase
- **유저/그룹 해석**: `findUnique({ where:{userId} })` → `!user` notFound. 차감엔 활성 그룹 필요 →
  `!user.familyId` 면 `badRequest('활성 그룹이 없습니다.')` (grantAdHearts 동일 문구, `UserService.ts:240`).
- **존재하지 않는 아이템**: `CATALOG_BY_ID[itemId]` 없으면 `notFound('아이템')`.
- **가격 0 기본 배경**: `bg_cozy_home`(price 0) 구매는 차감 없이 멱등 성공 — `heartsRemaining` = 현재 잔액 그대로.
- **이미 보유(멱등)**: 배경이면 `GroupBackground` 에 `(familyId, backgroundId)` 존재 / 장식이면
  `UserDecoration` 에 `(userId, decorationId)` 존재 시 → **재차감 없이** 현재 하트 반환(멱등). conflict 아님.
- **잔액 부족**: §0.3 의 `updateMany(where hearts gte price)` count 0 → `badRequest('하트가 부족합니다.')`.
- **차감+기록 원자성**: `$transaction([ membership.updateMany(decrement, gte price), 소유행 create ])`.
  배경이면 `GroupBackground.create`(또는 멱등 시 skip), 장식이면 `UserDecoration.create`. create 는
  `@@unique` 충돌 시 멱등 처리(아래 §4 동시성).

### 3.2 decoration/equip (해제 포함, slot 검증)
- **해제**: `itemId` 미전달(undefined) → 해당 slot 컬럼을 `null` 로.
- **장착 검증 순서**:
  1. 카탈로그 존재 + `kind === 'decoration'` 아니면 `badRequest`.
  2. 아이템의 `slot` 이 요청 `slot` 과 불일치하면 `badRequest('슬롯이 일치하지 않습니다.')`
     (예: head 장식을 feet 로 장착 시도 차단).
  3. 소유 검증: `UserDecoration (userId, itemId)` 없으면 `forbidden('보유하지 않은 아이템')`.
- 통과 시 해당 slot 컬럼 = itemId. 응답은 3 슬롯 전체(`EquippedDecorationsDTO`).
- `slot` 값 검증: `'head'|'back'|'feet'` 외 → `badRequest`.

### 3.3 background/apply (그룹 공유)
- 활성 그룹 필요(`!user.familyId` → badRequest). 카탈로그 존재 + `kind==='background'` 검증.
- **적용 자격**: itemId 가 기본배경(`bg_cozy_home`)이거나, **그룹이 소유**(`GroupBackground (familyId,itemId)` 존재)해야 함.
  아니면 `forbidden('보유하지 않은 배경')`.
  - 주의: 계약상 배경은 그룹 소유이므로 "다른 멤버가 산 배경"도 같은 그룹이면 **소유로 간주되어 적용 가능**.
    (이 점이 잔재 ShopService 와 충돌 — §6-A.)
- `Family.appliedBackgroundId = itemId` 업데이트 → 가족 전원 홈에 반영. 응답은 inventory 전체.

### 3.4 "가족 공유 배경 구매 시 그룹 전원 개방"의 의미
배경 구매가 `GroupBackground(familyId,...)` 한 행을 만들면, 동일 `familyId` 의 **모든 멤버의 inventory 응답**이
그 배경을 `ownedBackgroundIds` 에 포함하게 된다(소유가 familyId 로 묶여 있으므로). 별도 멤버별 fan-out 기록 불필요 —
"한 명이 사면 전원 보유"가 자연스럽게 성립. 적용도 그룹 1개 값이라 누구나 바꾸면 전원에게 보임.

---

## 4. 엣지 / 예외 케이스 목록

| # | 케이스 | 처리 |
|---|---|---|
| E1 | **동시 구매**(같은 유저 2요청) | 잔액: §0.3 `updateMany hearts gte price` 로 한 번만 차감. 소유: `@@unique` 로 두 번째 create 충돌 → catch 후 멱등(이미 보유로 환원). |
| E2 | **중복 구매 멱등성** | 보유 확인 시 재차감 없이 현재 잔액 반환. `@@unique([familyId,backgroundId])`/`([userId,decorationId])` 가 DB 차원 보증. |
| E3 | **가족 미소속 유저** | purchase/apply: `badRequest('활성 그룹이 없습니다.')`. inventory: 배경 필드는 기본값만(`ownedBackgroundIds=[bg_cozy_home]`, `appliedBackgroundId=bg_cozy_home`), 장식은 정상(개인 단위라 무가족이어도 보유/장착 유효 — 단 §6-B 장식 소유 위치 결정에 종속). equip: 장식이 User 전역이면 무가족도 가능. |
| E4 | **시즌 아이템**(bg_snow_village, deco_santa_hat) | 구매 로직 동일. `isSeasonal` 은 표기/정렬 메타일 뿐 판매 게이팅 없음(계약 line 66). **단** 비시즌 기간 판매 차단 정책이 필요한지 §6-C. |
| E5 | **잔액 정합성** | 모든 차감은 단일 진실 `FamilyMembership.hearts` + race-safe 패턴. 구매와 다른 차감(답변수정/패스/재촉)이 동시 발생해도 `gte` 가드로 음수 불가. |
| E6 | **존재X 아이템 / 잘못된 slot** | notFound / badRequest. |
| E7 | **그룹 전환 중 구매** | `user.familyId`(활성 그룹) 기준으로 그 순간 그룹에 차감·기록. 전환 후 다른 그룹에선 그 배경 미보유(배경은 familyId 종속) — 의도된 동작. |
| E8 | **장식 장착 후 미보유화 가능성** | 장식은 소비/환불 없음(현재) → 한 번 사면 영구. 장착 검증은 소유 재확인으로 방어. |

---

## 5. 응답 매핑 (계약 DTO ← 서버 데이터)

### 5.1 `ShopItemDTO[]` (catalog)
`SHOP_CATALOG` 상수의 각 항목 → DTO 필드 1:1 (`id,kind,name,price,assetName,slot,isSeasonal,sortOrder`).
`slot`/`isSeasonal`/`assetName`/`sortOrder` 는 optional 이므로 해당 없는 항목은 미포함(undefined). `sortOrder` 오름차순 정렬.

### 5.2 `ShopInventoryDTO` (inventory & background/apply 응답) — **그룹 배경 + 개인 장식 병합**
```
ownedDecorationIds   = UserDecoration.findMany({ where:{ userId: user.id } }).map(decorationId)
equippedDecorations  = { head: User.equippedHead ?? undefined, back: ..., feet: ... }   // null→미포함
ownedBackgroundIds   = user.familyId
                         ? distinct([ DEFAULT_BACKGROUND_ID, ...GroupBackground(familyId).backgroundId ])
                         : [ DEFAULT_BACKGROUND_ID ]
appliedBackgroundId  = user.familyId ? (Family.appliedBackgroundId ?? DEFAULT_BACKGROUND_ID)
                                     : DEFAULT_BACKGROUND_ID
```
핵심: **장식은 `userId` 로, 배경은 `familyId` 로** 각각 조회해 한 DTO 로 합친다. 기본배경은 항상 owned 에 주입.

### 5.3 `{ heartsRemaining }` (purchase)
`updateMany` 후 `familyMembership.findUnique(...).hearts` (또는 update 반환값) → `{ heartsRemaining }`.
멱등/가격0 경로는 현재 잔액 그대로. (grantAdHearts 의 `{ heartsRemaining }` 와 동일 형태, `models/index.ts:40-42`)

### 5.4 `{ equippedDecorations }` (decoration/equip)
갱신 후 `User` 의 3 컬럼 → `EquippedDecorationsDTO`. null 슬롯은 키 생략(optional).

---

## 6. 미해결 / 결정 필요 항목 (다음 QA 단계 검증 대상)

- **A. [충돌] 배경 소유 경계 — 그룹 vs 유저.**
  계약(line 64)은 "배경=가족 공유, 구매 시 전원 개방"이라 명시. 그러나 `dist` 의 **선행 잔재 ShopService**는
  배경을 **개인(UserBackground) 소유**로 설계했고 "다른 멤버가 산 배경은 적용 불가"라고 주석함
  (`dist/services/ShopService.d.ts`). 본 기획은 **계약을 채택(그룹 공유)** 했다. → 제품 의도 최종 확인 필요.
  (잔재는 버려진 옛 버전으로 보이나, 의도적 정책 변경이었는지 확인.)

- **B. 장식 소유 위치 — `User`(전역) vs `FamilyMembership`(그룹별).**
  하트는 그룹별인데 장식 소유를 전역에 두면 "그룹 A 하트로 산 장식을 그룹 B 캐릭터에 장착" 가능.
  권고 기본값=User 전역(장식=개인 정체성). 멀티그룹 UX 의도 확인 필요.

- **C. 시즌 아이템 판매 기간 게이팅.**
  계약은 "로직 동일, 표기만 구분". 비시즌 기간에 산타모자/눈마을을 **카탈로그에서 숨기거나 구매 차단**할지,
  연중 판매할지 미정. 현 기획=연중 판매(게이팅 없음).

- **D. `appliedBackgroundId`·`equipped*` 저장 방식 — 스칼라 컬럼 vs 분리 테이블.**
  본 기획은 스칼라 컬럼 권고(1:1·고정 슬롯). 정규화/감사 요구가 생기면 테이블화. 스키마 확정 전 합의 필요.

- **E. 카탈로그 `name` 다국어.**
  iOS 는 `L10n.tr(...)` 로 로컬라이즈(서버 `name` 무시 가능성). 서버가 ko 만 줄지, locale 별
  (`User.locale`, `schema.prisma:30`)로 줄지, 혹은 클라가 무시하므로 아무 값이나 줄지 미정.

- **F. 환불/장식 판매·시즌 만료 처리.** 현재 비가역(영구 보유). 향후 정책 시 별도 설계.

- **G. 스키마 적용 방식.** `prisma/migrations` 부재(§0.6) → `db push` 로 신규 3요소(GroupBackground,
  UserDecoration, Family/User 컬럼) 반영하는 운영 절차 확정 필요(prod 반영 순서·다운타임).

- **H. 잔재 `dist/` 정리.** 빌드 깨진 옛 ShopController/Service/constants `dist` 잔재는 신규 빌드 시
  덮어써지나, 혼선 방지 위해 구현 착수 전 제거 권고.
