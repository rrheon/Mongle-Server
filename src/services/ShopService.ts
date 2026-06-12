import prisma from '../utils/prisma';
import {
  ShopCatalogItemDto,
  ShopInventoryResponse,
  EquippedDecorationsDto,
  EquipResponse,
  PurchaseResponse,
  DecorationSlot,
} from '../models';
import { Errors } from '../middleware/errorHandler';
import { SHOP_CATALOG, CATALOG_BY_ID, DEFAULT_BACKGROUND_ID } from '../constants/shopCatalog';

const VALID_SLOTS: DecorationSlot[] = ['head', 'back', 'feet'];

export class ShopService {
  /**
   * userId(=User.userId 컬럼, JWT sub)로 User 레코드 해석. 서비스 전체에서
   * 항상 user.id(PK) / user.familyId 를 DB 쿼리에 주입한다.
   */
  private async resolveUser(userId: string) {
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) throw Errors.notFound('사용자');
    return user;
  }

  /**
   * 상점 카탈로그 전체 조회 (sortOrder 오름차순). 인증만 필요, 소유 정보 없음.
   */
  getCatalog(): ShopCatalogItemDto[] {
    return [...SHOP_CATALOG].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    );
  }

  /**
   * 보유/장착/적용 현황 조회.
   * - 꾸미기: 본인이 구매한 UserDecoration + 장착 슬롯
   * - 배경 소유: 본인이 구매한 UserBackground (개인 단위). 적용 배경은 그룹 공유.
   * - ownedBackgroundIds 에는 기본 배경(bg_cozy_home)을 항상 포함
   */
  async getInventory(userId: string): Promise<ShopInventoryResponse> {
    const user = await this.resolveUser(userId);

    const decorations = await prisma.userDecoration.findMany({
      where: { userId: user.id },
    });
    const ownedDecorationIds = decorations.map((d) => d.itemId);

    const equippedDecorations: EquippedDecorationsDto = {};
    if (user.equippedHeadId) equippedDecorations.head = user.equippedHeadId;
    if (user.equippedBackId) equippedDecorations.back = user.equippedBackId;
    if (user.equippedFeetId) equippedDecorations.feet = user.equippedFeetId;

    // 배경 소유는 개인 단위(본인이 구매한 것만). 적용(appliedBackgroundId)은 그룹 공유지만,
    // 본인이 소유한 배경만 적용할 수 있으므로 ownedBackgroundIds 는 user 기준으로 집계한다.
    const ownedBackgroundIds: string[] = [DEFAULT_BACKGROUND_ID];
    const backgrounds = await prisma.userBackground.findMany({
      where: { userId: user.id },
    });
    for (const b of backgrounds) {
      if (b.itemId !== DEFAULT_BACKGROUND_ID) ownedBackgroundIds.push(b.itemId);
    }

    // 적용 배경은 그룹 공유 — 무가족이면 없음.
    let appliedBackgroundId: string | undefined;
    if (user.familyId) {
      const family = await prisma.family.findUnique({ where: { id: user.familyId } });
      if (family?.appliedBackgroundId) appliedBackgroundId = family.appliedBackgroundId;
    }

    const response: ShopInventoryResponse = {
      ownedDecorationIds,
      equippedDecorations,
      ownedBackgroundIds,
    };
    // appliedBackgroundId 가 null/undefined 면 키 자체를 생략.
    if (appliedBackgroundId) response.appliedBackgroundId = appliedBackgroundId;
    return response;
  }

  /**
   * 아이템 구매 — 그룹 멤버십 하트에서 가격만큼 차감.
   * - 무가족이면 구매 불가 (하트는 그룹 멤버십 단위)
   * - 이미 소유했거나 가격 0 이면 멱등: 재차감 없이 현재 하트 반환
   * - $transaction 내 updateMany(hearts gte price) → count 0 이면 잔액 부족
   */
  async purchase(userId: string, itemId: string): Promise<PurchaseResponse> {
    const user = await this.resolveUser(userId);
    if (!user.familyId) throw Errors.badRequest('그룹 가입 후 이용 가능');

    const item = CATALOG_BY_ID[itemId];
    if (!item) throw Errors.notFound('상점 아이템');

    const familyId = user.familyId;

    // 이미 소유 중인지 확인 (멱등 처리용)
    const alreadyOwned =
      item.kind === 'decoration'
        ? !!(await prisma.userDecoration.findUnique({
            where: { userId_itemId: { userId: user.id, itemId } },
          }))
        : item.id === DEFAULT_BACKGROUND_ID ||
          !!(await prisma.userBackground.findUnique({
            where: { userId_itemId: { userId: user.id, itemId } },
          }));

    // 멱등: 이미 소유했거나 무료 아이템이면 재차감/재생성 없이 현재 하트 반환
    if (alreadyOwned || item.price === 0) {
      const membership = await prisma.familyMembership.findUnique({
        where: { userId_familyId: { userId: user.id, familyId } },
      });
      return { heartsRemaining: membership?.hearts ?? 0 };
    }

    await prisma.$transaction(async (tx) => {
      const result = await tx.familyMembership.updateMany({
        where: { userId: user.id, familyId, hearts: { gte: item.price } },
        data: { hearts: { decrement: item.price } },
      });
      if (result.count === 0) {
        throw Errors.badRequest('하트가 부족합니다.');
      }

      if (item.kind === 'decoration') {
        await tx.userDecoration.create({ data: { userId: user.id, itemId } });
      } else {
        // 배경도 개인 소유 — 구매한 본인만 소유(다른 멤버는 따로 사야 적용 가능).
        await tx.userBackground.create({ data: { userId: user.id, itemId } });
      }
    });

    const updatedMembership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: user.id, familyId } },
    });

    return { heartsRemaining: updatedMembership?.hearts ?? 0 };
  }

  /**
   * 꾸미기 장착/해제. itemId 미전달 시 해당 슬롯 해제(null).
   * 장착 시 아이템 종류·슬롯 일치 + 소유 여부를 검증한다.
   */
  async equipDecoration(
    userId: string,
    slot: DecorationSlot,
    itemId?: string
  ): Promise<EquipResponse> {
    const user = await this.resolveUser(userId);

    if (!VALID_SLOTS.includes(slot)) {
      throw Errors.badRequest('유효하지 않은 슬롯입니다.');
    }

    const column =
      slot === 'head' ? 'equippedHeadId' : slot === 'back' ? 'equippedBackId' : 'equippedFeetId';

    if (itemId) {
      const item = CATALOG_BY_ID[itemId];
      if (!item || item.kind !== 'decoration') {
        throw Errors.badRequest('유효하지 않은 꾸미기 아이템입니다.');
      }
      if (item.slot !== slot) {
        throw Errors.badRequest('아이템 슬롯이 일치하지 않습니다.');
      }
      const owned = await prisma.userDecoration.findUnique({
        where: { userId_itemId: { userId: user.id, itemId } },
      });
      if (!owned) throw Errors.badRequest('보유하지 않은 아이템입니다.');
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { [column]: itemId ?? null },
    });

    const equippedDecorations: EquippedDecorationsDto = {};
    if (updated.equippedHeadId) equippedDecorations.head = updated.equippedHeadId;
    if (updated.equippedBackId) equippedDecorations.back = updated.equippedBackId;
    if (updated.equippedFeetId) equippedDecorations.feet = updated.equippedFeetId;

    return { equippedDecorations };
  }

  /**
   * 그룹 배경 적용(그룹 공유). 무가족 불가. 기본 배경이거나 **본인이 소유한** 배경만 적용 가능.
   * → 다른 멤버가 산 배경은 내가 소유하지 않으므로 적용할 수 없다.
   */
  async applyBackground(userId: string, itemId: string): Promise<ShopInventoryResponse> {
    const user = await this.resolveUser(userId);
    if (!user.familyId) throw Errors.badRequest('그룹 가입 후 이용 가능');

    const item = CATALOG_BY_ID[itemId];
    if (!item || item.kind !== 'background') {
      throw Errors.badRequest('유효하지 않은 배경 아이템입니다.');
    }

    // 적용은 그룹 공유지만, 본인이 소유한 배경(또는 기본)만 적용 가능.
    // → 다른 멤버가 산 배경을 내가 다시 적용할 수는 없다.
    const owned =
      itemId === DEFAULT_BACKGROUND_ID ||
      !!(await prisma.userBackground.findUnique({
        where: { userId_itemId: { userId: user.id, itemId } },
      }));
    if (!owned) throw Errors.badRequest('보유하지 않은 배경입니다.');

    await prisma.family.update({
      where: { id: user.familyId },
      data: { appliedBackgroundId: itemId },
    });

    return this.getInventory(userId);
  }
}
