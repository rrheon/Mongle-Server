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
   * notificationId 를 data 에 포함해 클라가 알림 탭 시 자동 markAsRead 호출에 사용 (MG-111). */
  async sendFcmPush(fcmToken: string, title: string, body: string, type: string, colorId?: string, notificationId?: string): Promise<void> {
    initFirebase();
    if (admin.apps.length === 0) {
      console.warn('[FCM] Firebase 미초기화 — 푸시 발송 건너뜀');
      return;
    }
    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: { title, body },
        data: { type, ...(colorId && { colorId }), ...(notificationId && { notificationId }) },
        android: { priority: 'high' },
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

  /** APNs HTTP/2 공통 발송.
   * environment 지정 시 토큰별로 sandbox/production 호스트 선택. 미지정 시 서버 NODE_ENV fallback. (MG-22) */
  private _sendApnsPayload(
    deviceToken: string,
    payload: string,
    environment?: 'sandbox' | 'production' | null
  ): Promise<void> {
    if (!this.keyId || !this.teamId || !this.bundleId || !this.rawKey) {
      console.warn('[APNs] 환경변수 미설정 — 푸시 발송 건너뜀 (APNS_KEY_ID/TEAM_ID/BUNDLE_ID/PRIVATE_KEY)');
      return Promise.resolve();
    }

    const isProduction = environment ? environment === 'production' : this.isProduction;
    const host = isProduction ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';

    return new Promise<void>((resolve) => {
      try {
        const client = http2.connect(`https://${host}`, { rejectUnauthorized: true });
        client.on('error', (e) => { console.error('[APNs] HTTP/2 연결 오류:', e); client.destroy(); resolve(); });

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
        req.on('response', (resHeaders) => {
          const status = resHeaders[':status'];
          if (status !== 200) {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
              console.error(`[APNs] 푸시 실패 status=${status} token=${deviceToken.substring(0, 8)}...`, body);
              // 410 Gone = 토큰 만료/미설치. 항상 무효화.
              // 400 Bad Request 는 토큰 외 사유(BadCertificate, BadTopic, BadMessageId,
              // BadPriority 등 페이로드/설정 오류)도 포함되므로 reason 을 확인해
              // 토큰-invalid 류만 정리. reason 미상이면 안전 측 보존.
              const tokenInvalidReasons = new Set([
                'BadDeviceToken',
                'Unregistered',
                'DeviceTokenNotForTopic',
                'TopicDisallowed',
              ]);
              let shouldInvalidate = status === 410;
              if (status === 400) {
                try {
                  const reason = (JSON.parse(body) as { reason?: string }).reason;
                  if (reason && tokenInvalidReasons.has(reason)) shouldInvalidate = true;
                } catch {
                  // body 파싱 실패 시 토큰 손상 단정 불가 → 보존
                }
              }
              if (shouldInvalidate) {
                this.invalidateApnsToken(deviceToken).catch((e) => {
                  console.error('[APNs] 토큰 무효화 실패:', e);
                });
              }
              client.close(); resolve();
            });
          } else {
            client.close(); resolve();
          }
        });
        req.on('error', (e) => { console.error('[APNs] 요청 오류:', e); client.destroy(); resolve(); });
        req.write(payload);
        req.end();
      } catch (e) {
        console.error('[APNs] 예외:', e);
        resolve();
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
