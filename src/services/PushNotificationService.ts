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

  /** FCM 푸시 알림 발송 (Android) */
  async sendFcmPush(fcmToken: string, title: string, body: string, type: string, colorId?: string): Promise<void> {
    initFirebase();
    if (admin.apps.length === 0) {
      console.warn('[FCM] Firebase 미초기화 — 푸시 발송 건너뜀');
      return;
    }
    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: { title, body },
        data: { type, ...(colorId && { colorId }) },
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

  /** APNs 푸시 알림 범용 발송 */
  async sendApnsPush(deviceToken: string, title: string, body: string, type: string): Promise<void> {
    if (!this.keyId || !this.teamId || !this.bundleId || !this.rawKey) return;
    const payload = JSON.stringify({
      aps: { alert: { title, body }, sound: 'default', badge: 1 },
      type,
    });
    return this._sendApnsPayload(deviceToken, payload);
  }

  /** 재촉하기 푸시 알림 발송 */
  async sendNudgePush(deviceToken: string, senderName: string): Promise<void> {
    const payload = JSON.stringify({
      aps: { alert: { title: '재촉하기 알림', body: `${senderName}님이 오늘의 질문에 답변해달라고 합니다` }, sound: 'default', badge: 1 },
      type: 'ANSWER_REQUEST',
    });
    return this._sendApnsPayload(deviceToken, payload);
  }

  /** APNs HTTP/2 공통 발송 */
  private _sendApnsPayload(deviceToken: string, payload: string): Promise<void> {
    if (!this.keyId || !this.teamId || !this.bundleId || !this.rawKey) {
      console.warn('[APNs] 환경변수 미설정 — 푸시 발송 건너뜀 (APNS_KEY_ID/TEAM_ID/BUNDLE_ID/PRIVATE_KEY)');
      return Promise.resolve();
    }

    const host = this.isProduction ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';

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
              // 410 Gone = 토큰이 더 이상 유효하지 않음 → DB에서 자동 정리
              if (status === 410 || status === 400) {
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
      data: { apnsToken: null },
    });
    if (result.count > 0) {
      console.warn(`[APNs] 만료 토큰 정리 완료 — ${result.count}명의 토큰 제거 (token=${token.substring(0, 8)}...)`);
    }
  }
}
