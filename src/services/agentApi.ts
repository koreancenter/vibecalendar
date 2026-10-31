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

export interface CloudModelOption {
  id: string;
  label: string;
}

export const CLOUD_MODEL_OPTIONS: CloudModelOption[] = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
  { id: 'gemini-flash-latest', label: 'Gemini Flash Latest' },
];

export const DEFAULT_AI_MODEL_SELECTION: AiModelSelection = {
  provider: 'cloud',
  modelId: 'gemini-3.8-flash',
  displayName: 'Gemini 3.8 Flash',
  ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
};

export interface AgentContext {
  currentYear: number;
  selectedDate: string;
  viewerTimeZone?: string;
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
  const wantsLiveWebGrounding =
    !image &&
    (!attachments || attachments.length === 0) &&
    shouldUseSearchGroundingForPlanning(prompt);

  const canUseCloudGrounding = options?.cloudAvailable !== false;
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

  const effectiveCloudModelId =
    modelSelection.provider === 'cloud'
      ? modelSelection.modelId
      : DEFAULT_AI_MODEL_SELECTION.modelId;

  const requestBody = JSON.stringify({
    prompt,
    modelId: effectiveCloudModelId,
    context,
    image,
    attachments,
  });

  if (options?.onStreamUpdate && typeof ReadableStream !== 'undefined') {
    const streamRes = await fetch('/api/agent/command-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
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
              streamErrorMessage =
                typeof parsed.error === 'string'
                  ? parsed.error
                  : 'AI 스트리밍 응답 처리 중 오류가 발생했습니다.';
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
      const errData = (await streamRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `서버 오류 (${streamRes.status})`);
    }
  }

  const res = await fetch('/api/agent/command', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: requestBody,
  });

  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error || `서버 오류 (${res.status})`);
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
  const res = await fetch('/api/agent/grounding-dates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error || `일정 탐색 오류 (${res.status})`);
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
  const res = await fetch('/api/agent/resolve-location', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error || `위치 탐색 오류 (${res.status})`);
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
  const res = await fetch('/api/agent/enrich-locations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    return { items: [], groundingSources: [], searchQueries: [] };
  }

  return res.json() as Promise<EnrichLocationsBatchResponse>;
}

