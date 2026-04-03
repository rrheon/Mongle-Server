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
    if (admin.apps.length === 0) return;
    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: { title, body },
        data: { type, ...(colorId && { colorId }) },
        android: { priority: 'high' },
      });
    } catch (e) {
      console.warn('[FCM] 푸시 실패:', e);
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
      aps: { alert: { title: '재촉하기 알림', body: `${senderName}님이 오늘의 질문에 답변해달라고 합니다 🌿` }, sound: 'default', badge: 1 },
      type: 'ANSWER_REQUEST',
    });
    return this._sendApnsPayload(deviceToken, payload);
  }

  /** APNs HTTP/2 공통 발송 */
  private _sendApnsPayload(deviceToken: string, payload: string): Promise<void> {
    if (!this.keyId || !this.teamId || !this.bundleId || !this.rawKey) return Promise.resolve();

    const host = this.isProduction ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';

    return new Promise<void>((resolve) => {
      try {
        const client = http2.connect(`https://${host}`, { rejectUnauthorized: true });
        client.on('error', () => { client.destroy(); resolve(); });

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
            req.on('end', () => { console.warn(`[APNs] 푸시 실패 status=${status}`, body); client.close(); resolve(); });
          } else {
            client.close(); resolve();
          }
        });
        req.on('error', () => { client.destroy(); resolve(); });
        req.write(payload);
        req.end();
      } catch (e) {
        console.warn('[APNs] 예외:', e);
        resolve();
      }
    });
  }
}
