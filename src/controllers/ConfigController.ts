import { Controller, Get, Route, Tags, SuccessResponse } from 'tsoa';

interface ConfigResponse {
  isAdEnabled: boolean;
}

@Route('config')
@Tags('Config')
export class ConfigController extends Controller {
  /**
   * 앱 부팅 시 호출되는 클라이언트 설정. 인증 불필요.
   * isAdEnabled=false 면 클라는 광고 배너 렌더링과 AdMob 초기화를 모두 건너뛴다 (MG-132).
   * 환경변수 ADS_ENABLED 미설정 시 true (기존 동작 유지).
   * @summary 클라이언트 설정 조회
   */
  @Get()
  @SuccessResponse(200, '성공')
  public async getConfig(): Promise<ConfigResponse> {
    const raw = process.env.ADS_ENABLED;
    const isAdEnabled = raw === undefined ? true : raw.toLowerCase() === 'true';
    return { isAdEnabled };
  }
}
