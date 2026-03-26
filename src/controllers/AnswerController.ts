import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Route,
  Body,
  Path,
  Security,
  Request,
  Tags,
  SuccessResponse,
} from 'tsoa';
import { AuthRequest } from '../middleware/auth';
import {
  CreateAnswerRequest,
  UpdateAnswerRequest,
  AnswerResponse,
  FamilyAnswersResponse,
} from '../models';
import { AnswerService } from '../services/AnswerService';

@Route('answers')
@Tags('Answers')
export class AnswerController extends Controller {
  private answerService = new AnswerService();

  /**
   * 답변 작성
   * @summary 답변 작성
   */
  @Post()
  @Security('jwt')
  @SuccessResponse(201, '생성됨')
  public async createAnswer(
    @Request() req: AuthRequest,
    @Body() body: CreateAnswerRequest
  ): Promise<AnswerResponse> {
    this.setStatus(201);
    return this.answerService.createAnswer(req.user.userId, body);
  }

  /**
   * 내 답변 조회
   * @summary 내 답변 조회
   */
  @Get('my/{questionId}')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getMyAnswer(
    @Request() req: AuthRequest,
    @Path() questionId: string
  ): Promise<AnswerResponse | null> {
    return this.answerService.getMyAnswer(req.user.userId, questionId);
  }

  /**
   * 가족 답변 목록 조회
   * @summary 가족 답변 목록
   */
  @Get('family/{questionId}')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getFamilyAnswers(
    @Request() req: AuthRequest,
    @Path() questionId: string
  ): Promise<FamilyAnswersResponse> {
    return this.answerService.getFamilyAnswers(req.user.userId, questionId);
  }

  /**
   * 답변 수정
   * @summary 답변 수정
   */
  @Put('{answerId}')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async updateAnswer(
    @Request() req: AuthRequest,
    @Path() answerId: string,
    @Body() body: UpdateAnswerRequest
  ): Promise<AnswerResponse> {
    return this.answerService.updateAnswer(req.user.userId, answerId, body);
  }

  /**
   * 답변 삭제
   * @summary 답변 삭제
   */
  @Delete('{answerId}')
  @Security('jwt')
  @SuccessResponse(204, '성공')
  public async deleteAnswer(
    @Request() req: AuthRequest,
    @Path() answerId: string
  ): Promise<void> {
    await this.answerService.deleteAnswer(req.user.userId, answerId);
    this.setStatus(204);
  }
}
