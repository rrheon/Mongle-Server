// 상점 카탈로그 — id·가격은 iOS 클라이언트와 1:1 일치해야 한다.
// 아이템은 서버 DB 에 저장하지 않고 이 상수 테이블을 단일 진실값으로 사용한다.
// 구매/장착/적용 시 서버는 항상 CATALOG_BY_ID 로 id 를 검증한다.

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

export const SHOP_CATALOG: ShopCatalogItem[] = [
  // 배경
  { id: 'bg_cozy_home', kind: 'background', name: '아늑한 집', price: 0, sortOrder: 0 },
  { id: 'bg_spring_field', kind: 'background', name: '봄 들판', price: 20, sortOrder: 1 },
  { id: 'bg_beach', kind: 'background', name: '바닷가', price: 35, sortOrder: 2 },
  { id: 'bg_forest', kind: 'background', name: '숲속', price: 45, sortOrder: 3 },
  { id: 'bg_space', kind: 'background', name: '우주', price: 50, sortOrder: 4 },
  { id: 'bg_cherry_blossom', kind: 'background', name: '벚꽃길', price: 60, sortOrder: 5 },
  { id: 'bg_snow_village', kind: 'background', name: '눈마을', price: 60, isSeasonal: true, sortOrder: 6 },

  // 꾸미기 — 머리
  { id: 'deco_satin_ribbon', kind: 'decoration', name: '새틴 리본', price: 25, slot: 'head', sortOrder: 10 },
  { id: 'deco_flower_crown', kind: 'decoration', name: '꽃 화관', price: 35, slot: 'head', sortOrder: 11 },
  { id: 'deco_star_halo', kind: 'decoration', name: '별 후광', price: 40, slot: 'head', sortOrder: 12 },
  { id: 'deco_balloon_bunch', kind: 'decoration', name: '풍선 다발', price: 50, slot: 'head', sortOrder: 13 },
  { id: 'deco_santa_hat', kind: 'decoration', name: '산타 모자', price: 60, slot: 'head', isSeasonal: true, sortOrder: 14 },

  // 꾸미기 — 등
  { id: 'deco_cape', kind: 'decoration', name: '망토', price: 40, slot: 'back', sortOrder: 20 },
  { id: 'deco_angel_wings', kind: 'decoration', name: '천사 날개', price: 45, slot: 'back', sortOrder: 21 },

  // 꾸미기 — 발밑
  { id: 'deco_sneakers', kind: 'decoration', name: '운동화', price: 30, slot: 'feet', sortOrder: 30 },
  { id: 'deco_cloud_pad', kind: 'decoration', name: '구름 방석', price: 35, slot: 'feet', sortOrder: 31 },
];

export const CATALOG_BY_ID: Record<string, ShopCatalogItem> = SHOP_CATALOG.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<string, ShopCatalogItem>
);
