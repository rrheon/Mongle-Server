import { Body, Controller, Get, Post, Query, Request, Route, Security, SuccessResponse, Tags } from 'tsoa';
import { AuthRequest } from '../middleware/auth';
import { MoodRecordDTO, MoodService } from '../services/MoodService';

interface SaveMoodRequest {
  mood: string;
  note?: string;
  /** YYYY-MM-DD (생략 시 오늘) */
  date?: string;
}

interface SaveMoodResponse {
  record: MoodRecordDTO;
}

interface GetMoodsResponse {
  records: MoodRecordDTO[];
}

@Route('moods')
@Tags('Mood')
export class MoodController extends Controller {
  private moodService = new MoodService();

  /**
   * 기분 기록 저장 (하루 1회, upsert)
   * @summary 기분 저장
   */
  @Post()
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async saveMood(
    @Request() req: AuthRequest,
    @Body() body: SaveMoodRequest
  ): Promise<SaveMoodResponse> {
    return this.moodService.saveMood(req.user.userId, body.mood, body.note, body.date);
  }

  /**
   * 최근 N일 기분 기록 조회
   * @summary 기분 목록 조회
   */
  @Get()
  @Security('jwt')
  @SuccessResponse(200, '성공')
  public async getMoods(
    @Request() req: AuthRequest,
    @Query() days: number = 14
  ): Promise<GetMoodsResponse> {
    const records = await this.moodService.getMoods(req.user.userId, days);
    return { records };
  }
}
