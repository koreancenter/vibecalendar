import {
  AgentCommandResponse,
  AiModelSelection,
  CalendarEventItem,
  ChatSessionHistoryItem,
  ProjectItem,
} from '../types';
import { DEFAULT_OLLAMA_BASE_URL, executeOllamaAgentCommand } from './ollamaProvider';
import { executeWebLlmAgentCommand, WebLlmLoadProgress } from './webllmProvider';
import { shouldUseSearchGroundingForPlanning } from '../shared/scheduleUtils';
import {
  CLOUD_KEY_EXPIRED_MESSAGE,
  CloudModelOption,
  ensureCloudKeyHydrated,
  handleSavedCloudKeyUnauthorized,
} from '../utils/cloudApiKeyStorage';

export type { CloudModelOption };

function isUnauthorizedCloudError(
  httpStatus: number,
  body?: Record<string, unknown> | null
): boolean {
  return (
    httpStatus === 401 ||
    body?.status === 401 ||
    body?.code === 'CLOUD_API_KEY_UNAUTHORIZED'
  );
}

export const DEFAULT_AI_MODEL_SELECTION: AiModelSelection = {
  provider: 'cloud',
  modelId: '',
  displayName: 'API Key 필요',
  ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
};

export interface VerifyCloudApiKeyResponse {
  ok: boolean;
  models: CloudModelOption[];
  error?: string;
  latencyMs?: number;
}

export async function verifyCloudApiKey(apiKey: string): Promise<VerifyCloudApiKeyResponse> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { ok: false, models: [], error: 'API Key 필요' };
  }

  const startedAt = performance.now();
  const measureRtt = () => Math.max(1, Math.round(performance.now() - startedAt));

  try {
    const res = await fetch('/api/agent/cloud-models', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey: trimmed }),
    });
    const clientRttMs = measureRtt();
    const data = (await res.json().catch(() => null)) as Partial<VerifyCloudApiKeyResponse> | null;
    const resolvedLatencyMs =
      typeof data?.latencyMs === 'number' && Number.isFinite(data.latencyMs) && data.latencyMs > 0
        ? Math.round(data.latencyMs)
        : clientRttMs;

    if (!res.ok || !data) {
      return {
        ok: false,
        models: [],
        error: data?.error || `검증 요청 오류 (${res.status})`,
        latencyMs: resolvedLatencyMs,
      };
    }
    return {
      ok: Boolean(data.ok),
      models: Array.isArray(data.models) ? data.models : [],
      error: data.error,
      latencyMs: resolvedLatencyMs,
    };
  } catch {
    return {
      ok: false,
      models: [],
      error: '서버와 통신할 수 없습니다',
      latencyMs: measureRtt(),
    };
  }
}

export interface AgentContext {
  currentYear: number;
  selectedDate: string;
  viewerTimeZone?: string;
  viewerLocale?: string;
  existingEvents: CalendarEventItem[];
  selectedEvent?: CalendarEventItem | null;
  chatHistory?: ChatSessionHistoryItem[];
  lastReferencedEvent?: CalendarEventItem | null;
  projects?: ProjectItem[];
  selectedProjectId?: string | 'all';
  activeProjectName?: string;
}

export interface AgentImagePayload {
  data: string;
  mimeType: string;
}

export interface AgentAttachmentPayload {
  name: string;
  mimeType: string;
  kind: string;
  transferMode: 'inline' | 'text';
  base64Data?: string;
  textContent?: string;
}

export interface AgentStreamUpdate {
  stageText?: string;
  partialReplyText?: string;
  thoughtSummary?: string;
}

export interface SendAgentCommandOptions {
  cloudAvailable?: boolean;
  onCloudGroundingRoute?: () => void;
  onStreamUpdate?: (update: AgentStreamUpdate) => void;
}

export async function fetchAgentHealth(): Promise<{ geminiEnabled: boolean }> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { geminiEnabled: false };
    const data = (await res.json()) as { geminiEnabled?: boolean };
    return { geminiEnabled: Boolean(data.geminiEnabled) };
  } catch {
    return { geminiEnabled: false };
  }
}

export async function sendAgentCommand(
  prompt: string,
  context: AgentContext,
  image?: AgentImagePayload,
  attachments?: AgentAttachmentPayload[],
  modelSelection: AiModelSelection = DEFAULT_AI_MODEL_SELECTION,
  onWebLlmProgress?: (progress: WebLlmLoadProgress) => void,
  options?: SendAgentCommandOptions
): Promise<AgentCommandResponse> {
  const { apiKey: clientCloudApiKey, models: verifiedCloudModels } =
    await ensureCloudKeyHydrated();

  const wantsLiveWebGrounding =
    !image &&
    (!attachments || attachments.length === 0) &&
    shouldUseSearchGroundingForPlanning(prompt);

  const canUseCloudGrounding =
    options?.cloudAvailable !== false && Boolean(clientCloudApiKey && verifiedCloudModels.length > 0);
  const routeToCloudForGrounding =
    modelSelection.provider !== 'cloud' && wantsLiveWebGrounding && canUseCloudGrounding;

  if (routeToCloudForGrounding) {
    options?.onCloudGroundingRoute?.();
  }

  if (modelSelection.provider !== 'cloud' && !routeToCloudForGrounding) {
    if (modelSelection.provider === 'ollama') {
      return executeOllamaAgentCommand(
        modelSelection.modelId,
        modelSelection.ollamaBaseUrl,
        prompt,
        context,
        attachments || []
      );
    }

    if (modelSelection.provider === 'webllm') {
      return executeWebLlmAgentCommand(
        modelSelection.modelId,
        prompt,
        context,
        attachments || [],
        onWebLlmProgress
      );
    }
  }

  if (!clientCloudApiKey || verifiedCloudModels.length === 0) {
    throw new Error(
      'Cloud 모델을 사용하려면 모델 선택기(Cloud 탭)에서 Gemini API Key를 입력하고 검증해 주세요.'
    );
  }

  const effectiveCloudModelId =
    modelSelection.provider === 'cloud' && modelSelection.modelId
      ? modelSelection.modelId
      : verifiedCloudModels[0]?.id || 'gemini-flash-latest';

  const requestBody = JSON.stringify({
    prompt,
    modelId: effectiveCloudModelId,
    context,
    image,
    attachments,
  });

  const cloudAuthHeaders: Record<string, string> = clientCloudApiKey
    ? { 'X-Gemini-Api-Key': clientCloudApiKey }
    : {};

  if (options?.onStreamUpdate && typeof ReadableStream !== 'undefined') {
    const streamRes = await fetch('/api/agent/command-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...cloudAuthHeaders,
      },
      body: requestBody,
    });

    if (streamRes.ok && streamRes.body) {
      const contentType = streamRes.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let finalResponse: AgentCommandResponse | null = null;
        let streamErrorMessage: string | null = null;

        const processFrame = (rawFrame: string) => {
          const lines = rawFrame.split('\n');
          let eventType = 'message';
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            }
          }
          if (!dataLines.length) return;
          const payloadStr = dataLines.join('\n');
          try {
            const parsed = JSON.parse(payloadStr) as Record<string, unknown>;
            if (eventType === 'stage' || eventType === 'partial') {
              options.onStreamUpdate?.({
                stageText: typeof parsed.stageText === 'string' ? parsed.stageText : undefined,
                partialReplyText:
                  typeof parsed.partialReplyText === 'string'
                    ? parsed.partialReplyText
                    : undefined,
                thoughtSummary:
                  typeof parsed.thoughtSummary === 'string' ? parsed.thoughtSummary : undefined,
              });
            } else if (eventType === 'done') {
              finalResponse = parsed as unknown as AgentCommandResponse;
            } else if (eventType === 'error') {
              if (clientCloudApiKey && isUnauthorizedCloudError(0, parsed)) {
                handleSavedCloudKeyUnauthorized(CLOUD_KEY_EXPIRED_MESSAGE);
                streamErrorMessage = CLOUD_KEY_EXPIRED_MESSAGE;
              } else {
                streamErrorMessage =
                  typeof parsed.error === 'string'
                    ? parsed.error
                    : 'AI 스트리밍 응답 처리 중 오류가 발생했습니다.';
              }
            }
          } catch {
            // Ignore malformed partial frame
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundaryIdx = buffer.indexOf('\n\n');
          while (boundaryIdx !== -1) {
            const frame = buffer.slice(0, boundaryIdx);
            buffer = buffer.slice(boundaryIdx + 2);
            processFrame(frame);
            boundaryIdx = buffer.indexOf('\n\n');
          }
        }
        if (buffer.trim()) {
          processFrame(buffer);
        }

        if (streamErrorMessage) {
          throw new Error(streamErrorMessage);
        }
        if (finalResponse) {
          return finalResponse;
        }
      }
    } else if (!streamRes.ok && streamRes.status !== 404) {
      const errData = (await streamRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (clientCloudApiKey && isUnauthorizedCloudError(streamRes.status, errData)) {
        handleSavedCloudKeyUnauthorized(CLOUD_KEY_EXPIRED_MESSAGE);
        throw new Error(CLOUD_KEY_EXPIRED_MESSAGE);
      }
      throw new Error(
        typeof errData.error === 'string' ? errData.error : `서버 오류 (${streamRes.status})`
      );
    }
  }

  const res = await fetch('/api/agent/command', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...cloudAuthHeaders,
    },
    body: requestBody,
  });

  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (clientCloudApiKey && isUnauthorizedCloudError(res.status, errData)) {
      handleSavedCloudKeyUnauthorized(CLOUD_KEY_EXPIRED_MESSAGE);
      throw new Error(CLOUD_KEY_EXPIRED_MESSAGE);
    }
    throw new Error(
      typeof errData.error === 'string' ? errData.error : `서버 오류 (${res.status})`
    );
  }

  return res.json() as Promise<AgentCommandResponse>;
}

export interface GroundedDateRequestParams {
  topic: string;
  rangeMonths: number;
  modelId?: string;
  currentYear: number;
  selectedDate: string;
  activeProjectName?: string;
  activeProjectClient?: string;
  existingEvents: CalendarEventItem[];
}

export async function requestGroundedDateSuggestions(
  params: GroundedDateRequestParams
): Promise<AgentCommandResponse> {
  const { apiKey } = await ensureCloudKeyHydrated();
  const res = await fetch('/api/agent/grounding-dates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-Gemini-Api-Key': apiKey } : {}),
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (apiKey && isUnauthorizedCloudError(res.status, errData)) {
      handleSavedCloudKeyUnauthorized(CLOUD_KEY_EXPIRED_MESSAGE);
      throw new Error(CLOUD_KEY_EXPIRED_MESSAGE);
    }
    throw new Error(
      typeof errData.error === 'string' ? errData.error : `일정 탐색 오류 (${res.status})`
    );
  }

  return res.json() as Promise<AgentCommandResponse>;
}

export interface ResolveLocationResponse {
  found: boolean;
  location?: string;
  locationAddress?: string;
  locationLat?: number;
  locationLng?: number;
}

export async function resolveLocationDetails(params: {
  location: string;
  locationAddress?: string;
  modelId?: string;
}): Promise<ResolveLocationResponse> {
  const { apiKey } = await ensureCloudKeyHydrated();
  const res = await fetch('/api/agent/resolve-location', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-Gemini-Api-Key': apiKey } : {}),
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (apiKey && isUnauthorizedCloudError(res.status, errData)) {
      handleSavedCloudKeyUnauthorized(CLOUD_KEY_EXPIRED_MESSAGE);
      throw new Error(CLOUD_KEY_EXPIRED_MESSAGE);
    }
    throw new Error(
      typeof errData.error === 'string' ? errData.error : `위치 탐색 오류 (${res.status})`
    );
  }

  return res.json() as Promise<ResolveLocationResponse>;
}

export interface EnrichLocationBatchItem {
  key: string;
  location?: string;
  locationAddress?: string;
  locationLat?: number;
  locationLng?: number;
}

export interface EnrichLocationsBatchResponse {
  items: EnrichLocationBatchItem[];
  groundingSources: Array<{ uri: string; title: string }>;
  searchQueries: string[];
}

export async function enrichLocationsBatch(params: {
  items: Array<{ key: string; queryName: string }>;
  modelId?: string;
}): Promise<EnrichLocationsBatchResponse> {
  if (!params.items.length) {
    return { items: [], groundingSources: [], searchQueries: [] };
  }
  const { apiKey } = await ensureCloudKeyHydrated();
  if (!apiKey) {
    return { items: [], groundingSources: [], searchQueries: [] };
  }
  const res = await fetch('/api/agent/enrich-locations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gemini-Api-Key': apiKey,
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (isUnauthorizedCloudError(res.status, errData)) {
      handleSavedCloudKeyUnauthorized(CLOUD_KEY_EXPIRED_MESSAGE);
    }
    return { items: [], groundingSources: [], searchQueries: [] };
  }

  return res.json() as Promise<EnrichLocationsBatchResponse>;
}

