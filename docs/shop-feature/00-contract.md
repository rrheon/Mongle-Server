# Shop 기능 — iOS ↔ 서버 계약 (고정 기준)

iOS 클라이언트는 이미 `/shop/*`를 호출하도록 구현돼 있고, 서버 엔드포인트만 미구현(404) 상태다.
**아래 계약은 iOS 코드에서 추출한 확정 사실이며, 서버 구현은 이 형식을 정확히 맞춰야 한다.**
(출처: `Mongle/MongleData/Sources/MongleData/DTOs/ShopDTO.swift`, `.../DataSources/Remote/API/APIEndpoint.swift`, `MongleFeatures/.../Shop/{BackgroundCatalog,DecorationCatalog}.swift`)

## 엔드포인트
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/shop/catalog` | – | `ShopItemDTO[]` |
| GET | `/shop/inventory` | – | `ShopInventoryDTO` |
| POST | `/shop/purchase` | `{ itemId: string }` | `{ heartsRemaining: number }` |
| POST | `/shop/decoration/equip` | `{ slot: string, itemId?: string }` | `{ equippedDecorations: EquippedDecorationsDTO }` |
| POST | `/shop/background/apply` | `{ itemId: string }` | `ShopInventoryDTO` |

## DTO 형식 (서버 응답이 맞춰야 할 JSON)
```
ShopItemDTO {
  id: string
  kind: "background" | "decoration"
  name: string
  price: number
  assetName?: string
  slot?: "head" | "back" | "feet"   // decoration 만
  isSeasonal?: boolean
  sortOrder?: number
}
EquippedDecorationsDTO { head?: string; back?: string; feet?: string }
ShopInventoryDTO {
  ownedDecorationIds?: string[]
  equippedDecorations?: EquippedDecorationsDTO
  ownedBackgroundIds?: string[]
  appliedBackgroundId?: string
}
```

## 카탈로그 데이터 (iOS 디자인 기준값 — 서버 시드 기준)
### 배경 (kind=background) — **가족(그룹) 공유**
| id | name | price | seasonal | sortOrder |
|---|---|---|---|---|
| bg_cozy_home | 따뜻한 집 | 0 | – | 0 |
| bg_spring_field | 봄 들판 | 50 | – | 1 |
| bg_beach | 바닷가 | 50 | – | 2 |
| bg_space | 우주 | 50 | – | 3 |
| bg_snow_village | 눈오는 마을 | 50 | ✓ | 5 |
| bg_cherry_blossom | 벚꽃길 | 50 | – | 6 |

### 장식 (kind=decoration) — **개인(유저) 소유**
| id | name | price | slot | seasonal | sortOrder |
|---|---|---|---|---|---|
| deco_flower_crown | 들꽃 화관 | 35 | head | – | 1 |
| deco_star_halo | 별 후광 | 40 | head | – | 2 |
| deco_satin_ribbon | 새틴 리본 | 25 | head | – | 3 |
| deco_balloon_bunch | 풍선 다발 | 50 | head | – | 4 |
| deco_santa_hat | 산타 모자 | 60 | head | ✓ | 5 |
| deco_angel_wings | 천사 날개 | 45 | back | – | 1 |
| deco_cape | 망토 | 40 | back | – | 2 |
| deco_sneakers | 운동화 | 30 | feet | – | 1 |
| deco_cloud_pad | 구름 받침 | 35 | feet | – | 2 |

## 핵심 비즈니스 규칙 (iOS 주석에서 추출)
- **구매는 서버 권위**: 서버가 하트를 차감하고 남은 하트(`heartsRemaining`)를 반환한다. (광고 보상 하트 `grantAdHearts`와 동일 패턴)
- **하트는 그룹(가족)별 잔액**이다. (서버 기존 모델: familyId/groupId 기반. `AnswerService`의 user.familyId 패턴 참고)
- **배경 = 가족 공유**: 구매 시 가족 전원에게 개방됨(`ownedBackgroundIds`/`appliedBackgroundId`는 그룹 단위). 기본 배경(price 0, bg_cozy_home)은 항상 보유로 취급.
- **장식 = 개인 소유**: `ownedDecorationIds`/`equippedDecorations`는 유저 단위. equip은 slot당 1개(itemId=null이면 해제).
- 시즌 아이템(눈오는 마을, 산타 모자)도 구매 로직은 동일(가격만 표기 구분).

## 서버 스택
TypeScript + tsoa(컨트롤러→spec/routes 생성) + Prisma + serverless. 빌드: `npm run build` (= `tsoa spec-and-routes && tsc`).
⚠️ 신규 컨트롤러 추가 후 `npm run build` 없이 deploy 하면 tsoa routes.ts 누락 → 404. (과거 함정)
