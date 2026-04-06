import express, { Express, Request, Response, json, urlencoded } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { RegisterRoutes } from './routes/routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { assignDailyQuestions } from './scheduler';

// Express 앱 생성
export function createApp(): Express {
  const app = express();

  // 미들웨어 설정
  const isProduction = process.env.NODE_ENV === 'production';
  app.use(helmet({
    contentSecurityPolicy: isProduction, // production: 활성화 / dev: Swagger UI를 위해 비활성화
  }));
  app.use(cors());
  app.use(json());
  app.use(urlencoded({ extended: true }));

  // 정적 파일 서빙 (.well-known/apple-app-site-association, .well-known/assetlinks.json)
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // 초대 링크 랜딩 페이지 (앱 미설치 시 폴백 페이지)
  const inviteLandingHandler = (req: Request, res: Response) => {
    const code = (req.params.code || '').toUpperCase();
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
    <p class="subtitle">가족이 초대 링크를 보냈어요.<br>몽글에서 함께해요!</p>
    <div class="code-box">
      <div class="code-label">초대 코드</div>
      <div class="code">${code}</div>
    </div>
    <a class="open-btn" href="monggle://join/${code}">앱에서 열기</a>
    <p class="hint">앱이 설치되어 있지 않다면<br>App Store 또는 Google Play에서 다운로드해 주세요.</p>
  </div>
</body>
</html>`);
  };
  app.get('/join/:code', inviteLandingHandler);
  app.get('/invite/:code', inviteLandingHandler);

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

  // API 라우트 등록 (tsoa가 생성)
  RegisterRoutes(app);

  // 404 핸들러
  app.use(notFoundHandler);

  // 에러 핸들러
  app.use(errorHandler);

  return app;
}

// 로컬 개발용 스케줄러: 5분마다 KST 자정 여부 체크 후 질문 배정
function startDailyQuestionScheduler() {
  async function checkAndAssign() {
    const now = new Date();
    // KST 자정 = UTC 15:00
    if (now.getUTCHours() !== 15 || now.getUTCMinutes() > 5) return;
    await assignDailyQuestions().catch((err) =>
      console.error('[Scheduler] Failed to assign daily questions:', err)
    );
  }

  setInterval(checkAndAssign, 5 * 60 * 1000);
  console.log('⏰ Daily question scheduler started (runs at KST midnight / UTC 15:00)');
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
