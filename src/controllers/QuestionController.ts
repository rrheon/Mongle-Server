import {
  Body,
  Controller,
  Get,
  Post,
  Route,
  Path,
  Query,
  Security,
  Request,
  Tags,
  SuccessResponse,
} from 'tsoa';
import { AuthRequest } from '../middleware/auth';
import {
  QuestionResponse,
  DailyQuestionResponse,
  DailyQuestionHistoryResponse,
  SkipQuestionResponse,
  CreateCustomQuestionRequest,
  CreateCustomQuestionResponse,
  PaginatedResponse,
} from '../models';
import { QuestionService } from '../services/QuestionService';

@Route('questions')
@Tags('Questions')
export class QuestionController extends Controller {
  private questionService = new QuestionService();

  /**
   * 오늘의 질문 조회 (가족별)
   * @summary 오늘의 질문
   */
  @Get('today')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getTodayQuestion(@Request() req: AuthRequest): Promise<DailyQuestionResponse> {
    return this.questionService.getTodayQuestion(req.user.userId);
  }

  /**
   * 오늘의 질문 패스 (하루 1회, 새 질문 배정)
   * @summary 질문 패스
   */
  @Post('skip')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async skipTodayQuestion(@Request() req: AuthRequest): Promise<SkipQuestionResponse> {
    return this.questionService.skipTodayQuestion(req.user.userId);
  }

  /**
   * 특정 날짜의 질문 조회 (가족별)
   * @summary 날짜별 질문 조회
   * @param date 조회할 날짜 (YYYY-MM-DD)
   */
  @Get('date/{date}')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getQuestionByDate(
    @Request() req: AuthRequest,
    @Path() date: string
  ): Promise<DailyQuestionResponse | null> {
    return this.questionService.getQuestionByDate(req.user.userId, date);
  }

  /**
   * 질문 상세 조회
   * @summary 질문 상세
   */
  @Get('{questionId}')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getQuestion(@Path() questionId: string): Promise<QuestionResponse> {
    return this.questionService.getQuestion(questionId);
  }

  /**
   * 가족 질문 히스토리 (패스 여부 포함)
   * @summary 질문 히스토리
   */
  @Get()
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getQuestions(
    @Request() req: AuthRequest,
    @Query() page?: number,
    @Query() limit?: number
  ): Promise<PaginatedResponse<DailyQuestionHistoryResponse>> {
    return this.questionService.getQuestionHistory(req.user.userId, page ?? 1, limit ?? 20);
  }

  /**
   * 나만의 질문 작성 (하트 3개 차감, 하루 1회)
   * @summary 나만의 질문 등록
   */
  @Post('custom')
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async createCustomQuestion(
    @Request() req: AuthRequest,
    @Body() body: CreateCustomQuestionRequest
  ): Promise<CreateCustomQuestionResponse> {
    return this.questionService.createCustomQuestion(req.user.userId, body.content);
  }
}
