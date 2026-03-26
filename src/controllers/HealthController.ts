import { Controller, Get, Route, Tags, SuccessResponse } from 'tsoa';

interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
}

@Route('health')
@Tags('Health')
export class HealthController extends Controller {
  /**
   * 서버 상태 확인
   * @summary 헬스 체크
   */
  @Get()
  @SuccessResponse(200, '성공')
  public async healthCheck(): Promise<HealthResponse> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }
}
