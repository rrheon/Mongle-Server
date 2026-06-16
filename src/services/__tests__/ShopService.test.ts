const mockPrismaUserFindUnique = jest.fn();
const mockPrismaUserUpdate = jest.fn();
const mockPrismaFamilyFindUnique = jest.fn();
const mockPrismaFamilyUpdate = jest.fn();
const mockPrismaFamilyMembershipFindUnique = jest.fn();
const mockPrismaFamilyMembershipUpdateMany = jest.fn();
const mockPrismaUserDecorationFindUnique = jest.fn();
const mockPrismaUserDecorationFindMany = jest.fn();
const mockPrismaUserDecorationCreate = jest.fn();
const mockPrismaUserBackgroundFindUnique = jest.fn();
const mockPrismaUserBackgroundFindMany = jest.fn();
const mockPrismaUserBackgroundCreate = jest.fn();
const mockPrismaTransaction = jest.fn();

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: mockPrismaUserFindUnique,
      update: mockPrismaUserUpdate,
    },
    family: {
      findUnique: mockPrismaFamilyFindUnique,
      update: mockPrismaFamilyUpdate,
    },
    familyMembership: {
      findUnique: mockPrismaFamilyMembershipFindUnique,
      updateMany: mockPrismaFamilyMembershipUpdateMany,
    },
    userDecoration: {
      findUnique: mockPrismaUserDecorationFindUnique,
      findMany: mockPrismaUserDecorationFindMany,
      create: mockPrismaUserDecorationCreate,
    },
    userBackground: {
      findUnique: mockPrismaUserBackgroundFindUnique,
      findMany: mockPrismaUserBackgroundFindMany,
      create: mockPrismaUserBackgroundCreate,
    },
    $transaction: mockPrismaTransaction,
  },
}));

import { ShopService } from '../ShopService';
import { SHOP_CATALOG, DEFAULT_BACKGROUND_ID } from '../../constants/shopCatalog';

const service = new ShopService();

const mockUser = {
  id: 'db-user-id',
  userId: 'kakao:123',
  familyId: 'family-id',
  equippedHeadId: null as string | null,
  equippedBackId: null as string | null,
  equippedFeetId: null as string | null,
};

beforeEach(() => {
  jest.clearAllMocks();
  // 배경 소유는 개인 단위 — 기본적으로 빈 목록으로 둔다(개별 테스트에서 덮어씀).
  mockPrismaUserBackgroundFindMany.mockResolvedValue([]);
  mockPrismaUserDecorationFindMany.mockResolvedValue([]);
  // $transaction(fn) → txProxy 패턴. updateMany/create 를 동일 mock 으로 연결.
  mockPrismaTransaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      const txProxy = {
        familyMembership: { updateMany: mockPrismaFamilyMembershipUpdateMany },
        userDecoration: { create: mockPrismaUserDecorationCreate },
        userBackground: { create: mockPrismaUserBackgroundCreate },
      };
      return (arg as (tx: unknown) => Promise<unknown>)(txProxy);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
});

describe('ShopService.getCatalog', () => {
  it('전체 카탈로그를 반환한다(배경 6 + 장식 9 = 15)', () => {
    const catalog = service.getCatalog();
    expect(catalog.length).toBe(SHOP_CATALOG.length);
    expect(catalog.length).toBe(15);
    expect(catalog.filter((i) => i.kind === 'background')).toHaveLength(6);
    expect(catalog.filter((i) => i.kind === 'decoration')).toHaveLength(9);
  });

  it('SHOP_CATALOG 배열 순서를 그대로 보존한다(02-qa §3.6)', () => {
    const catalog = service.getCatalog();
    expect(catalog.map((i) => i.id)).toEqual(SHOP_CATALOG.map((i) => i.id));
  });

  it('계약 표의 가격/이름과 일치한다(샘플 검증)', () => {
    const byId = Object.fromEntries(service.getCatalog().map((i) => [i.id, i]));
    expect(byId['bg_cozy_home']).toMatchObject({ name: '따뜻한 집', price: 0 });
    expect(byId['bg_spring_field']).toMatchObject({ name: '봄 들판', price: 50 });
    expect(byId['bg_snow_village']).toMatchObject({ name: '눈오는 마을', price: 50, isSeasonal: true });
    expect(byId['deco_satin_ribbon']).toMatchObject({ name: '새틴 리본', price: 50, slot: 'head' });
    expect(byId['deco_santa_hat']).toMatchObject({ price: 50, slot: 'head', isSeasonal: true });
    // 계약에 없는 bg_forest 가 제거됐는지 확인
    expect(byId['bg_forest']).toBeUndefined();
  });
});

describe('ShopService.getInventory', () => {
  it('존재하지 않는 유저는 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(null);
    await expect(service.getInventory('unknown')).rejects.toThrow();
  });

  it('무가족 유저도 기본 배경(bg_cozy_home)을 보유한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({ ...mockUser, familyId: null });

    const inv = await service.getInventory('kakao:123');
    expect(inv.ownedBackgroundIds).toContain(DEFAULT_BACKGROUND_ID);
    expect(inv.ownedDecorationIds).toEqual([]);
    // 무가족은 적용 배경(그룹 공유)이 없다
    expect(inv.appliedBackgroundId).toBeUndefined();
  });

  it('장착 중인 꾸미기가 응답에 반영된다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({
      ...mockUser,
      familyId: null,
      equippedHeadId: 'deco_flower_crown',
      equippedFeetId: 'deco_sneakers',
    });
    mockPrismaUserDecorationFindMany.mockResolvedValue([
      { itemId: 'deco_flower_crown' },
      { itemId: 'deco_sneakers' },
    ]);

    const inv = await service.getInventory('kakao:123');
    expect(inv.equippedDecorations.head).toBe('deco_flower_crown');
    expect(inv.equippedDecorations.feet).toBe('deco_sneakers');
    expect(inv.equippedDecorations.back).toBeUndefined();
    expect(inv.ownedDecorationIds).toEqual(['deco_flower_crown', 'deco_sneakers']);
  });

  it('본인이 소유한 배경 + 그룹 적용 배경을 포함한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    // 본인이 소유한 배경(개인 단위)
    mockPrismaUserBackgroundFindMany.mockResolvedValue([{ itemId: 'bg_beach' }]);
    // 그룹에 적용 중인 배경(공유)
    mockPrismaFamilyFindUnique.mockResolvedValue({ id: 'family-id', appliedBackgroundId: 'bg_beach' });

    const inv = await service.getInventory('kakao:123');
    expect(inv.ownedBackgroundIds).toContain(DEFAULT_BACKGROUND_ID);
    expect(inv.ownedBackgroundIds).toContain('bg_beach');
    expect(inv.appliedBackgroundId).toBe('bg_beach');
  });

  it('적용 배경은 그룹 공유라 본인 미소유여도 응답에 노출된다', async () => {
    // a 가 적용한 배경을 b 가 보는 케이스 — b 는 bg_beach 미소유지만 적용중으로 보임.
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaUserBackgroundFindMany.mockResolvedValue([]); // b 미소유
    mockPrismaFamilyFindUnique.mockResolvedValue({ id: 'family-id', appliedBackgroundId: 'bg_beach' });

    const inv = await service.getInventory('kakao:123');
    expect(inv.appliedBackgroundId).toBe('bg_beach');
    expect(inv.ownedBackgroundIds).not.toContain('bg_beach'); // 소유는 아님
  });
});

describe('ShopService.purchase', () => {
  it('무가족 유저는 구매할 수 없다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({ ...mockUser, familyId: null });
    await expect(service.purchase('kakao:123', 'bg_beach')).rejects.toThrow('그룹 가입 후 이용 가능');
  });

  it('존재하지 않는 아이템은 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    await expect(service.purchase('kakao:123', 'nope')).rejects.toThrow();
  });

  it('꾸미기 정상 구매 시 하트 차감 + create 호출', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaUserDecorationFindUnique.mockResolvedValue(null); // 미보유
    mockPrismaFamilyMembershipUpdateMany.mockResolvedValue({ count: 1 });
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ hearts: 50 });

    const result = await service.purchase('kakao:123', 'deco_flower_crown'); // price 50
    expect(mockPrismaFamilyMembershipUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hearts: { decrement: 50 } } })
    );
    expect(mockPrismaUserDecorationCreate).toHaveBeenCalled();
    expect(result.heartsRemaining).toBe(50);
  });

  it('이미 소유한 아이템은 멱등 — 재차감/create 없이 현재 하트 반환', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaUserDecorationFindUnique.mockResolvedValue({ id: 'owned' }); // 이미 보유
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ hearts: 50 });

    const result = await service.purchase('kakao:123', 'deco_flower_crown');
    expect(mockPrismaFamilyMembershipUpdateMany).not.toHaveBeenCalled();
    expect(mockPrismaUserDecorationCreate).not.toHaveBeenCalled();
    expect(result.heartsRemaining).toBe(50);
  });

  it('무료 아이템(기본 배경)은 멱등 — 차감 없음', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ hearts: 10 });

    const result = await service.purchase('kakao:123', DEFAULT_BACKGROUND_ID); // price 0
    expect(mockPrismaFamilyMembershipUpdateMany).not.toHaveBeenCalled();
    expect(result.heartsRemaining).toBe(10);
  });

  it('하트가 부족하면(updateMany count 0) 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaUserDecorationFindUnique.mockResolvedValue(null);
    mockPrismaFamilyMembershipUpdateMany.mockResolvedValue({ count: 0 }); // 잔액 부족

    await expect(service.purchase('kakao:123', 'deco_flower_crown')).rejects.toThrow('하트가 부족합니다.');
    expect(mockPrismaUserDecorationCreate).not.toHaveBeenCalled();
  });

  it('배경 구매 시 본인 소유로 userBackground.create 호출', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaUserBackgroundFindUnique.mockResolvedValue(null); // 미보유
    mockPrismaFamilyMembershipUpdateMany.mockResolvedValue({ count: 1 });
    mockPrismaFamilyMembershipFindUnique.mockResolvedValue({ hearts: 0 });

    await service.purchase('kakao:123', 'bg_beach'); // price 50
    expect(mockPrismaUserBackgroundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'db-user-id', itemId: 'bg_beach' } })
    );
  });
});

describe('ShopService.equipDecoration', () => {
  it('보유한 아이템을 장착하면 슬롯에 반영된다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaUserDecorationFindUnique.mockResolvedValue({ id: 'owned' });
    mockPrismaUserUpdate.mockResolvedValue({
      ...mockUser,
      equippedHeadId: 'deco_flower_crown',
    });

    const result = await service.equipDecoration('kakao:123', 'head', 'deco_flower_crown');
    expect(mockPrismaUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { equippedHeadId: 'deco_flower_crown' } })
    );
    expect(result.equippedDecorations.head).toBe('deco_flower_crown');
  });

  it('미보유 아이템 장착은 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaUserDecorationFindUnique.mockResolvedValue(null);
    await expect(
      service.equipDecoration('kakao:123', 'head', 'deco_flower_crown')
    ).rejects.toThrow('보유하지 않은 아이템입니다.');
  });

  it('슬롯이 일치하지 않으면 에러를 던진다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    // deco_flower_crown 은 head 인데 feet 슬롯에 장착 시도
    await expect(
      service.equipDecoration('kakao:123', 'feet', 'deco_flower_crown')
    ).rejects.toThrow('슬롯이 일치하지 않습니다.');
  });

  it('itemId 미전달 시 슬롯을 해제한다(null)', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({ ...mockUser, equippedHeadId: 'deco_flower_crown' });
    mockPrismaUserUpdate.mockResolvedValue({ ...mockUser, equippedHeadId: null });

    const result = await service.equipDecoration('kakao:123', 'head');
    expect(mockPrismaUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { equippedHeadId: null } })
    );
    expect(result.equippedDecorations.head).toBeUndefined();
  });
});

describe('ShopService.applyBackground', () => {
  it('무가족 유저는 적용할 수 없다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue({ ...mockUser, familyId: null });
    await expect(service.applyBackground('kakao:123', 'bg_beach')).rejects.toThrow('그룹 가입 후 이용 가능');
  });

  it('본인이 소유한 배경을 정상 적용한다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaUserBackgroundFindUnique.mockResolvedValue({ id: 'owned' }); // 본인 소유
    mockPrismaFamilyUpdate.mockResolvedValue({ id: 'family-id', appliedBackgroundId: 'bg_beach' });
    // applyBackground 끝에서 getInventory 재호출
    mockPrismaUserBackgroundFindMany.mockResolvedValue([{ itemId: 'bg_beach' }]);
    mockPrismaFamilyFindUnique.mockResolvedValue({ id: 'family-id', appliedBackgroundId: 'bg_beach' });

    const result = await service.applyBackground('kakao:123', 'bg_beach');
    expect(mockPrismaFamilyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { appliedBackgroundId: 'bg_beach' } })
    );
    expect(result.appliedBackgroundId).toBe('bg_beach');
  });

  it('기본 배경은 미보유여도 적용 가능하다', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaFamilyUpdate.mockResolvedValue({ id: 'family-id', appliedBackgroundId: DEFAULT_BACKGROUND_ID });
    mockPrismaFamilyFindUnique.mockResolvedValue({ id: 'family-id', appliedBackgroundId: DEFAULT_BACKGROUND_ID });

    const result = await service.applyBackground('kakao:123', DEFAULT_BACKGROUND_ID);
    // 기본 배경은 userBackground 조회 없이 통과
    expect(mockPrismaUserBackgroundFindUnique).not.toHaveBeenCalled();
    expect(result.appliedBackgroundId).toBe(DEFAULT_BACKGROUND_ID);
  });

  it('본인이 소유하지 않은 배경은 적용할 수 없다(다른 멤버가 산 배경 포함)', async () => {
    mockPrismaUserFindUnique.mockResolvedValue(mockUser);
    mockPrismaUserBackgroundFindUnique.mockResolvedValue(null); // 본인 미소유
    await expect(service.applyBackground('kakao:123', 'bg_beach')).rejects.toThrow('보유하지 않은 배경입니다.');
  });
});
