import express, { Express, Request, Response, json, urlencoded } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { RegisterRoutes } from './routes/routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { socialLoginLimiter, refreshTokenLimiter } from './middleware/rateLimiter';
import { assignDailyQuestions } from './scheduler';

// Express 앱 생성
export function createApp(): Express {
  const app = express();

  // API Gateway → Lambda 는 클라이언트 IP 를 X-Forwarded-For 헤더로 전달한다.
  // trust proxy 를 1 로 설정해야 express-rate-limit 이 실제 클라이언트 IP 로 집계한다.
  // (기본값 false 이면 모든 요청이 동일 IP 로 취급돼 rate limit 이 사실상 무력화됨)
  app.set('trust proxy', 1);

  // 미들웨어 설정
  const isProduction = process.env.NODE_ENV === 'production';
  app.use(helmet({
    contentSecurityPolicy: isProduction, // production: 활성화 / dev: Swagger UI를 위해 비활성화
  }));

  // CORS — 프로덕션은 화이트리스트, 개발은 모두 허용
  // 모바일 앱(Origin 헤더 없음)은 항상 허용
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        // 모바일 앱(WKWebView/OkHttp)은 Origin 헤더가 없음 — 항상 허용
        if (!origin) return callback(null, true);
        // 개발 환경은 모두 허용
        if (!isProduction) return callback(null, true);
        // 프로덕션은 화이트리스트만
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`CORS: origin not allowed: ${origin}`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
    })
  );
  app.use(json());
  app.use(urlencoded({ extended: true }));

  // 정적 파일 서빙 (.well-known/apple-app-site-association, .well-known/assetlinks.json)
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // 초대 링크 랜딩 페이지
  // 배포 전이라 커스텀 도메인 없음 — Universal Link 불가.
  // 대신 페이지 로드 즉시 monggle://join/CODE 커스텀 스킴으로 자동 전환한다.
  // (앱이 설치된 경우만 대상이며, 설치되지 않았다면 페이지가 그대로 남음.)
  const inviteLandingHandler = (req: Request, res: Response) => {
    const code = (req.params.code || '').toUpperCase();
    // 커스텀 스킴은 영숫자/대문자만 — 코드가 이상하면 XSS 방지 차원에서 막아둔다.
    const safeCode = /^[A-Z0-9]{1,16}$/.test(code) ? code : '';
    const deepLink = safeCode ? `monggle://join/${safeCode}` : '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>몽글 초대</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(180deg,#FFF8F0 0%,#EFF8F1 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:20px;padding:40px 32px;max-width:360px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.08)}
    .logo{margin-bottom:16px}
    h1{font-size:24px;font-weight:700;color:#1A1A1A;margin-bottom:8px}
    .subtitle{font-size:15px;color:#888;margin-bottom:32px;line-height:1.5}
    .code-box{background:#F0F9F2;border-radius:12px;padding:20px;margin-bottom:32px}
    .code-label{font-size:12px;color:#56A96B;font-weight:600;margin-bottom:8px}
    .code{font-size:28px;font-weight:700;letter-spacing:6px;color:#56A96B}
    .open-btn{display:block;width:100%;padding:16px;background:#56A96B;color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:600;cursor:pointer;text-decoration:none;margin-bottom:12px}
    .open-btn:active{opacity:.8}
    .hint{font-size:12px;color:#AAA;line-height:1.6}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#66BB6A"/><circle cx="24" cy="30" r="5" fill="#1A1A1A"/><circle cx="24" cy="30" r="4" fill="#1A1A1A" stroke="#fff" stroke-width="1.5"/><circle cx="40" cy="30" r="5" fill="#1A1A1A"/><circle cx="40" cy="30" r="4" fill="#1A1A1A" stroke="#fff" stroke-width="1.5"/></svg></div>
    <h1>몽글 초대</h1>
    <p class="subtitle">친구가 초대 링크를 보냈어요.<br>몽글에서 함께해요!</p>
    <div class="code-box">
      <div class="code-label">초대 코드</div>
      <div class="code">${safeCode || '--------'}</div>
    </div>
    <a class="open-btn" href="monggle://join/${safeCode}">앱에서 열기</a>
    <p class="hint">버튼이 동작하지 않는다면<br>몽글 앱이 설치되어 있는지 확인해 주세요.</p>
  </div>
  <script>
    // 페이지 로드 즉시 커스텀 스킴으로 자동 전환 (앱이 설치된 경우 앱이 열림)
    (function () {
      var deepLink = ${JSON.stringify(deepLink)};
      if (!deepLink) return;
      // iOS Safari는 location.href 할당으로 충분, Android Chrome은 동일하게 동작
      setTimeout(function () { window.location.href = deepLink; }, 50);
    })();
  </script>
</body>
</html>`);
  };
  app.get('/join/:code', inviteLandingHandler);
  app.get('/invite/:code', inviteLandingHandler);

  // Apple Sign-In 콜백 (Android용 — Custom Tab OAuth form_post 플로우)
  //
  // 플로우:
  //   Android 앱 → Custom Tab(appleid.apple.com/auth/authorize?response_mode=form_post)
  //   → 사용자 Apple 로그인
  //   → Apple이 application/x-www-form-urlencoded 로 이 엔드포인트에 POST
  //   → 서버가 monggle://apple-callback?id_token=...&code=... 로 리다이렉트
  //   → AndroidManifest.xml 의 monggle://apple-callback intent-filter가 받음
  //   → handleAppleCallback() → AuthService.socialLogin('apple', ...)
  //
  // 주의: 이 엔드포인트는 토큰을 검증하지 않고 중계만 한다. 실제 검증은
  // POST /auth/social (AuthService.verifyAppleIdentityToken) 에서 수행.
  const appleCallbackHandler = (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const idToken = typeof body.id_token === 'string' ? body.id_token : '';
    const code = typeof body.code === 'string' ? body.code : '';
    const state = typeof body.state === 'string' ? body.state : '';
    const userField = typeof body.user === 'string' ? body.user : '';

    if (!idToken || !code) {
      res.status(400).send('Missing id_token or code');
      return;
    }

    // user 필드는 Apple이 최초 로그인 시에만 JSON 문자열로 전달
    // 예: {"name":{"firstName":"Hong","lastName":"Gildong"},"email":"..."}
    let name = '';
    let email = '';
    if (userField) {
      try {
        const parsed = JSON.parse(userField) as {
          name?: { firstName?: string; lastName?: string };
          email?: string;
        };
        const firstName = parsed.name?.firstName ?? '';
        const lastName = parsed.name?.lastName ?? '';
        name = `${firstName} ${lastName}`.trim();
        email = parsed.email ?? '';
      } catch {
        // user 파싱 실패는 무시 (id_token/code 만으로도 로그인 가능)
      }
    }

    const params = new URLSearchParams();
    params.set('id_token', idToken);
    params.set('code', code);
    if (name) params.set('name', name);
    if (email) params.set('email', email);
    if (state) params.set('state', state);

    const deepLink = `monggle://apple-callback?${params.toString()}`;

    // POST로 들어왔으므로 custom scheme 리다이렉트는 HTML 중간 페이지로 수행
    // (일부 Custom Tab 구현은 POST 302 → custom scheme 전환을 막기 때문)
    // JSON.stringify 로 JS 문자열 이스케이프 처리
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>로그인 중...</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(180deg,#FFF8F0 0%,#EFF8F1 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:20px;padding:40px 32px;max-width:320px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.08)}
.msg{color:#56A96B;font-size:16px;font-weight:600;margin-top:16px}
.hint{font-size:12px;color:#AAA;margin-top:12px;line-height:1.5}
.spinner{width:32px;height:32px;border:3px solid #E8F5EA;border-top-color:#56A96B;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="card">
<div class="spinner"></div>
<div class="msg">앱으로 돌아가는 중...</div>
<p class="hint">잠시 후 자동으로 몽글 앱이 열립니다.</p>
</div>
<script>window.location.href=${JSON.stringify(deepLink)};</script>
</body>
</html>`);
  };
  app.post('/auth/apple/callback', appleCallbackHandler);
  // GET은 사용자가 실수로 URL을 브라우저에 붙여넣었을 때의 폴백 (Apple은 POST만 보냄)
  app.get('/auth/apple/callback', (_req, res) => {
    res.status(405).send('Apple Sign-In callback accepts POST only.');
  });

  // Swagger UI 설정 (개발 환경)
  if (!isProduction) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const swaggerDocument = require('../dist/swagger.json');
      app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
        swaggerOptions: {
          persistAuthorization: true,
        },
        customSiteTitle: 'Mongle API Docs',
      }));
    } catch {
      console.log('Swagger document not found. Run "npm run swagger" to generate.');
    }
  }

  // HTTP 요청 로깅 (개발 환경) - 민감 필드 마스킹
  if (!isProduction) {
    const SENSITIVE_KEYS = new Set(['token', 'accessToken', 'refreshToken', 'secret', 'identity_token', 'id_token', 'access_token']);
    app.use((req, _res, next) => {
      let logBody: Record<string, unknown> | undefined;
      if (req.body && Object.keys(req.body).length) {
        logBody = Object.fromEntries(
          Object.entries(req.body as Record<string, unknown>).map(([k, v]) =>
            SENSITIVE_KEYS.has(k) ? [k, '***'] : [k, v]
          )
        );
      }
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, logBody ?? '');
      next();
    });
  }

  // 인증 엔드포인트에 rate limit 적용 (tsoa 라우트 등록 전에 미들웨어 등록)
  app.use('/auth/social', socialLoginLimiter);
  app.use('/auth/refresh', refreshTokenLimiter);
  // 이메일 인증 코드/가입/로그인도 brute-force 방어 대상
  app.use('/auth/email/request-code', socialLoginLimiter);
  app.use('/auth/email/signup', socialLoginLimiter);
  app.use('/auth/email/login', socialLoginLimiter);

  // API 라우트 등록 (tsoa가 생성)
  RegisterRoutes(app);

  // 404 핸들러
  app.use(notFoundHandler);

  // 에러 핸들러
  app.use(errorHandler);

  return app;
}

// 로컬 개발용 스케줄러: 5분마다 KST 정오 여부 체크 후 질문 배정
function startDailyQuestionScheduler() {
  async function checkAndAssign() {
    const now = new Date();
    // KST 정오 = UTC 03:00
    if (now.getUTCHours() !== 3 || now.getUTCMinutes() > 5) return;
    await assignDailyQuestions().catch((err) =>
      console.error('[Scheduler] Failed to assign daily questions:', err)
    );
  }

  setInterval(checkAndAssign, 5 * 60 * 1000);
  console.log('⏰ Daily question scheduler started (runs at KST noon / UTC 03:00)');
}

// 로컬 개발 서버
if (require.main === module) {
  const app = createApp();
  const startPort = Number(process.env.PORT) || 3000;

  startDailyQuestionScheduler();

  function listen(port: number) {
    const server = app.listen(port, () => {
      console.log(`🚀 Server is running on http://localhost:${port}`);
      console.log(`📚 API Docs: http://localhost:${port}/docs`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`⚠️  Port ${port} is already in use. Trying port ${port + 1}...`);
        server.close();
        listen(port + 1);
      } else {
        throw err;
      }
    });
  }

  listen(startPort);
}

export default createApp;
