import { AgentCommandResponse } from '../types';
import { AgentAttachmentPayload, AgentContext } from './agentApi';
import {
  COMPACT_LOCAL_SYSTEM_PROMPT,
  normalizeLocalModelOutput,
  prepareLocalPromptPayload,
} from './localAgentNormalizer';

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const OLLAMA_HEALTH_TIMEOUT_MS = 5000;
const OLLAMA_CHAT_TIMEOUT_MS = 90000;

export type OllamaDiagnosticKind =
  | 'connected_direct'
  | 'connected_proxy'
  | 'cors_blocked'
  | 'timeout'
  | 'offline'
  | 'http_error';

export interface OllamaModelInfo {
  name: string;
  parameterSize?: string;
  quantizationLevel?: string;
  sizeBytes?: number;
}

export interface OllamaRunningModelInfo {
  name: string;
  sizeBytes: number;
  vramBytes: number;
  cpuBytes: number;
  vramPercent: number;
  parameterSize?: string;
}

export interface OllamaHostMetrics {
  cpuPercent: number;
  cores: number;
  totalMemBytes: number;
  usedMemBytes: number;
  isLocalHostServer: boolean;
}

export interface OllamaRuntimePsSnapshot {
  ok: boolean;
  viaProxy: boolean;
  diagnosticKind: OllamaDiagnosticKind;
  models: OllamaRunningModelInfo[];
  totalVramBytes: number;
  totalCpuBytes: number;
  hostMetrics: OllamaHostMetrics | null;
}

export interface OllamaActivityState {
  isGenerating: boolean;
  activeModelId: string | null;
  viaProxy: boolean;
  lastDiagnostic: OllamaDiagnosticKind | null;
  lastUpdatedAt: number;
}

const knownModelSizeBytesMap = new Map<string, number>();

let activityState: OllamaActivityState = {
  isGenerating: false,
  activeModelId: null,
  viaProxy: false,
  lastDiagnostic: null,
  lastUpdatedAt: Date.now(),
};

const activityListeners = new Set<(state: OllamaActivityState) => void>();

function updateOllamaActivity(patch: Partial<OllamaActivityState>): void {
  activityState = {
    ...activityState,
    ...patch,
    lastUpdatedAt: Date.now(),
  };
  for (const listener of activityListeners) {
    listener(activityState);
  }
}

export function getOllamaActivityState(): OllamaActivityState {
  return activityState;
}

export function subscribeOllamaActivity(
  listener: (state: OllamaActivityState) => void
): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}

export function getKnownOllamaModelSizeBytes(modelName: string): number | null {
  if (!modelName) return null;
  const exact = knownModelSizeBytesMap.get(modelName);
  if (typeof exact === 'number' && exact > 0) return exact;

  // 파라미터 이름(예: 7b, 3b, 1.5b, 14b)으로부터 합리적 Q4 가중치 크기 추정 폴백
  const match = modelName.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (match) {
    const billions = parseFloat(match[1]);
    if (Number.isFinite(billions) && billions > 0 && billions <= 200) {
      return Math.round(billions * 0.68 * 1024 * 1024 * 1024);
    }
  }
  return null;
}

export function normalizeOllamaBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_OLLAMA_BASE_URL;
  if (!/^https?:\/\//i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

function isLoopbackOllamaUrl(cleanUrl: string): boolean {
  try {
    const parsed = new URL(cleanUrl);
    const host = parsed.hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

function isLikelyCorsTypeError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    return /failed to fetch|networkerror|load failed|cors/i.test(err.message);
  }
  return false;
}

function isCrossOriginBrowserContext(cleanUrl: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const target = new URL(cleanUrl);
    return window.location.origin !== target.origin;
  } catch {
    return true;
  }
}

interface InternalOllamaRequestResult<T> {
  ok: boolean;
  data?: T;
  viaProxy: boolean;
  diagnosticKind: OllamaDiagnosticKind;
  error?: string;
  corsCommand?: string;
  hostMetrics?: OllamaHostMetrics | null;
}

interface ProxyEnvelope<T> {
  ok?: boolean;
  reachable?: boolean;
  timedOut?: boolean;
  status?: number;
  data?: T;
  error?: string;
  hostMetrics?: OllamaHostMetrics;
}

async function requestViaBackendProxy<T>(
  cleanUrl: string,
  endpoint: '/api/tags' | '/api/ps' | '/api/version' | '/api/chat',
  method: 'GET' | 'POST',
  payload?: Record<string, unknown>,
  timeoutMs = OLLAMA_HEALTH_TIMEOUT_MS
): Promise<InternalOllamaRequestResult<T> | null> {
  if (!isLoopbackOllamaUrl(cleanUrl)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 800);

  try {
    const proxyRes = await fetch('/api/agent/ollama-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: cleanUrl,
        endpoint,
        method,
        payload,
      }),
      signal: controller.signal,
    });

    const envelope = (await proxyRes.json().catch(() => null)) as ProxyEnvelope<T> | null;
    if (!envelope) return null;

    if (envelope.ok && envelope.reachable && envelope.data !== undefined) {
      return {
        ok: true,
        data: envelope.data,
        viaProxy: true,
        diagnosticKind: 'connected_proxy',
        hostMetrics: envelope.hostMetrics ?? null,
      };
    }

    if (envelope.reachable && !envelope.ok) {
      return {
        ok: false,
        viaProxy: true,
        diagnosticKind: 'http_error',
        error: envelope.error || `Ollama 응답 오류 (${envelope.status || proxyRes.status})`,
        hostMetrics: envelope.hostMetrics ?? null,
      };
    }

    if (envelope.timedOut) {
      return {
        ok: false,
        viaProxy: true,
        diagnosticKind: 'timeout',
        error: '로컬 Ollama 응답 시간이 초과되었습니다 (5초)',
        hostMetrics: envelope.hostMetrics ?? null,
      };
    }

    return {
      ok: false,
      viaProxy: false,
      diagnosticKind: 'offline',
      hostMetrics: envelope.hostMetrics ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function requestOllamaWithDiagnostics<T>(
  baseUrl: string,
  endpoint: '/api/tags' | '/api/ps' | '/api/version' | '/api/chat',
  method: 'GET' | 'POST' = 'GET',
  payload?: Record<string, unknown>,
  timeoutMs = OLLAMA_HEALTH_TIMEOUT_MS
): Promise<InternalOllamaRequestResult<T>> {
  const cleanUrl = normalizeOllamaBaseUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const directRes = await fetch(`${cleanUrl}${endpoint}`, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' && payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });

    if (!directRes.ok) {
      const errText = await directRes.text().catch(() => '');
      updateOllamaActivity({ viaProxy: false, lastDiagnostic: 'http_error' });
      return {
        ok: false,
        viaProxy: false,
        diagnosticKind: 'http_error',
        error: errText.trim().slice(0, 120) || `응답 오류 (${directRes.status})`,
      };
    }

    const json = (await directRes.json()) as T;
    updateOllamaActivity({ viaProxy: false, lastDiagnostic: 'connected_direct' });
    return {
      ok: true,
      data: json,
      viaProxy: false,
      diagnosticKind: 'connected_direct',
    };
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (isAbort) {
      updateOllamaActivity({ lastDiagnostic: 'timeout' });
      return {
        ok: false,
        viaProxy: false,
        diagnosticKind: 'timeout',
        error: '응답 시간 초과 (5초) · Ollama 실행 상태를 확인해 주세요',
      };
    }

    const sawCorsTypeError = isLikelyCorsTypeError(err);

    // 직접 브라우저 호출이 CORS 정책으로 차단된 경우 백엔드 루프백 프록시로 자동 우회 시도
    const proxyAttempt = await requestViaBackendProxy<T>(
      cleanUrl,
      endpoint,
      method,
      payload,
      timeoutMs
    );

    if (proxyAttempt && proxyAttempt.ok) {
      updateOllamaActivity({ viaProxy: true, lastDiagnostic: 'connected_proxy' });
      return proxyAttempt;
    }

    if (proxyAttempt && (proxyAttempt.diagnosticKind === 'http_error' || proxyAttempt.diagnosticKind === 'timeout')) {
      updateOllamaActivity({ viaProxy: proxyAttempt.viaProxy, lastDiagnostic: proxyAttempt.diagnosticKind });
      return proxyAttempt;
    }

    // 크로스 오리진 브라우저에서 TypeError: Failed to fetch가 발생했고 프록시 서버가 원격 컨테이너인 경우 CORS 안내 제공
    const isRemoteServer = proxyAttempt?.hostMetrics
      ? !proxyAttempt.hostMetrics.isLocalHostServer
      : true;

    if (sawCorsTypeError && isCrossOriginBrowserContext(cleanUrl) && isRemoteServer) {
      updateOllamaActivity({ viaProxy: false, lastDiagnostic: 'cors_blocked' });
      return {
        ok: false,
        viaProxy: false,
        diagnosticKind: 'cors_blocked',
        error: '브라우저 CORS 정책으로 차단되었거나 로컬 서버가 꺼져 있습니다',
        corsCommand: 'OLLAMA_ORIGINS="*" ollama serve',
        hostMetrics: proxyAttempt?.hostMetrics ?? null,
      };
    }

    updateOllamaActivity({ viaProxy: false, lastDiagnostic: 'offline' });
    return {
      ok: false,
      viaProxy: false,
      diagnosticKind: sawCorsTypeError ? 'cors_blocked' : 'offline',
      error: sawCorsTypeError
        ? '로컬 서버 미실행 또는 CORS 허용(OLLAMA_ORIGINS="*")이 필요합니다'
        : '로컬 Ollama 서버가 연결되지 않았습니다',
      corsCommand: 'OLLAMA_ORIGINS="*" ollama serve',
      hostMetrics: proxyAttempt?.hostMetrics ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runOllamaPreflightCheck(baseUrl: string): Promise<{
  ok: boolean;
  viaProxy: boolean;
  diagnosticKind: OllamaDiagnosticKind;
  version?: string;
  error?: string;
  corsCommand?: string;
}> {
  const res = await requestOllamaWithDiagnostics<{ version?: string }>(
    baseUrl,
    '/api/version',
    'GET',
    undefined,
    OLLAMA_HEALTH_TIMEOUT_MS
  );
  return {
    ok: res.ok,
    viaProxy: res.viaProxy,
    diagnosticKind: res.diagnosticKind,
    version: res.data?.version,
    error: res.error,
    corsCommand: res.corsCommand,
  };
}

export async function fetchOllamaModels(baseUrl: string): Promise<{
  ok: boolean;
  models: OllamaModelInfo[];
  viaProxy?: boolean;
  diagnosticKind?: OllamaDiagnosticKind;
  corsCommand?: string;
  error?: string;
}> {
  // 1단계: 빠른 진단 프리플라이트 및 태그 조회 (5초 타임아웃 보장)
  const res = await requestOllamaWithDiagnostics<{
    models?: Array<{
      name?: string;
      size?: number;
      details?: {
        parameter_size?: string;
        quantization_level?: string;
      };
    }>;
  }>(baseUrl, '/api/tags', 'GET', undefined, OLLAMA_HEALTH_TIMEOUT_MS);

  if (!res.ok || !res.data) {
    return {
      ok: false,
      models: [],
      viaProxy: res.viaProxy,
      diagnosticKind: res.diagnosticKind,
      corsCommand: res.corsCommand,
      error: res.error || '로컬 서버가 연결되지 않았습니다',
    };
  }

  const models: OllamaModelInfo[] = (res.data.models || [])
    .filter(
      (
        m
      ): m is {
        name: string;
        size?: number;
        details?: { parameter_size?: string; quantization_level?: string };
      } => Boolean(m && typeof m.name === 'string' && m.name.trim())
    )
    .map((m) => {
      const cleanName = m.name.trim();
      const sizeBytes = typeof m.size === 'number' && m.size > 0 ? m.size : undefined;
      if (sizeBytes) {
        knownModelSizeBytesMap.set(cleanName, sizeBytes);
      }
      return {
        name: cleanName,
        parameterSize: m.details?.parameter_size,
        quantizationLevel: m.details?.quantization_level,
        sizeBytes,
      };
    });

  return {
    ok: true,
    models,
    viaProxy: res.viaProxy,
    diagnosticKind: res.diagnosticKind,
  };
}

export async function fetchOllamaRuntimePs(baseUrl: string): Promise<OllamaRuntimePsSnapshot> {
  const res = await requestOllamaWithDiagnostics<{
    models?: Array<{
      name?: string;
      model?: string;
      size?: number;
      size_vram?: number;
      details?: { parameter_size?: string };
    }>;
  }>(baseUrl, '/api/ps', 'GET', undefined, 4000);

  if (!res.ok || !res.data) {
    return {
      ok: false,
      viaProxy: res.viaProxy,
      diagnosticKind: res.diagnosticKind,
      models: [],
      totalVramBytes: 0,
      totalCpuBytes: 0,
      hostMetrics: res.hostMetrics ?? null,
    };
  }

  // 직접 브라우저 연결 성공 시, 로컬 개발 서버인 경우 호스트 CPU 메트릭 보조 조회
  let hostMetrics = res.hostMetrics ?? null;
  if (!hostMetrics) {
    try {
      const hostRes = await fetch('/api/agent/system-metrics');
      if (hostRes.ok) {
        const parsedHost = (await hostRes.json()) as OllamaHostMetrics;
        if (parsedHost && parsedHost.isLocalHostServer) {
          hostMetrics = parsedHost;
        }
      }
    } catch {
      // ignore auxiliary host metrics error
    }
  }

  let totalVramBytes = 0;
  let totalCpuBytes = 0;

  const models: OllamaRunningModelInfo[] = (res.data.models || [])
    .filter((m) => Boolean(m && (m.name || m.model)))
    .map((m) => {
      const name = (m.name || m.model || '').trim();
      const sizeBytes = Math.max(0, Number(m.size || 0));
      const vramBytes = Math.max(0, Math.min(sizeBytes || Number(m.size_vram || 0), Number(m.size_vram || 0)));
      const cpuBytes = Math.max(0, sizeBytes - vramBytes);
      const vramPercent = sizeBytes > 0 ? Math.round((vramBytes / sizeBytes) * 100) : 0;

      totalVramBytes += vramBytes;
      totalCpuBytes += cpuBytes;

      return {
        name,
        sizeBytes,
        vramBytes,
        cpuBytes,
        vramPercent,
        parameterSize: m.details?.parameter_size,
      };
    });

  return {
    ok: true,
    viaProxy: res.viaProxy,
    diagnosticKind: res.diagnosticKind,
    models,
    totalVramBytes,
    totalCpuBytes,
    hostMetrics,
  };
}

function isLikelyVisionOllamaModel(modelId: string): boolean {
  return /llava|vision|vl|gemma3|minicpm-v|moondream|bakllava|pixtral/i.test(modelId);
}

export async function executeOllamaAgentCommand(
  modelId: string,
  baseUrl: string,
  prompt: string,
  context: AgentContext,
  attachments: AgentAttachmentPayload[] = []
): Promise<AgentCommandResponse> {
  const cleanUrl = normalizeOllamaBaseUrl(baseUrl);
  const allowVision = isLikelyVisionOllamaModel(modelId);
  const { userContent, inlineImagesBase64 } = prepareLocalPromptPayload(
    prompt,
    context,
    attachments,
    allowVision
  );

  const userMessage: { role: 'user'; content: string; images?: string[] } = {
    role: 'user',
    content: userContent,
  };
  if (inlineImagesBase64.length > 0) {
    userMessage.images = inlineImagesBase64;
  }

  const chatPayload: Record<string, unknown> = {
    model: modelId,
    messages: [
      { role: 'system', content: COMPACT_LOCAL_SYSTEM_PROMPT },
      userMessage,
    ],
    format: 'json',
    stream: false,
    options: {
      temperature: 0.2,
    },
  };

  updateOllamaActivity({ isGenerating: true, activeModelId: modelId });

  try {
    const res = await requestOllamaWithDiagnostics<{
      message?: { content?: string };
      response?: string;
    }>(cleanUrl, '/api/chat', 'POST', chatPayload, OLLAMA_CHAT_TIMEOUT_MS);

    if (!res.ok || !res.data) {
      if (res.diagnosticKind === 'cors_blocked') {
        throw new Error(
          `로컬 Ollama 서버(${cleanUrl}) 연결이 브라우저 CORS 정책에 의해 차단되었습니다. 터미널에서 OLLAMA_ORIGINS="*" ollama serve 로 실행해 주세요.`
        );
      }
      if (res.diagnosticKind === 'timeout') {
        throw new Error(`로컬 Ollama 모델 응답 시간이 초과되었습니다 (${cleanUrl}).`);
      }
      throw new Error(
        res.error ||
          `로컬 Ollama 서버(${cleanUrl})에 연결할 수 없습니다. 실행 상태와 OLLAMA_ORIGINS="*" 설정을 확인해 주세요.`
      );
    }

    const rawOutput = res.data.message?.content || res.data.response || '';
    if (!rawOutput.trim()) {
      throw new Error('Ollama 모델로부터 응답을 받지 못했습니다.');
    }

    return normalizeLocalModelOutput(rawOutput, prompt, context);
  } finally {
    updateOllamaActivity({ isGenerating: false });
  }
}
