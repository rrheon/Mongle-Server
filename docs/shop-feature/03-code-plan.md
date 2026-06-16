# Shop 기능 — 파일 단위 구현 계획 (03-code-plan)

상태: 코드 청사진(구현 직전). 입력 = [`00-contract.md`](./00-contract.md)(계약, 불변) · [`01-plan.md`](./01-plan.md)(설계) · [`02-qa.md`](./02-qa.md)(Blocker 6 + 확정 규칙).
목표: 다음 단계 구현자가 고민 없이 그대로 타이핑할 수 있는 청사진. **본 문서는 코드를 작성하지 않는다(서명·의사코드만).**
검증 기준: 02-qa §3 의 확정 규칙(무가족 매트릭스/멱등/트랜잭션/검증순서/응답키/시드)을 단일 진실로 따른다.

> 컨벤션 모방 대상(실제 코드 확인 완료):
> - 컨트롤러: `src/controllers/AnswerController.ts` (`@Route/@Security('jwt')/@SuccessResponse`, `req.user.userId`→service 위임).
> - 서비스: `src/services/AnswerService.ts:388-441` ($transaction 배열 + `updateMany(hearts gte) + count===0` 가드), `src/services/UserService.ts:233-248` (`grantAdHearts`: findUnique→`!user notFound`→`!familyId badRequest('활성 그룹이 없습니다.')`→membership 갱신).
> - prisma import: `import prisma from '../utils/prisma';` (default export, `AnswerService.ts:1`).
> - 에러: `import { Errors } from '../middleware/errorHandler';` → `Errors.badRequest/notFound/forbidden/conflict` (`errorHandler.ts:21-43`).
> - DTO 정의 위치: `src/models/index.ts` (섹션 주석 + `export interface`, 예 `HeartRewardResponse` `:40-42`).
> - tsoa: `controllerPathGlobs: src/controllers/**/*.ts`, routes → `src/routes/routes.ts`, `RegisterRoutes(app)` (`app.ts:407`). build = `tsoa spec-and-routes && tsc` (`package.json`).
> - 시드: 하드코딩 TS 배열(`prisma/seed.ts`). `prisma/migrations` 부재 → `prisma db push`(= `npm run db:push`).

---

## 1. 변경/신규 파일 목록

| # | 경로 | 신규/수정 | 한 줄 목적 |
|---|---|---|---|
| 1 | `src/controllers/ShopController.ts` | 신규 | `@Route('shop')` 5개 엔드포인트. 얇은 위임(`req.user.userId`→service). |
| 2 | `src/services/ShopService.ts` | 신규 | 구매/인벤토리/장착/적용 비즈니스 로직(차감 트랜잭션·멱등·검증). |
| 3 | `src/constants/shopCatalog.ts` | 신규 | 카탈로그 15종 in-code 상수 + 인덱스 + 기본배경 상수 + 타입. |
| 4 | `src/models/index.ts` | 수정 | Shop 응답/요청 DTO 인터페이스 추가(섹션 주석 + `export interface`). |
| 5 | `prisma/schema.prisma` | 수정 | `GroupBackground`/`UserDecoration` 모델 추가 + `Family`/`User` 컬럼·관계 추가. |
| 6 | `src/routes/routes.ts` | 자동생성(수정 아님) | `npm run build` 의 `tsoa spec-and-routes` 가 ShopController 라우트를 자동 등록. **수동 편집 금지.** |
| 7 | `src/services/__tests__/ShopService.test.ts` | 신규 | 구매 차감/잔액부족/멱등/무가족/equip 해제/apply kind 검증 jest. |
| 8 | `dist/controllers/ShopController.{js,d.ts,*.map}` | **삭제** | B5: 계약충돌 stale 잔재 제거(개인소유 정책). |
| 9 | `dist/services/ShopService.{js,d.ts,*.map}` | **삭제** | B5: stale 잔재(컬럼명 `equippedHeadId`, `UserBackground`). |
| 10 | `dist/constants/shopCatalog.{js,d.ts,*.map}` | **삭제** | B5: stale 잔재(없는 타입 `ShopCatalogItemDto` import). |

> 삭제 3종(8~10)은 구현 **첫 단계**에서 수행. 명령: `rm -f dist/controllers/Shop* dist/services/Shop* dist/constants/shop*` (또는 `rm -rf dist` 후 재빌드). 잔재의 컬럼명/정책을 새 코드 참고로 절대 차용 금지.

---

## 2. Prisma schema 변경 (`prisma/schema.prisma`)

### 2.1 신규 모델 2개 (파일 끝 enum 블록 앞, `model EmailVerification` 다음 `:233` 이후에 추가)

```prisma
// 그룹(가족)이 보유한 배경. 배경=가족 공유(계약 line 64). 기본배경(bg_cozy_home)은
// 행 없이 항상 보유 취급. 한 명이 구매하면 같은 familyId 전원이 inventory 에서 보유로 본다.
model GroupBackground {
  id            String   @id @default(uuid())
  familyId      String   @map("family_id")
  backgroundId  String   @map("background_id")            // 카탈로그 id (bg_*)
  purchasedById String?  @map("purchased_by_id")          // 구매자 추적(감사용, optional)
  createdAt     DateTime @default(now()) @map("created_at")
  family        Family   @relation(fields: [familyId], references: [id])

  @@unique([familyId, backgroundId])                       // 중복구매 멱등 보증(E2)
  @@map("group_backgrounds")
}

// 유저가 보유한 장식. 장식=개인 소유(계약 line 65, 02-qa B2 확정: User 전역).
model UserDecoration {
  id           String   @id @default(uuid())
  userId       String   @map("user_id")                    // User.id(PK)
  decorationId String   @map("decoration_id")              // deco_*
  createdAt    DateTime @default(now()) @map("created_at")
  user         User     @relation(fields: [userId], references: [id])

  @@unique([userId, decorationId])                          // 중복구매 멱등 보증(E2)
  @@map("user_decorations")
}
```

### 2.2 기존 `User` 모델 확장 (`schema.prisma:11-63`)
관계 목록(`:54-60` 부근, `memberships FamilyMembership[]` 등과 같은 블록)에 1줄, 그리고 장착 스칼라 3컬럼 추가.

- 관계선 추가(관계 목록 구간):
  ```prisma
  decorations   UserDecoration[]
  ```
- 장착 스칼라 컬럼 추가(예: `moodId` 근처 `:23` 또는 관계선 위 스칼라 구역):
  ```prisma
  equippedHead String? @map("equipped_head")   // 장착된 head 장식 id (deco_*), null=미장착
  equippedBack String? @map("equipped_back")
  equippedFeet String? @map("equipped_feet")
  ```
  > **컬럼명은 `equippedHead/Back/Feet` 단일 진실**. stale dist 의 `equippedHeadId` 차용 금지(B5).

### 2.3 기존 `Family` 모델 확장 (`schema.prisma:85-97`)
관계 목록(`:92-94`, `dailyQuestions`/`memberships`/`members`)에 1줄 + 적용배경 스칼라 1컬럼.

- 스칼라 컬럼 추가(`updatedAt :91` 다음):
  ```prisma
  appliedBackgroundId String? @map("applied_background_id")  // null=기본배경(bg_cozy_home)으로 해석
  ```
- 관계선 추가(관계 목록 구간):
  ```prisma
  groupBackgrounds GroupBackground[]
  ```

### 2.4 관계선 요약
- `GroupBackground.familyId → Family.id` (N:1). 역방향 `Family.groupBackgrounds`.
- `UserDecoration.userId → User.id`(PK, **userId 컬럼 아님**) (N:1). 역방향 `User.decorations`.
- `Family.appliedBackgroundId` / `User.equipped{Head,Back,Feet}` 는 카탈로그 id 를 담는 자유 스칼라(FK 아님 — 카탈로그가 DB 아닌 상수이므로).
- 신규 컬럼/테이블 모두 기존 schema 와 **이름 충돌 없음**(02-qa V8 확인). 전부 nullable/신규 테이블 → `db push` 무중단(R3).

---

## 3. 카탈로그 상수 모듈 (`src/constants/shopCatalog.ts`)

타입 + 15종 배열(계약 표 글자 그대로) + 인덱스 + 기본배경 상수.

```ts
export type ShopItemKind = 'background' | 'decoration';
export type DecorationSlot = 'head' | 'back' | 'feet';

export interface ShopCatalogItem {
  id: string;
  kind: ShopItemKind;
  name: string;            // 계약 표 ko 값(다국어는 R5, iOS 가 L10n 으로 자체 처리)
  price: number;
  assetName?: string;      // iOS 자산명(현 계약 표에 미명시 → 일단 생략/추후 채움)
  slot?: DecorationSlot;   // decoration 만
  isSeasonal?: boolean;    // true 인 항목만 포함, 그 외 생략
  sortOrder?: number;
}

export const DEFAULT_BACKGROUND_ID = 'bg_cozy_home';

// 배열 순서 = 계약 표 순서. catalog 응답 정렬은 이 배열 순서를 신뢰(02-qa §3.6:
// sortOrder 가 kind/slot 별로 1부터 재시작·4 결번이라 전역 단일정렬 부적합).
export const SHOP_CATALOG: ShopCatalogItem[] = [
  // 배경 (kind=background) — 가족 공유
  { id: 'bg_cozy_home',      kind: 'background', name: '따뜻한 집',   price: 0,  sortOrder: 0 },
  { id: 'bg_spring_field',   kind: 'background', name: '봄 들판',     price: 50, sortOrder: 1 },
  { id: 'bg_beach',          kind: 'background', name: '바닷가',      price: 50, sortOrder: 2 },
  { id: 'bg_space',          kind: 'background', name: '우주',        price: 50, sortOrder: 3 },
  { id: 'bg_snow_village',   kind: 'background', name: '눈오는 마을', price: 50, isSeasonal: true, sortOrder: 5 },
  { id: 'bg_cherry_blossom', kind: 'background', name: '벚꽃길',      price: 50, sortOrder: 6 },
  // 장식 (kind=decoration) — 개인 소유
  { id: 'deco_flower_crown',  kind: 'decoration', name: '들꽃 화관', price: 35, slot: 'head', sortOrder: 1 },
  { id: 'deco_star_halo',     kind: 'decoration', name: '별 후광',   price: 40, slot: 'head', sortOrder: 2 },
  { id: 'deco_satin_ribbon',  kind: 'decoration', name: '새틴 리본', price: 25, slot: 'head', sortOrder: 3 },
  { id: 'deco_balloon_bunch', kind: 'decoration', name: '풍선 다발', price: 50, slot: 'head', sortOrder: 4 },
  { id: 'deco_santa_hat',     kind: 'decoration', name: '산타 모자', price: 60, slot: 'head', isSeasonal: true, sortOrder: 5 },
  { id: 'deco_angel_wings',   kind: 'decoration', name: '천사 날개', price: 45, slot: 'back', sortOrder: 1 },
  { id: 'deco_cape',          kind: 'decoration', name: '망토',      price: 40, slot: 'back', sortOrder: 2 },
  { id: 'deco_sneakers',      kind: 'decoration', name: '운동화',    price: 30, slot: 'feet', sortOrder: 1 },
  { id: 'deco_cloud_pad',     kind: 'decoration', name: '구름 받침', price: 35, slot: 'feet', sortOrder: 2 },
];

export const CATALOG_BY_ID: Record<string, ShopCatalogItem> =
  Object.fromEntries(SHOP_CATALOG.map((i) => [i.id, i]));
```

> 주의: `ShopCatalogItem` 은 `slot/isSeasonal/assetName/sortOrder` 가 optional. 응답에서 `kind==='background'` 항목은 `slot` 키 자체가 없어야 한다(계약 ShopItemDTO `slot` 은 decoration 만). 위 배열이 그 형태를 그대로 만든다 — 추가 가공 불필요.

---

## 4. 컨트롤러 설계 (`src/controllers/ShopController.ts`)

`AnswerController` 와 동일 골격. `@Route('shop')`, `@Tags('Shop')`(tsoa.json `tags` 에 `{ "name": "Shop", "description": "상점 관련 API" }` 추가 권장—기능엔 영향 없음), 메서드마다 `@Security('jwt')`. **경로는 계약과 1:1.**

| 엔드포인트(계약) | tsoa 데코레이터 | 메서드 시그니처 | 반환 |
|---|---|---|---|
| GET `/shop/catalog` | `@Get('catalog')` `@Security('jwt')` `@SuccessResponse(200,'성공')` | `getCatalog()` (req 불필요, 개인화 없음) | `ShopItemDTO[]` |
| GET `/shop/inventory` | `@Get('inventory')` `@Security('jwt')` | `getInventory(@Request() req)` → `service.getInventory(req.user.userId)` | `ShopInventoryDTO` |
| POST `/shop/purchase` | `@Post('purchase')` `@Security('jwt')` | `purchase(@Request() req, @Body() body: PurchaseRequest)` | `PurchaseResponse` |
| POST `/shop/decoration/equip` | `@Post('decoration/equip')` `@Security('jwt')` | `equipDecoration(@Request() req, @Body() body: EquipDecorationRequest)` | `EquipDecorationResponse` |
| POST `/shop/background/apply` | `@Post('background/apply')` `@Security('jwt')` | `applyBackground(@Request() req, @Body() body: ApplyBackgroundRequest)` | `ShopInventoryDTO` |

- import: `Controller, Get, Post, Route, Body, Security, Request, Tags, SuccessResponse` from `tsoa`; `AuthRequest` from `../middleware/auth`; 요청/응답 DTO from `../models`; `ShopService` from `../services/ShopService`.
- 본문은 전부 `return this.shopService.X(req.user.userId, ...)` 한 줄(검증·예외는 서비스에 위임).
- catalog 만 `req` 안 쓰지만 `@Security('jwt')` 유지(인증 필요). `this.shopService.getCatalog()` 동기 반환이어도 `Promise<...>` 로 감싸도 무방(tsoa 호환).

### 4.1 응답/요청 DTO (`src/models/index.ts` 추가, B3 — JSON 키 고정)

```ts
// ============================================
// Shop  (00-contract.md / 02-qa §3.5)
// ============================================
export type ShopItemKindDTO = 'background' | 'decoration';
export type DecorationSlotDTO = 'head' | 'back' | 'feet';

export interface ShopItemDTO {
  id: string;
  kind: ShopItemKindDTO;
  name: string;
  price: number;
  assetName?: string;
  slot?: DecorationSlotDTO;     // decoration 만
  isSeasonal?: boolean;
  sortOrder?: number;
}
export interface EquippedDecorationsDTO {
  head?: string;
  back?: string;
  feet?: string;
}
export interface ShopInventoryDTO {
  ownedDecorationIds?: string[];
  equippedDecorations?: EquippedDecorationsDTO;
  ownedBackgroundIds?: string[];
  appliedBackgroundId?: string;     // 02-qa B6: 항상 채움(없으면 bg_cozy_home)
}
export interface PurchaseRequest { itemId: string; }
export interface PurchaseResponse { heartsRemaining: number; }   // 최상위 키 정확히 하나

export interface EquipDecorationRequest {
  slot: string;        // 'head'|'back'|'feet' — 값 검증은 서비스에서(B4)
  itemId?: string;     // 미전달=해제
}
export interface EquipDecorationResponse {
  equippedDecorations: EquippedDecorationsDTO;   // wrapper 키(B3)
}
export interface ApplyBackgroundRequest { itemId: string; }
```

> tsoa `noImplicitAdditionalProperties: throw-on-extras`(tsoa.json:3) 때문에 요청 바디에 정의 외 키가 오면 422. iOS 가 보내는 바디(`{itemId}`, `{slot,itemId?}`, `{itemId}`)와 정확히 일치하므로 문제 없음.

---

## 5. 서비스 메서드 설계 (`src/services/ShopService.ts`)

import: `prisma from '../utils/prisma'`, `Errors from '../middleware/errorHandler'`, `SHOP_CATALOG/CATALOG_BY_ID/DEFAULT_BACKGROUND_ID/ShopCatalogItem from '../constants/shopCatalog'`, DTO from `../models`. `class ShopService { ... }` (인스턴스화는 컨트롤러 `private shopService = new ShopService()`).

### 5.0 private resolveUser(userId)
`grantAdHearts` 패턴. `const user = await prisma.user.findUnique({ where: { userId } }); if (!user) throw Errors.notFound('사용자'); return user;` (familyId 가드는 호출처별로 — purchase/apply 만 강제).

### 5.1 getCatalog(): ShopItemDTO[]
- `SHOP_CATALOG` 배열을 그대로 매핑 반환(이미 배열 순서 = 정렬 순서). optional 키는 상수에 없으면 그대로 미포함.
- 인증만, DB 접근 없음.

### 5.2 getInventory(userId): Promise<ShopInventoryDTO>  (그룹배경 + 개인장식 병합)
```
user = resolveUser(userId)
// 장식(개인, userId=PK)
decos = prisma.userDecoration.findMany({ where: { userId: user.id }, select: { decorationId: true } })
ownedDecorationIds = decos.map(d => d.decorationId)
equippedDecorations = { ...(user.equippedHead && {head:user.equippedHead}),
                        ...(user.equippedBack && {back:user.equippedBack}),
                        ...(user.equippedFeet && {feet:user.equippedFeet}) }   // null→키 생략
// 배경(그룹, familyId)
if (user.familyId) {
  gbs    = prisma.groupBackground.findMany({ where:{familyId:user.familyId}, select:{backgroundId:true} })
  family = prisma.family.findUnique({ where:{id:user.familyId}, select:{appliedBackgroundId:true} })
  ownedBackgroundIds  = Array.from(new Set([DEFAULT_BACKGROUND_ID, ...gbs.map(g=>g.backgroundId)]))
  appliedBackgroundId = family?.appliedBackgroundId ?? DEFAULT_BACKGROUND_ID   // B6: 항상 채움
} else {
  ownedBackgroundIds  = [DEFAULT_BACKGROUND_ID]      // E3 무가족
  appliedBackgroundId = DEFAULT_BACKGROUND_ID
}
return { ownedDecorationIds, equippedDecorations, ownedBackgroundIds, appliedBackgroundId }
```
- 기본배경은 **항상** owned 에 주입. `appliedBackgroundId` 는 무가족 포함 **항상 값 있음**(B6).
- 그룹 배경 2쿼리(`groupBackground.findMany` + `family.findUnique`)는 `Promise.all` 로 묶어도 됨(선택).

### 5.3 purchase(userId, itemId): Promise<PurchaseResponse>  (B1 트랜잭션 — 확정 절차)
근거: 02-qa §2 B1 / §3.2 / §3.3, `AnswerService.ts:415-437`.
```
1. user = resolveUser(userId).  if (!user.familyId) throw Errors.badRequest('활성 그룹이 없습니다.')   // E3, grantAdHearts 문구
2. item = CATALOG_BY_ID[itemId].  if (!item) throw Errors.notFound('아이템')
3. 보유 선검사(차감 전, 멱등):
     owned =
       item.kind==='background'
         ? (itemId===DEFAULT_BACKGROUND_ID) || !!await prisma.groupBackground.findUnique({ where:{ familyId_backgroundId:{familyId:user.familyId, backgroundId:itemId} } })
         : !!await prisma.userDecoration.findUnique({ where:{ userId_decorationId:{userId:user.id, decorationId:itemId} } })
     if (owned) return { heartsRemaining: await currentHearts(user) }   // 재차감 없음(conflict 아님)
4. price===0 (bg_cozy_home) & 미보유:  // 차감 없이 소유행만 멱등 create
     await createOwnership(item, user) // 아래 헬퍼. P2002 catch→무시(이미 보유)
     return { heartsRemaining: await currentHearts(user) }
5. 미보유 & price>0:  // 단일 $transaction (차감 a + create b)
     try {
       const result = await prisma.$transaction([
         prisma.familyMembership.updateMany({
           where:{ userId:user.id, familyId:user.familyId, hearts:{ gte: item.price } },
           data:{ hearts:{ decrement: item.price } },
         }),
         ownershipCreateOp(item, user),   // groupBackground.create 또는 userDecoration.create
       ])
       if (result[0].count === 0) throw Errors.badRequest('하트가 부족합니다.')
     } catch (e) {
       if (isP2002(e)) {                  // 선검사~트랜잭션 사이 동시구매 → 트랜잭션 롤백됨(차감 무효)
         return { heartsRemaining: await currentHearts(user) }   // 보유로 멱등 환원
       }
       throw e
     }
6. heartsRemaining 산출: **사전 hearts - price 가 아니라 재조회(R2 채택)**.
     return { heartsRemaining: await currentHearts(user) }
```
헬퍼:
- `currentHearts(user)` = `prisma.familyMembership.findUnique({ where:{ userId_familyId:{userId:user.id,familyId:user.familyId} }, select:{hearts:true} })`.hearts ?? 0
- `ownershipCreateOp(item, user)` = `item.kind==='background' ? prisma.groupBackground.create({ data:{ familyId:user.familyId, backgroundId:item.id, purchasedById:user.id } }) : prisma.userDecoration.create({ data:{ userId:user.id, decorationId:item.id } })`
- `isP2002(e)` = `e instanceof Prisma.PrismaClientKnownRequestError && e.code==='P2002'` (`import { Prisma } from '@prisma/client'`).

> **heartsRemaining 산출 근거(R2)**: `updateMany` 는 갱신 행을 반환하지 않으므로 `updated.hearts`(grantAdHearts 의 `update` 방식)를 못 쓴다. 선택지 = (사전조회 hearts − price) vs 트랜잭션 후 **재조회**. **재조회 채택** — 동시에 다른 차감(답변수정/패스/재촉)이 일어나면 "사전값−price" 는 실제 잔액과 어긋난다. 재조회는 또 다른 미세 race 로 실제보다 낮을 수 있으나(02-qa R2) 항상 ≤ 실제이고 음수 불가라 UX상 안전. **단일 진실 `FamilyMembership.hearts`(schema:105) 를 재조회하는 쪽이 정합적.**

### 5.4 equipDecoration(userId, slot, itemId?): Promise<EquipDecorationResponse>
검증 순서 = 02-qa §3.4. **무가족 허용**(B2: 장식=User 전역).
```
1. if (!['head','back','feet'].includes(slot)) throw Errors.badRequest('잘못된 슬롯입니다.')   // 해제 경로 포함 항상 먼저
2. user = resolveUser(userId)   // familyId 가드 없음
   col = { head:'equippedHead', back:'equippedBack', feet:'equippedFeet' }[slot]
3. 해제: if (itemId===undefined) → prisma.user.update({ where:{id:user.id}, data:{ [col]: null } }); goto 6
4. 장착 검증:
     item = CATALOG_BY_ID[itemId];  if (!item || item.kind!=='decoration') throw Errors.badRequest('장식 아이템이 아닙니다.')
     if (item.slot !== slot) throw Errors.badRequest('슬롯이 일치하지 않습니다.')
     owned = await prisma.userDecoration.findUnique({ where:{ userId_decorationId:{userId:user.id, decorationId:itemId} } })
     if (!owned) throw Errors.forbidden('보유하지 않은 아이템입니다.')
5. prisma.user.update({ where:{id:user.id}, data:{ [col]: itemId } })
6. 갱신된 user 재조회(또는 update 반환값)로 equippedDecorations 구성 → return { equippedDecorations }
```
> 응답은 **3슬롯 전체 상태**(null 슬롯 키 생략). update 반환값에서 `equippedHead/Back/Feet` 를 뽑아 5.2 와 동일 방식으로 빌드.

### 5.5 applyBackground(userId, itemId): Promise<ShopInventoryDTO>
검증 순서 = 02-qa §3.4. 무가족 불가.
```
1. user = resolveUser(userId);  if (!user.familyId) throw Errors.badRequest('활성 그룹이 없습니다.')
2. item = CATALOG_BY_ID[itemId];  if (!item || item.kind!=='background') throw Errors.badRequest('배경이 아닙니다.')   // B4 대칭
3. 자격: eligible = (itemId===DEFAULT_BACKGROUND_ID) || !!await prisma.groupBackground.findUnique({ where:{ familyId_backgroundId:{familyId:user.familyId, backgroundId:itemId} } })
        if (!eligible) throw Errors.forbidden('보유하지 않은 배경입니다.')
        // 같은 familyId 면 '다른 멤버가 산 배경'도 보유로 간주(계약 line 64 그룹공유). stale dist '개인소유' 정책 폐기.
4. prisma.family.update({ where:{id:user.familyId}, data:{ appliedBackgroundId: itemId } })
5. return this.getInventory(userId)   // inventory 전체 반환(2번과 동일 형태)
```

---

## 6. 응답 직렬화 키 고정 매핑 (B3 / 02-qa §3.5)

| 엔드포인트 | 반환 타입(TS) | 직렬화 JSON 키(계약 1:1) | 비고 |
|---|---|---|---|
| GET /shop/catalog | `ShopItemDTO[]` | `[{ id, kind, name, price, assetName?, slot?, isSeasonal?, sortOrder? }]` | wrapper 없음. optional 미존재 키 생략. |
| GET /shop/inventory | `ShopInventoryDTO` | `{ ownedDecorationIds?, equippedDecorations?, ownedBackgroundIds?, appliedBackgroundId? }` | appliedBackgroundId **항상 채움**(B6). |
| POST /shop/purchase | `PurchaseResponse` | `{ heartsRemaining }` | 최상위 키 정확히 하나. |
| POST /shop/decoration/equip | `EquipDecorationResponse` | `{ equippedDecorations: { head?, back?, feet? } }` | **wrapper 키 equippedDecorations 필수**. null 슬롯 생략. |
| POST /shop/background/apply | `ShopInventoryDTO` | inventory 와 동일 4키 | apply 후 동기화용. |

> 검증법: 빌드 후 `dist/swagger.json`(tsoa spec) 에서 위 5개 schema 의 properties 키가 계약(`00-contract.md:16-35`)과 글자 단위 일치하는지 확인. iOS 디코더가 키 매핑이라 오타/누락/추가 = 계약 위반.

---

## 7. 빌드 / 배포 / 마이그레이션 절차

순서 엄수(과거 404·404 함정 회피):
1. **stale dist 제거**(첫 단계): `rm -f dist/controllers/Shop* dist/services/Shop* dist/constants/shop*` (B5).
2. **schema 반영**: `npm run db:generate`(prisma client 재생성, 신규 모델 타입 필요) → 로컬/스테이징 `npm run db:push`(= `prisma db push`. `migrations` 부재라 push 방식, R3). 신규 컬럼은 전부 nullable/신규 테이블 → **무중단**.
3. **빌드**: `npm run build`(= `tsoa spec-and-routes && tsc`). ⚠️ **신규 컨트롤러는 이 단계가 `src/routes/routes.ts` 에 ShopController 라우트를 자동 등록**한다. 이거 없이 deploy 하면 `/shop/*` 404(계약 line 69-70, 과거 함정). `routes.ts` 수동 편집 금지.
4. **로컬 검증**: `npx tsc --noEmit`(타입체크) → `npm test`(jest) → `npm run dev` 로 swagger(`/docs` 또는 `swagger.json`)에서 5개 경로 노출 + 스키마 키 확인.
5. **배포**: dev 먼저 `npm run deploy:dev` → 스모크 → `npm run deploy:prod`. **prod 도 deploy 전 build 와 db:push 선행**(deploy:prod 는 `rm -rf .build` 후 serverless deploy 만 함 → routes.ts/dist 가 최신이어야 함).

배포 체크리스트(R3): ① `db push` 완료 ② `npm run build` 로 routes.ts 갱신 확인 ③ swagger 에 5경로 노출 ④ deploy.

---

## 8. 테스트 계획 (`src/services/__tests__/ShopService.test.ts`)

기존 `AnswerService.test.ts` 의 prisma mock 패턴(`jest.mock('../../utils/prisma', ...)`, `$transaction` 배열 mock `:14-19`) 그대로 차용. mock 대상: `user.findUnique/update`, `userDecoration.findUnique/findMany/create`, `groupBackground.findUnique/findMany/create`, `family.findUnique/update`, `familyMembership.findUnique/updateMany`, `$transaction`.

| 케이스 | 시나리오 | 기대 |
|---|---|---|
| purchase: 정상 차감 | 미보유 장식 price 35, hearts 50 | `$transaction` 호출, updateMany count=1, 재조회 hearts=15 반환 |
| purchase: 잔액부족 | updateMany count=0 | `badRequest('하트가 부족합니다.')` |
| purchase: 중복구매 멱등 | 보유 선검사 hit(userDecoration 존재) | 차감/트랜잭션 **미호출**, 현재 hearts 그대로 반환 |
| purchase: 가격0 기본배경 | itemId=bg_cozy_home, 미보유 | 차감 없이 create, 현재 hearts 반환 |
| purchase: P2002 동시구매 | create 가 P2002 throw | 트랜잭션 롤백 가정, 재조회 hearts 반환(에러 전파 안 함) |
| purchase: 무가족 | user.familyId=null | `badRequest('활성 그룹이 없습니다.')` |
| purchase: 없는 아이템 | itemId='zzz' | `notFound('아이템')` |
| equip: 해제 | itemId undefined, slot=head | user.update `{equippedHead:null}`, 응답 head 키 없음 |
| equip: 무가족 장착 | familyId=null, 소유한 deco | 허용, 컬럼 set(B2) |
| equip: 잘못된 slot | slot='hand' | `badRequest('잘못된 슬롯입니다.')` (소유검사 전) |
| equip: 슬롯 불일치 | head 장식을 feet 로 | `badRequest('슬롯이 일치하지 않습니다.')` |
| equip: 미보유 | 소유행 없음 | `forbidden('보유하지 않은 아이템입니다.')` |
| apply: kind 검증 | itemId=deco_* (장식) | `badRequest('배경이 아닙니다.')` |
| apply: 미보유 배경 | groupBackground 없음 & 기본배경 아님 | `forbidden('보유하지 않은 배경입니다.')` |
| apply: 다른멤버 구매 배경 | 같은 familyId 의 groupBackground 존재 | 적용 성공(그룹공유) |
| apply: 무가족 | familyId=null | `badRequest('활성 그룹이 없습니다.')` |
| inventory: 무가족 | familyId=null | 배경=[bg_cozy_home], applied=bg_cozy_home, 장식 정상 |
| inventory: 병합 | deco 2개+gb 1개 | owned 병합, 기본배경 주입, applied 채움 |

(선택) catalog: `getCatalog().length===15`, 배경6/장식9, sortOrder 배열순서 유지.

---

## 9. 브랜치 전략

- 현재 `fix/MG-141-push-soft-logout` 은 무관한 작업 → **새 브랜치에서 진행**. main 직접 작업 금지(메모리 워크플로우).
- Jira 이슈 없음 → feat 브랜치 권고: **`feat/shop-server`** (또는 `feat/shop-backend`). main(또는 최신 base)에서 분기.
- 커밋 분할 권고(리뷰 단위):
  1. `chore(shop): remove stale dist Shop remnants` (삭제 3종, B5)
  2. `feat(shop): add prisma models GroupBackground/UserDecoration + Family/User columns`
  3. `feat(shop): add catalog constants + Shop DTOs`
  4. `feat(shop): add ShopController + ShopService (5 endpoints)`
  5. `test(shop): add ShopService unit tests`
- PR 1개로 묶되 위 커밋 단위 유지. PR 본문에 "배포 전 `db push` + `npm run build` 필수" 체크리스트 명시.

---

## 10. Blocker(B1~B6) 해소 매핑

| Blocker | 요지 | 본 계획에서 해소 위치 | 근거(파일:라인) |
|---|---|---|---|
| **B1** 트랜잭션·멱등 순서 | 보유 선검사→(price>0)단일 $transaction[updateMany gte + create]→count 가드→P2002 롤백 환원 | §5.3 purchase 전체(1~6단계, 헬퍼) | `02-qa.md:28-49`, `AnswerService.ts:415-437` |
| **B2** 무가족 일관성 | 장식=User 전역 확정. equip/inventory 무가족 허용, purchase/apply 무가족 차단 | §5.4 equip(가드 없음)·§5.2 inventory(else 분기)·§5.3/§5.5(familyId 가드)·§8 무가족 케이스 | `02-qa.md:51-58,94-101` |
| **B3** 응답 wrapper JSON 키 | purchase `{heartsRemaining}`, equip `{equippedDecorations}` 래퍼, inventory/apply 4키, catalog 배열 | §4.1 DTO 정의 + §6 직렬화 매핑표 | `02-qa.md:60-68`, `00-contract.md:12-13,16-35` |
| **B4** kind 라우팅·해제·apply kind | purchase kind 분기, equip slot-always-first+해제 무소유검사, apply kind 검증 추가 | §5.3(ownershipCreateOp 분기)·§5.4(1·3단계)·§5.5(2단계) | `02-qa.md:70-76` |
| **B5** stale dist 제거 | 첫 단계 dist 6파일 삭제, 잔재 컬럼명/정책 차용 금지 | §1 표(8~10), §7 1단계, §9 커밋1 | `02-qa.md:78-83`, dist 잔재 확인 |
| **B6** appliedBackgroundId 항상 채움 | `?? DEFAULT_BACKGROUND_ID`, 무가족도 bg_cozy_home. "키 생략" 폐기 | §5.2 appliedBackgroundId 산출·§5.5·§6 비고 | `02-qa.md:85-88`, `01-plan.md:231-232` |

---

## 11. 구현자 주의 함정 (압축)

1. **routes.ts 자동생성**: 신규 ShopController 추가 후 `npm run build`(tsoa spec-and-routes) 없이 deploy 하면 `/shop/*` 404. `src/routes/routes.ts` 를 손으로 고치지 말 것(자동 생성물).
2. **userId ≠ PK**: `req.user.userId` 는 `User.userId` 컬럼(JWT sub)이지 `User.id`(PK)가 아니다. 항상 `findUnique({where:{userId}})` 로 해석 후 **장식=user.id(PK), 배경=user.familyId** 로 쿼리. UserDecoration.userId 에는 PK 를 넣는다.
3. **heartsRemaining 은 updateMany 반환값으로 못 뽑음**: `updateMany` 는 `{count}` 만 반환 → grantAdHearts 의 `updated.hearts` 방식 불가. count===0 가드 후 `FamilyMembership.hearts` **재조회**로 산출(R2). 그리고 차감+create 는 **반드시 같은 `$transaction([])`** 안(P2002 시 차감 롤백, R1).
