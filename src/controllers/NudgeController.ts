import { Body, Controller, Post, Request, Route, Security, SuccessResponse, Tags } from 'tsoa';
import { AuthRequest } from '../middleware/auth';
import { NudgeService } from '../services/NudgeService';

interface SendNudgeRequest {
  targetUserId: string;
}

interface NudgeResponse {
  message: string;
  heartsRemaining: number;
}

@Route('nudge')
@Tags('Nudge')
export class NudgeController extends Controller {
  private nudgeService = new NudgeService();

  /**
   * 재촉하기 (하트 1개 차감, 상대에게 알림)
   * @summary 재촉하기
   */
  @Post()
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async sendNudge(
    @Request() req: AuthRequest,
    @Body() body: SendNudgeRequest
  ): Promise<NudgeResponse> {
    return this.nudgeService.sendNudge(req.user.userId, body.targetUserId);
  }
}
