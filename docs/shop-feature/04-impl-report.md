# Shop 기능 — 구현 정합화 리포트 (04-impl-report)

상태: 기존 `feat/shop-api` 구현을 계약(00-contract)·QA 확정 규칙(02-qa B1~B6)에 정합화하고 풀 빌드까지 검증 완료.
중요 전제: **배경 소유 = 개인(유저) 단위(`UserBackground`)** 가 확정 모델. 03-code-plan 의 `GroupBackground` 권고는 폐기됨. 기존 개인소유 코드를 정답으로 유지.

---

## 정합화 체크리스트 결과 (1~8)

### 1. 엔드포인트 경로 정확 일치 — 이미충족
`src/controllers/ShopController.ts` 의 tsoa 데코레이터가 계약과 1:1.
- `@Route('shop')` + `@Get('catalog')` / `@Get('inventory')` / `@Post('purchase')` / `@Post('decoration/equip')` / `@Post('background/apply')`.
- 빌드 후 `src/routes/routes.ts` 에 5경로 자동 등록 확인(아래 grep 증거).

### 2. 응답 JSON 키 1:1 (B3) — 이미충족
`src/models/index.ts:203-233` DTO + tsoa 직렬화 결과(`dist/swagger.json`)가 계약과 글자 단위 일치:
- `ShopCatalogItemDto`: `[id, kind, name, price, assetName, slot, isSeasonal, sortOrder]`
- `ShopInventoryResponse`: `[ownedDecorationIds, equippedDecorations, ownedBackgroundIds, appliedBackgroundId]`
- `PurchaseResponse`: `[heartsRemaining]`
- `EquipResponse`: `[equippedDecorations]` (wrapper 키 존재)

### 3. 카탈로그 15종 정확성 — **수정함** (핵심 갭)
기존 `src/constants/shopCatalog.ts` 가 계약 표와 다수 불일치 → 계약 표 글자 그대로로 교체.
수정 파일: `src/constants/shopCatalog.ts:30-46`.
| 항목 | 기존(틀림) | 수정(계약) |
|---|---|---|
| `bg_forest` | price 45, sortOrder 3 존재 | **삭제**(계약에 없음. 16종→15종) |
| `bg_cozy_home` name | 아늑한 집 | 따뜻한 집 |
| `bg_spring_field` price | 20 | 50 |
| `bg_beach` price | 35 | 50 |
| `bg_space` price/sortOrder | 50 / 4 | 50 / 3 |
| `bg_snow_village` | 눈마을 / 60 / sortOrder 6 | 눈오는 마을 / 50 / sortOrder 5, seasonal |
| `bg_cherry_blossom` | 60 / sortOrder 5 | 50 / sortOrder 6 |
| `deco_flower_crown` name | 꽃 화관 | 들꽃 화관 |
| `deco_cloud_pad` name | 구름 방석 | 구름 받침 |
| 장식 sortOrder 전반 | 전역 10~31 | slot 별 1부터 재시작(계약: head 1-5, back 1-2, feet 1-2) |

부수 수정: 장식 sortOrder 가 slot 별로 재시작·결번이라 **전역 sortOrder 정렬 불가**(02-qa §3.6).
`getCatalog()` 가 `sort(by sortOrder)` 하던 것을 **배열 순서 보존**으로 변경(`src/services/ShopService.ts:29-36`).
관련 테스트 갱신: `ShopService.test.ts:77-103`("sortOrder 오름차순" 테스트 폐기 → 배열 순서/개수/가격·이름 정합 테스트 3종으로 교체).

### 4. B1 구매 트랜잭션 — 이미충족
`src/services/ShopService.ts:87-137`.
- 보유 선검사(`userDecoration.findUnique`/`userBackground.findUnique` 또는 기본배경)로 멱등 빠른경로 → 보유/가격0 이면 차감·create 없이 현재 hearts 반환.
- 미보유 & price>0: 단일 `prisma.$transaction(async tx => { updateMany(hearts gte price, decrement); if count===0 throw badRequest; create })`. 차감과 소유행 create 가 **동일 트랜잭션** → count===0 또는 create 실패 시 차감 롤백. (인터랙티브 트랜잭션 형태이나 03-plan 의 배열형과 원자성 동일.)

### 5. B2 무가족 일관성 — 이미충족
- catalog: 인증만(개인화 없음). inventory: `resolveUser` 만, familyId 없으면 배경=`[bg_cozy_home]`. equip: familyId 가드 없음(장식=User 전역, 무가족 허용). purchase/apply: `if (!user.familyId) throw badRequest`.

### 6. B4 검증 — 이미충족 (+슬롯 검증 순서 보정)
- apply: `item.kind !== 'background'` → badRequest. purchase: `item.kind` 로 `userDecoration` vs `userBackground` 분기. equip: slot 값 검증 + slot 일치 검증 + 소유 검증 + 해제(itemId 없음) 경로.
- **보정**: equip 의 slot 값 검증을 `resolveUser` **앞**으로 이동(02-qa §3.4 "항상 먼저"). `src/services/ShopService.ts:148-155`.

### 7. B5 stale dist 정리 — 확인+정리
- `dist/` 는 `.gitignore` 대상이며 **git 추적 0건**(`git ls-files dist/` → 빈 결과). 따라서 배포/리포 혼선 없음(deploy 는 빌드 산출물을 새로 생성).
- 그래도 로컬 빌드 깨끗하게: `rm -f dist/controllers/Shop* dist/services/Shop* dist/constants/shop*` 후 `npm run build` 로 재생성. 현재 dist 의 Shop 산출물은 신규 구현 기준(과거 충돌 정책 아님).

### 8. B6 appliedBackgroundId — **결정: 현행 유지(null 이면 키 생략)**
근거(택1, 과한 변경 금지):
- 확정 모델에서 **배경 소유=개인**, **적용(applied)=그룹 공유**. 무가족 유저는 그룹이 없으므로 "그룹 적용 배경"이 실제로 존재하지 않는다. 여기에 `bg_cozy_home` 을 강제 주입하면 "그룹이 따뜻한 집을 적용 중"이라는 없는 상태를 표현하게 됨.
- iOS `ShopInventoryDTO.appliedBackgroundId` 는 optional 이고, 부재 시 클라가 기본 배경으로 폴백 → 기능상 무해.
- 기존 통과 테스트(`ShopService.test.ts:104` 무가족 `appliedBackgroundId` undefined)와도 일관.
→ 코드 변경 없음(`src/services/ShopService.ts:64-78` 유지). 가족이 있고 `Family.appliedBackgroundId` 가 채워진 경우에만 키 노출.

---

## 빌드/테스트 결과

- `npx prisma generate`: OK (Shop 모델 = UserDecoration/UserBackground/Family.appliedBackgroundId/User.equipped*Id, 이미 schema 에 존재).
- `npx tsc --noEmit`: **0 에러** (exit 0).
- `npx jest ShopService`: **23 passed / 23**(기존 22 + catalog 테스트 재구성으로 1 증가).
- `npm run build`(= `tsoa spec-and-routes && tsc`): **성공(exit 0)**.

### routes.ts shop 경로 grep 증거 (404 함정 방지)
```
$ grep -n "shop" src/routes/routes.ts
953:  app.get('/shop/catalog',
984:  app.get('/shop/inventory',
1016: app.post('/shop/purchase',
1048: app.post('/shop/decoration/equip',
1080: app.post('/shop/background/apply',
```
### swagger 스키마 키 증거 (계약 1:1)
```
ShopCatalogItemDto ["id","kind","name","price","assetName","slot","isSeasonal","sortOrder"]
ShopInventoryResponse ["ownedDecorationIds","equippedDecorations","ownedBackgroundIds","appliedBackgroundId"]
PurchaseResponse ["heartsRemaining"]
EquipResponse ["equippedDecorations"]
```

---

## DB push / deploy 절차 (실행 안 함 — 사용자 몫)
신규 테이블/컬럼(`user_decorations`, `user_backgrounds`, `families.applied_background_id`, `users.equipped_head/back/feet_id`)은 전부 신규 테이블 또는 nullable 컬럼 → 무중단.
1. `npm run db:generate` (prisma client)
2. 스테이징/프로드 `npm run db:push` (`prisma/migrations` 부재 → push 방식)
3. `npm run build` (routes.ts/dist 갱신 — **deploy 전 필수**, 신규 컨트롤러 404 함정)
4. swagger 에서 5경로 노출 확인 → `deploy:dev` 스모크 → `deploy:prod`
배포 체크리스트: ① db push ② build(routes.ts 갱신) ③ swagger 5경로 ④ deploy.

---

## 남은 후속
- **iOS 카피 모순(중요)**: 계약/iOS 주석에 "배경 = 가족(그룹) 공유, 구매 시 가족 전원에게 개방"(`00-contract.md:38,64`) 문구가 있으나, **확정 서버 모델은 배경 개인소유(`UserBackground`)**. 즉 "한 명이 사면 가족 전원 보유"가 아니라 "산 본인만 보유, 적용만 그룹 공유". iOS 상점 UI 의 "가족 전원 개방" 류 카피를 개인소유 결정에 맞게 수정 필요(예: "내가 산 배경을 가족 홈에 적용").
- `assetName` 은 카탈로그/계약 모두 미명시 → 현재 전 항목 생략. iOS 자산명 확정 시 채워 넣기.
- 시즌 게이팅 없음(연중 판매 확정, 02-qa R4).
