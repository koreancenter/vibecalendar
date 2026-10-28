import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import {
  securityHeaders,
  apiRateLimiter,
  validateAndSanitizeAgentRequest,
  validateAndSanitizeGroundingRequest,
  validateAndSanitizeLocationResolveRequest,
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

// 멀티모달 첨부(PDF, 오디오, 다중 이미지 등) 라우트에 18MB 허용, 나머지 전역 라우트는 256KB 제한
const agentJsonParser = express.json({ limit: '18mb' });
const defaultJsonParser = express.json({ limit: '256kb' });

app.get('/api/health', defaultJsonParser, (_req, res) => {
  res.json({
    status: 'ok',
    geminiEnabled: isGeminiConfigured(),
  });
});

app.post('/api/agent/command', apiRateLimiter, agentJsonParser, async (req, res) => {
  const validation = validateAndSanitizeAgentRequest(req.body);
  if (!validation.ok) {
    res.status(validation.status).json({ error: validation.error });
    return;
  }

  try {
    const result = await executeGeminiAgentCommand(validation.value);
    res.json(result);
  } catch (err: unknown) {
    const statusCode =
      err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
        ? err.statusCode
        : 502;
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'AI 일정 분석 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
    console.error('[Agent API Error]:', err);
    res.status(statusCode).json({ error: message });
  }
});

app.post('/api/agent/grounding-dates', apiRateLimiter, defaultJsonParser, async (req, res) => {
  const validation = validateAndSanitizeGroundingRequest(req.body);
  if (!validation.ok) {
    res.status(validation.status).json({ error: validation.error });
    return;
  }

  try {
    const result = await executeGroundedDateDiscoveryCommand(validation.value);
    res.json(result);
  } catch (err: unknown) {
    const statusCode =
      err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
        ? err.statusCode
        : 502;
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Google 검색 기반 일정 탐색 중 일시적인 오류가 발생했습니다.';
    console.error('[Grounding API Error]:', err);
    res.status(statusCode).json({ error: message });
  }
});

app.post('/api/agent/resolve-location', apiRateLimiter, defaultJsonParser, async (req, res) => {
  const validation = validateAndSanitizeLocationResolveRequest(req.body);
  if (!validation.ok) {
    res.status(validation.status).json({ error: validation.error });
    return;
  }

  try {
    const result = await executeResolveLocationCommand(validation.value);
    res.json(result);
  } catch (err: unknown) {
    const statusCode =
      err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
        ? err.statusCode
        : 502;
    const message =
      err instanceof Error && err.message
        ? err.message
        : '장소 주소 및 위경도 탐색 중 오류가 발생했습니다.';
    console.error('[Resolve Location API Error]:', err);
    res.status(statusCode).json({ error: message });
  }
});

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
