import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import {
  securityHeaders,
  apiRateLimiter,
  inlineMediaJsonParser,
  textCommandJsonParser,
  enforceInlineMediaOrTextPayloadLimit,
  validateAgentCommandRequest,
  sanitizeAgentCommandPayload,
  validateGroundingDatesRequest,
  sanitizeGroundingDatesPayload,
  validateResolveLocationRequest,
  sanitizeResolveLocationPayload,
  toSafeErrorResponse,
  logSafeServerError,
  apiErrorHandler,
} from './src/server/security';
import {
  executeGeminiAgentCommand,
  executeGroundedDateDiscoveryCommand,
  executeResolveLocationCommand,
  isGeminiConfigured,
} from './src/server/geminiAgent';

dotenv.config();

const app = express();
const PORT = 3000;

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    geminiEnabled: isGeminiConfigured(),
  });
});

// 인라인 미디어/첨부 파일을 처리하는 엔드포인트: 인라인 첨부 포함 시에만 18MB 허용, 일반 텍스트 명령은 512KB 강제
app.post(
  '/api/agent/command',
  apiRateLimiter,
  inlineMediaJsonParser,
  enforceInlineMediaOrTextPayloadLimit,
  async (req, res) => {
    try {
      const validation = validateAgentCommandRequest(req.body);
      if (!validation.ok) {
        res.status(validation.status).json({ error: validation.error });
        return;
      }

      const sanitizedPayload = sanitizeAgentCommandPayload(validation.value);
      if (
        !sanitizedPayload.prompt &&
        !sanitizedPayload.image &&
        sanitizedPayload.attachments.length === 0
      ) {
        res.status(400).json({ error: '자연어 지시나 분석할 파일을 전달해 주세요.' });
        return;
      }

      const result = await executeGeminiAgentCommand(sanitizedPayload);
      res.json(result);
    } catch (err: unknown) {
      logSafeServerError('Agent Command API', err);
      const safe = toSafeErrorResponse(err, 'command', true);
      res.status(safe.status).json({ error: safe.error });
    }
  }
);

// 일반 텍스트 명령 엔드포인트: 엄격한 512KB 페이로드 상한 적용
app.post(
  '/api/agent/grounding-dates',
  apiRateLimiter,
  textCommandJsonParser,
  async (req, res) => {
    try {
      const validation = validateGroundingDatesRequest(req.body);
      if (!validation.ok) {
        res.status(validation.status).json({ error: validation.error });
        return;
      }

      const sanitizedPayload = sanitizeGroundingDatesPayload(validation.value);
      const result = await executeGroundedDateDiscoveryCommand(sanitizedPayload);
      res.json(result);
    } catch (err: unknown) {
      logSafeServerError('Grounding Dates API', err);
      const safe = toSafeErrorResponse(err, 'grounding', false);
      res.status(safe.status).json({ error: safe.error });
    }
  }
);

// 일반 텍스트 명령 엔드포인트: 엄격한 512KB 페이로드 상한 적용
app.post(
  '/api/agent/resolve-location',
  apiRateLimiter,
  textCommandJsonParser,
  async (req, res) => {
    try {
      const validation = validateResolveLocationRequest(req.body);
      if (!validation.ok) {
        res.status(validation.status).json({ error: validation.error });
        return;
      }

      const sanitizedPayload = sanitizeResolveLocationPayload(validation.value);
      if (!sanitizedPayload.location && !sanitizedPayload.locationAddress) {
        res.status(400).json({ error: '탐색할 장소명 또는 주소를 입력해 주세요.' });
        return;
      }

      const result = await executeResolveLocationCommand(sanitizedPayload);
      res.json(result);
    } catch (err: unknown) {
      logSafeServerError('Resolve Location API', err);
      const safe = toSafeErrorResponse(err, 'location', false);
      res.status(safe.status).json({ error: safe.error });
    }
  }
);

// 정의되지 않은 /api 경로 요청 시 내부 스택 노출 없이 정갈한 JSON 404 반환
app.use('/api', (_req, res) => {
  res.status(404).json({ error: '요청한 API 경로를 찾을 수 없습니다.' });
});

// JSON 파서 오류(400/413/415) 및 예기치 않은 미들웨어 오류 안전 처리
app.use(apiErrorHandler);

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve('dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
