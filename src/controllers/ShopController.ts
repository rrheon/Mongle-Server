import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from 'tsoa';
import { AuthRequest } from '../middleware/auth';
import { ShopService } from '../services/ShopService';
import {
  ShopCatalogItemDto,
  ShopInventoryResponse,
  EquipResponse,
  PurchaseResponse,
} from '../models';

interface PurchaseRequest {
  itemId: string;
}

interface EquipRequest {
  /** 미전달 시 장착 해제(전역 단일) */
  itemId?: string;
}

interface ApplyBackgroundRequest {
  itemId: string;
}

@Route('shop')
@Tags('Shop')
export class ShopController extends Controller {
  private shopService = new ShopService();

  /**
   * 상점 카탈로그 조회 (전체 아이템 목록)
   * @summary 상점 카탈로그
   */
  @Get('catalog')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getCatalog(@Request() _req: AuthRequest): Promise<ShopCatalogItemDto[]> {
    return this.shopService.getCatalog();
  }

  /**
   * 보유/장착/적용 현황 조회
   * @summary 상점 인벤토리
   */
  @Get('inventory')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getInventory(@Request() req: AuthRequest): Promise<ShopInventoryResponse> {
    return this.shopService.getInventory(req.user.userId);
  }

  /**
   * 아이템 구매 (그룹 하트 차감)
   * @summary 아이템 구매
   */
  @Post('purchase')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async purchase(
    @Request() req: AuthRequest,
    @Body() body: PurchaseRequest
  ): Promise<PurchaseResponse> {
    return this.shopService.purchase(req.user.userId, body.itemId);
  }

  /**
   * 꾸미기 장착/해제 (itemId 미전달 시 해제)
   * @summary 꾸미기 장착
   */
  @Post('decoration/equip')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async equip(
    @Request() req: AuthRequest,
    @Body() body: EquipRequest
  ): Promise<EquipResponse> {
    return this.shopService.equipDecoration(req.user.userId, body.itemId);
  }

  /**
   * 그룹 배경 적용
   * @summary 배경 적용
   */
  @Post('background/apply')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async applyBackground(
    @Request() req: AuthRequest,
    @Body() body: ApplyBackgroundRequest
  ): Promise<ShopInventoryResponse> {
    return this.shopService.applyBackground(req.user.userId, body.itemId);
  }
}
