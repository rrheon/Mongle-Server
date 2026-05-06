import * as http2 from 'http2';
import * as jwt from 'jsonwebtoken';
import * as admin from 'firebase-admin';

/**
 * APNs 푸시 알림 서비스 (토큰 기반 인증)
 *
 * 환경 변수 설정 필요:
 *   APNS_KEY_ID    : Apple Push Key ID (10자리 문자)
 *   APNS_TEAM_ID   : Apple Team ID (10자리 문자)
 *   APNS_BUNDLE_ID : 앱 Bundle ID (예: com.example.mongle)
 *   APNS_PRIVATE_KEY: .p8 파일 내용 (줄바꿈을 \n으로 대체하거나 base64 인코딩)
 *   NODE_ENV       : 'production' 이면 실서버, 그 외 sandbox
 */
// Firebase Admin SDK 초기화 (싱글턴)
function initFirebase() {
  if (admin.apps.length > 0) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) return;
  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

export class PushNotificationService {
  private readonly keyId = process.env.APNS_KEY_ID ?? '';
  private readonly teamId = process.env.APNS_TEAM_ID ?? '';
  private readonly bundleId = process.env.APNS_BUNDLE_ID ?? '';
  private readonly rawKey = process.env.APNS_PRIVATE_KEY ?? '';
  private readonly isProduction = process.env.NODE_ENV === 'production';

  /** APNs JWT 생성 (ES256) */
  private makeJwt(): string {
    // base64 인코딩된 키라면 디코딩, 아니면 그대로 사용
    let privateKey = this.rawKey;
    if (!privateKey.includes('-----')) {
      privateKey = Buffer.from(privateKey, 'base64').toString('utf-8');
    }
    return jwt.sign(
      { iss: this.teamId, iat: Math.floor(Date.now() / 1000) },
      privateKey,
      { algorithm: 'ES256', keyid: this.keyId }
    );
  }

  /** FCM 푸시 알림 발송 (Android).
   * data-only 페이로드로 발송 — notification 필드를 함께 보내면 안드로이드 백그라운드/종료
   * 상태에서 OS 자동 처리 경로로 빠져 onMessageReceived 가 호출되지 않고, 클라가 정의한
   * mongle_default 채널 대신 시스템 폴백 채널이 사용돼 헤드업 미노출/제조사 백그라운드
   * 제한 등으로 알림이 누락된다. data-only + high priority + ttl=0 으로 항상 클라가
   * 알림을 빌드하도록 보장. (MG-111)
   * notificationId 를 data 에 포함해 클라가 알림 탭 시 자동 markAsRead 호출에 사용. */
  async sendFcmPush(fcmToken: string, title: string, body: string, type: string, colorId?: string, notificationId?: string): Promise<void> {
    initFirebase();
    if (admin.apps.length === 0) {
      console.warn('[FCM] Firebase 미초기화 — 푸시 발송 건너뜀');
      return;
    }
    try {
      await admin.messaging().send({
        token: fcmToken,
        data: {
          title,
          body,
          type,
          ...(colorId && { colorId }),
          ...(notificationId && { notificationId }),
        },
        android: { priority: 'high', ttl: 0 },
      });
    } catch (e: unknown) {
      const errorCode = (e as { code?: string })?.code;
      console.error(`[FCM] 푸시 실패 (code=${errorCode}):`, e);
      // messaging/registration-token-not-registered = 토큰 만료
      if (errorCode === 'messaging/registration-token-not-registered' || errorCode === 'messaging/invalid-registration-token') {
        try {
          const prisma = (await import('../utils/prisma')).default;
          await prisma.user.updateMany({ where: { fcmToken }, data: { fcmToken: null } });
          console.warn(`[FCM] 만료 토큰 정리 완료 (token=${fcmToken.substring(0, 8)}...)`);
        } catch (dbErr) {
          console.error('[FCM] 토큰 무효화 실패:', dbErr);
        }
      }
    }
  }

  /** APNs 푸시 알림 범용 발송.
   * environment: 'sandbox' | 'production' — 유저 레코드에 저장된 값을 그대로 전달.
   * 미지정(undefined/null) 시 서버의 NODE_ENV 기반 fallback을 사용. (MG-22)
   * notificationId 를 페이로드에 포함해 클라가 알림 탭 시 자동 markAsRead 호출에 사용 (MG-111). */
  async sendApnsPush(
    deviceToken: string,
    title: string,
    body: string,
    type: string,
    badgeCount?: number,
    environment?: 'sandbox' | 'production' | null,
    notificationId?: string
  ): Promise<void> {
    if (!this.keyId || !this.teamId || !this.bundleId || !this.rawKey) return;
    const payload = JSON.stringify({
      aps: { alert: { title, body }, sound: 'default', badge: badgeCount ?? 1 },
      type,
      ...(notificationId && { notificationId }),
    });
    return this._sendApnsPayload(deviceToken, payload, environment);
  }

  /**
   * APNs 푸시 진단용 발송 — 에러를 삼키지 않고 응답 상세를 그대로 반환한다.
   * (디버그 엔드포인트 전용. 프로덕션 알림 경로는 sendApnsPush 사용)
   *
   * 반환:
   *   - ok: true/false (200 OK 여부)
   *   - status: HTTP status code
   *   - body: APNs 응답 바디 (실패 사유 문자열)
   *   - host: 실제로 접속한 APNs 호스트 (sandbox vs production 확인용)
   *   - isProduction: 서버가 스스로 production으로 판단했는지
   *   - skipped: 환경변수 미설정으로 발송 자체를 못한 경우
   */
  async sendApnsPushDiagnostic(
    deviceToken: string,
    title: string,
    body: string,
    type: string,
    environment?: 'sandbox' | 'production' | null
  ): Promise<{
    ok: boolean;
    status?: number;
    body?: string;
    host?: string;
    isProduction: boolean;
    skipped?: boolean;
    error?: string;
  }> {
    const isProduction = environment ? environment === 'production' : this.isProduction;
    if (!this.keyId || !this.teamId || !this.bundleId || !this.rawKey) {
      return { ok: false, isProduction, skipped: true, error: 'APNs env vars not set' };
    }
    const payload = JSON.stringify({
      aps: { alert: { title, body }, sound: 'default', badge: 1 },
      type,
    });
    const host = isProduction ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
    return new Promise((resolve) => {
      try {
        const client = http2.connect(`https://${host}`, { rejectUnauthorized: true });
        client.on('error', (e) => {
          client.destroy();
          resolve({ ok: false, host, isProduction, error: `connect error: ${String(e)}` });
        });
        const headers: http2.OutgoingHttpHeaders = {
          ':method': 'POST',
          ':path': `/3/device/${deviceToken}`,
          'authorization': `bearer ${this.makeJwt()}`,
          'apns-topic': this.bundleId,
          'apns-push-type': 'alert',
          'apns-expiration': '0',
          'apns-priority': '10',
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        };
        const req = client.request(headers);
        let respBody = '';
        let status: number | undefined;
        req.on('response', (resHeaders) => {
          status = Number(resHeaders[':status']);
        });
        req.on('data', (chunk: Buffer) => { respBody += chunk.toString(); });
        req.on('end', () => {
          client.close();
          resolve({ ok: status === 200, status, body: respBody, host, isProduction });
        });
        req.on('error', (e) => {
          client.destroy();
          resolve({ ok: false, status, body: respBody, host, isProduction, error: `request error: ${String(e)}` });
        });
        req.write(payload);
        req.end();
      } catch (e) {
        resolve({ ok: false, host, isProduction, error: `exception: ${String(e)}` });
      }
    });
  }

  /** 재촉하기 푸시 알림 발송.
   * notificationId 를 포함해 클라가 알림 탭 시 자동 markAsRead 호출에 사용 (MG-111). */
  async sendNudgePush(
    deviceToken: string,
    senderName: string,
    badgeCount?: number,
    environment?: 'sandbox' | 'production' | null,
    notificationId?: string
  ): Promise<void> {
    const payload = JSON.stringify({
      aps: { alert: { title: '재촉하기 알림', body: `${senderName}님이 오늘의 질문에 답변해달라고 합니다` }, sound: 'default', badge: badgeCount ?? 1 },
      type: 'ANSWER_REQUEST',
      ...(notificationId && { notificationId }),
    });
    return this._sendApnsPayload(deviceToken, payload, environment);
  }

  /** APNs HTTP/2 발송 + production→sandbox 자동 fallback.
   *
   * 클라이언트가 environment 를 잘못 보고하는 케이스 (예: SPM 캐시 영향으로 DEBUG 빌드인데
   * production 으로 등록되는 결함 — MG-114) 를 안전망으로 차단. production 호스트에서
   * BadDeviceToken 을 받으면 sandbox 호스트로 재시도하고, 성공 시 DB 의 apnsEnvironment 를
   * 자동으로 sandbox 로 정정해 다음 발송부터는 처음부터 올바른 호스트가 선택되도록 한다.
   * (MG-115)
   *
   * environment 지정 시 토큰별로 sandbox/production 호스트 선택. 미지정 시 서버 NODE_ENV fallback. (MG-22) */
  private async _sendApnsPayload(
    deviceToken: string,
    payload: string,
    environment?: 'sandbox' | 'production' | null
  ): Promise<void> {
    if (!this.keyId || !this.teamId || !this.bundleId || !this.rawKey) {
      console.warn('[APNs] 환경변수 미설정 — 푸시 발송 건너뜀 (APNS_KEY_ID/TEAM_ID/BUNDLE_ID/PRIVATE_KEY)');
      return;
    }

    const isProduction = environment ? environment === 'production' : this.isProduction;
    const initialEnv: 'sandbox' | 'production' = isProduction ? 'production' : 'sandbox';

    const r1 = await this._sendApnsPayloadOnce(deviceToken, payload, initialEnv);
    if (r1.ok) return;

    // production 호스트에서 BadDeviceToken — 클라가 environment 잘못 보고했을 가능성.
    // sandbox 로 재시도해 deliver 보장 + 성공 시 DB env 자동 정정.
    if (initialEnv === 'production' && this._isBadDeviceToken(r1.status, r1.body)) {
      const r2 = await this._sendApnsPayloadOnce(deviceToken, payload, 'sandbox');
      if (r2.ok) {
        try {
          const prisma = (await import('../utils/prisma')).default;
          const result = await prisma.user.updateMany({
            where: { apnsToken: deviceToken },
            data: { apnsEnvironment: 'sandbox' },
          });
          if (result.count > 0) {
            console.warn(
              `[APNs] sandbox fallback 성공 → env 자동 정정 ${result.count}건 (token=${deviceToken.substring(0, 8)}...)`
            );
          }
        } catch (e) {
          console.error('[APNs] env 정정 실패:', e);
        }
        return;
      }
      // sandbox 도 실패 — 진짜 잘못된 토큰. invalidate 결정에 r2 결과 사용.
      if (this._isTokenInvalidResponse(r2.status, r2.body)) {
        await this.invalidateApnsToken(deviceToken).catch((e) => {
          console.error('[APNs] 토큰 무효화 실패:', e);
        });
      }
      return;
    }

    // 일반 토큰 invalid 케이스 (410 Gone, BadDeviceToken 외 token-invalid reasons)
    if (this._isTokenInvalidResponse(r1.status, r1.body)) {
      await this.invalidateApnsToken(deviceToken).catch((e) => {
        console.error('[APNs] 토큰 무효화 실패:', e);
      });
    }
  }

  /** 400 응답 + reason=BadDeviceToken 감지 — production→sandbox fallback 트리거 조건. */
  private _isBadDeviceToken(status: number | undefined, body: string | undefined): boolean {
    if (status !== 400 || !body) return false;
    try {
      return (JSON.parse(body) as { reason?: string }).reason === 'BadDeviceToken';
    } catch {
      return false;
    }
  }

  /** 토큰을 무효화해야 하는 응답인지. 410 Gone 또는 400 + 토큰-invalid reason 류.
   * 페이로드/설정 오류(BadCertificate, BadTopic 등) 는 false — 토큰 보존. */
  private _isTokenInvalidResponse(status: number | undefined, body: string | undefined): boolean {
    if (status === 410) return true;
    if (status !== 400 || !body) return false;
    try {
      const reason = (JSON.parse(body) as { reason?: string }).reason;
      const tokenInvalidReasons = new Set([
        'BadDeviceToken',
        'Unregistered',
        'DeviceTokenNotForTopic',
        'TopicDisallowed',
      ]);
      return !!reason && tokenInvalidReasons.has(reason);
    } catch {
      return false;
    }
  }

  /** APNs HTTP/2 단일 발송. 결과(ok/status/body) 를 반환만 하고 invalidate 는 호출자 책임.
   * fallback wrapper(_sendApnsPayload) 가 production/sandbox 결과 종합해 invalidate 결정. */
  private _sendApnsPayloadOnce(
    deviceToken: string,
    payload: string,
    environment: 'sandbox' | 'production'
  ): Promise<{ ok: boolean; status?: number; body?: string }> {
    const host = environment === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';

    return new Promise((resolve) => {
      try {
        const client = http2.connect(`https://${host}`, { rejectUnauthorized: true });
        client.on('error', (e) => {
          console.error('[APNs] HTTP/2 연결 오류:', e);
          client.destroy();
          resolve({ ok: false });
        });

        const headers: http2.OutgoingHttpHeaders = {
          ':method': 'POST',
          ':path': `/3/device/${deviceToken}`,
          'authorization': `bearer ${this.makeJwt()}`,
          'apns-topic': this.bundleId,
          'apns-push-type': 'alert',
          'apns-expiration': '0',
          'apns-priority': '10',
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        };

        const req = client.request(headers);
        let respBody = '';
        let status: number | undefined;
        req.on('response', (resHeaders) => {
          status = Number(resHeaders[':status']);
        });
        req.on('data', (chunk: Buffer) => { respBody += chunk.toString(); });
        req.on('end', () => {
          client.close();
          if (status !== 200) {
            console.error(
              `[APNs] 푸시 실패 host=${host} status=${status} token=${deviceToken.substring(0, 8)}...`,
              respBody
            );
          }
          resolve({ ok: status === 200, status, body: respBody });
        });
        req.on('error', (e) => {
          console.error('[APNs] 요청 오류:', e);
          client.destroy();
          resolve({ ok: false, status, body: respBody });
        });
        req.write(payload);
        req.end();
      } catch (e) {
        console.error('[APNs] 예외:', e);
        resolve({ ok: false });
      }
    });
  }

  /** 유효하지 않은 APNs 토큰을 DB에서 null 처리 */
  private async invalidateApnsToken(token: string): Promise<void> {
    const prisma = (await import('../utils/prisma')).default;
    const result = await prisma.user.updateMany({
      where: { apnsToken: token },
      data: { apnsToken: null, apnsEnvironment: null },
    });
    if (result.count > 0) {
      console.warn(`[APNs] 만료 토큰 정리 완료 — ${result.count}명의 토큰 제거 (token=${token.substring(0, 8)}...)`);
    }
  }
}
