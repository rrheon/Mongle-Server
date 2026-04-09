/**
 * 이메일 발송 유틸.
 *
 * 개발 환경에서 SMTP 환경변수가 세팅되지 않으면 콘솔에 코드를 출력하고 성공 처리한다.
 * (로컬 테스트 편의성을 위함 — 프로덕션 배포시 SMTP_* env 반드시 세팅)
 *
 * 필요한 env:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE(optional: 'true')
 */
import nodemailer, { Transporter } from 'nodemailer';

let cachedTransporter: Transporter | null = null;
let cachedIsDevFallback = false;

function buildTransporter(): { transporter: Transporter; isDevFallback: boolean } {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 0);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    // Dev fallback — JSON transport (실제 발송하지 않고 content 만 반환)
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    return { transporter, isDevFallback: true };
  }

  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return { transporter, isDevFallback: false };
}

function getTransporter(): { transporter: Transporter; isDevFallback: boolean } {
  if (!cachedTransporter) {
    const built = buildTransporter();
    cachedTransporter = built.transporter;
    cachedIsDevFallback = built.isDevFallback;
  }
  return { transporter: cachedTransporter, isDevFallback: cachedIsDevFallback };
}

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const { transporter, isDevFallback } = getTransporter();
  const from = process.env.SMTP_FROM || 'Mongle <no-reply@mongle.app>';

  const subject = '[몽글] 이메일 인증 코드';
  const text = `몽글 회원가입 인증 코드는 ${code} 입니다. 10분 이내에 입력해 주세요.`;
  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F6FAF6;padding:32px;">
  <div style="max-width:440px;margin:0 auto;background:#fff;border-radius:20px;padding:32px;box-shadow:0 8px 32px rgba(0,0,0,.06);">
    <h1 style="font-size:22px;color:#1A1A1A;margin:0 0 8px;">몽글 이메일 인증</h1>
    <p style="font-size:14px;color:#666;margin:0 0 24px;">아래 코드를 앱 인증 화면에 입력해 주세요.</p>
    <div style="background:#F0F9F2;border-radius:14px;padding:20px;text-align:center;">
      <div style="font-size:32px;font-weight:700;letter-spacing:10px;color:#56A96B;">${code}</div>
    </div>
    <p style="font-size:12px;color:#AAA;margin-top:24px;line-height:1.6;">
      이 코드는 10분간 유효합니다.<br>
      본인이 요청한 것이 아니라면 이 메일을 무시하셔도 됩니다.
    </p>
  </div>
</body></html>`;

  const info = await transporter.sendMail({ from, to, subject, text, html });

  if (isDevFallback) {
    // eslint-disable-next-line no-console
    console.log(`[emailSender] DEV fallback — SMTP 미설정, 실제 메일 발송 안 함. to=${to} code=${code} info=${JSON.stringify(info.messageId)}`);
  }
}
