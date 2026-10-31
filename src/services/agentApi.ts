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

export interface SendAgentCommandOptions {
  cloudAvailable?: boolean;
  onCloudGroundingRoute?: () => void;
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

  const res = await fetch('/api/agent/command', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      modelId: effectiveCloudModelId,
      context,
      image,
      attachments,
    }),
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

