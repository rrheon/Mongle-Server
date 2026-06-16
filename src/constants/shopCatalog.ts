// 상점 카탈로그 — id·가격·이름·sortOrder 는 iOS 클라이언트(00-contract.md 표)와 1:1 일치해야 한다.
// 아이템은 서버 DB 에 저장하지 않고 이 상수 테이블을 단일 진실값으로 사용한다.
// 구매/장착/적용 시 서버는 항상 CATALOG_BY_ID 로 id 를 검증한다.
//
// 주의(02-qa §3.6): sortOrder 는 kind/slot 별로 1부터 재시작하고 배경은 4가 결번이라
// 전역 단일 정렬이 불가능하다. 따라서 catalog 응답 정렬은 sortOrder 가 아니라
// 이 배열 순서(= 계약 표 순서)를 신뢰한다. 배열 순서가 곧 노출 순서다.

export type ShopItemKind = 'background' | 'decoration';

export type DecorationSlot = 'head' | 'back' | 'feet';

export interface ShopCatalogItem {
  id: string;
  kind: ShopItemKind;
  name: string;
  price: number;
  assetName?: string;
  slot?: DecorationSlot;
  isSeasonal?: boolean;
  sortOrder?: number;
}

// 기본 배경 — 모든 그룹이 별도 구매 없이 항상 소유. 가격 0.
export const DEFAULT_BACKGROUND_ID = 'bg_cozy_home';

// 배열 순서 = 계약 표(00-contract.md:39-59) 순서. 값은 계약 표를 글자 그대로 복사.
export const SHOP_CATALOG: ShopCatalogItem[] = [
  // 배경 (kind=background) — 개인(유저) 소유, 적용은 그룹 공유
  { id: 'bg_cozy_home', kind: 'background', name: '따뜻한 집', price: 0, sortOrder: 0 },
  { id: 'bg_spring_field', kind: 'background', name: '봄 들판', price: 50, sortOrder: 1 },
  { id: 'bg_beach', kind: 'background', name: '바닷가', price: 50, sortOrder: 2 },
  { id: 'bg_space', kind: 'background', name: '우주', price: 50, sortOrder: 3 },
  { id: 'bg_snow_village', kind: 'background', name: '눈오는 마을', price: 50, isSeasonal: true, sortOrder: 5 },
  { id: 'bg_cherry_blossom', kind: 'background', name: '벚꽃길', price: 50, sortOrder: 6 },

  // 장식 (kind=decoration) — 개인(유저) 소유. slot 당 1개 장착.
  { id: 'deco_flower_crown', kind: 'decoration', name: '들꽃 화관', price: 50, slot: 'head', sortOrder: 1 },
  { id: 'deco_star_halo', kind: 'decoration', name: '별 후광', price: 50, slot: 'head', sortOrder: 2 },
  { id: 'deco_satin_ribbon', kind: 'decoration', name: '새틴 리본', price: 50, slot: 'head', sortOrder: 3 },
  { id: 'deco_balloon_bunch', kind: 'decoration', name: '풍선 다발', price: 50, slot: 'head', sortOrder: 4 },
  { id: 'deco_santa_hat', kind: 'decoration', name: '산타 모자', price: 50, slot: 'head', isSeasonal: true, sortOrder: 5 },
  { id: 'deco_angel_wings', kind: 'decoration', name: '천사 날개', price: 50, slot: 'back', sortOrder: 1 },
  { id: 'deco_cape', kind: 'decoration', name: '망토', price: 50, slot: 'back', sortOrder: 2 },
  { id: 'deco_sneakers', kind: 'decoration', name: '운동화', price: 50, slot: 'feet', sortOrder: 1 },
  { id: 'deco_cloud_pad', kind: 'decoration', name: '구름 받침', price: 50, slot: 'feet', sortOrder: 2 },
];

export const CATALOG_BY_ID: Record<string, ShopCatalogItem> = SHOP_CATALOG.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<string, ShopCatalogItem>
);
