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
  app.get('/join/:code', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'join.html'));
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

  // HTTP 요청 로깅 (개발 환경) - 민감 필드(password, token) 마스킹
  if (!isProduction) {
    const SENSITIVE_KEYS = new Set(['password', 'token', 'accessToken', 'refreshToken', 'secret']);
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
