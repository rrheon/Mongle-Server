import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Route,
  Body,
  Path,
  Query,
  Security,
  Request,
  Tags,
  SuccessResponse,
} from 'tsoa';
import { AuthRequest } from '../middleware/auth';
import {
  CreateFamilyRequest,
  JoinFamilyRequest,
  TransferCreatorRequest,
  FamilyResponse,
  FamilyMembersResponse,
  FamiliesListResponse,
} from '../models';
import { FamilyService } from '../services/FamilyService';

@Route('families')
@Tags('Families')
export class FamilyController extends Controller {
  private familyService = new FamilyService();

  /**
   * 새 가족 그룹 생성
   * @summary 가족 생성
   */
  @Post()
  @Security('jwt')
  @SuccessResponse(201, '생성됨')
  public async createFamily(
    @Request() req: AuthRequest,
    @Body() body: CreateFamilyRequest
  ): Promise<FamilyResponse> {
    this.setStatus(201);
    return this.familyService.createFamily(req.user.userId, body);
  }

  /**
   * 초대 코드로 가족 참여
   * @summary 가족 참여
   */
  @Post('join')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async joinFamily(
    @Request() req: AuthRequest,
    @Body() body: JoinFamilyRequest
  ): Promise<FamilyResponse> {
    return this.familyService.joinFamily(req.user.userId, body);
  }

  /**
   * 내 가족 정보 조회 (현재 활성 가족)
   * @summary 내 가족 조회
   */
  @Get('my')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getMyFamily(@Request() req: AuthRequest): Promise<FamilyResponse | null> {
    return this.familyService.getMyFamily(req.user.userId);
  }

  /**
   * 내 모든 가족 목록 조회 (최대 3개)
   * @summary 내 가족 목록 조회
   */
  @Get('all')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getMyFamilies(@Request() req: AuthRequest): Promise<FamiliesListResponse> {
    return this.familyService.getMyFamilies(req.user.userId);
  }

  /**
   * 활성 가족 전환
   * @summary 가족 선택
   */
  @Post('{familyId}/select')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async selectFamily(
    @Request() req: AuthRequest,
    @Path() familyId: string
  ): Promise<FamilyResponse> {
    return this.familyService.selectFamily(req.user.userId, familyId);
  }

  /**
   * 가족 상세 정보 조회
   * @summary 가족 상세 조회
   */
  @Get('{familyId}')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getFamily(
    @Request() req: AuthRequest,
    @Path() familyId: string
  ): Promise<FamilyResponse> {
    return this.familyService.getFamily(req.user.userId, familyId);
  }

  /**
   * 가족 구성원 목록 조회
   * @summary 가족 구성원 조회
   */
  @Get('{familyId}/members')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getFamilyMembers(
    @Request() req: AuthRequest,
    @Path() familyId: string
  ): Promise<FamilyMembersResponse> {
    return this.familyService.getFamilyMembers(req.user.userId, familyId);
  }

  /**
   * 방장 위임 — 현재 방장이 다른 멤버에게 방장 권한을 넘김
   * @summary 방장 위임
   */
  @Patch('transfer-creator')
  @Security('jwt')
  @SuccessResponse(204, '성공')
  public async transferCreator(
    @Request() req: AuthRequest,
    @Body() body: TransferCreatorRequest
  ): Promise<void> {
    await this.familyService.transferCreator(req.user.userId, body.newCreatorId);
    this.setStatus(204);
  }

  /**
   * 가족 떠나기 (familyId 없으면 현재 활성 가족에서 탈퇴)
   * @summary 가족 떠나기
   */
  @Delete('leave')
  @Security('jwt')
  @SuccessResponse(204, '성공')
  public async leaveFamily(
    @Request() req: AuthRequest,
    @Query() familyId?: string
  ): Promise<void> {
    await this.familyService.leaveFamily(req.user.userId, familyId);
    this.setStatus(204);
  }
  /**
   * 방장이 가족 구성원 내보내기
   * @summary 멤버 내보내기 (방장 전용)
   */
  @Delete('members/{memberId}')
  @Security('jwt')
  @SuccessResponse(204, '성공')
  public async kickMember(
    @Request() req: AuthRequest,
    @Path() memberId: string
  ): Promise<void> {
    await this.familyService.kickMember(req.user.userId, memberId);
    this.setStatus(204);
  }
}
