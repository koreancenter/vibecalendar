import { AgentCommandResponse } from '../types';
import { AgentAttachmentPayload, AgentContext } from './agentApi';
import {
  COMPACT_LOCAL_SYSTEM_PROMPT,
  normalizeLocalModelOutput,
  prepareLocalPromptPayload,
} from './localAgentNormalizer';

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export interface OllamaModelInfo {
  name: string;
  parameterSize?: string;
}

export function normalizeOllamaBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_OLLAMA_BASE_URL;
  if (!/^https?:\/\//i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

export async function fetchOllamaModels(baseUrl: string): Promise<{
  ok: boolean;
  models: OllamaModelInfo[];
  error?: string;
}> {
  const cleanUrl = normalizeOllamaBaseUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);

  try {
    const res = await fetch(`${cleanUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, models: [], error: `응답 오류 (${res.status})` };
    }

    const data = (await res.json()) as {
      models?: Array<{
        name?: string;
        details?: { parameter_size?: string };
      }>;
    };

    const models: OllamaModelInfo[] = (data.models || [])
      .filter((m): m is { name: string; details?: { parameter_size?: string } } =>
        Boolean(m && typeof m.name === 'string' && m.name.trim())
      )
      .map((m) => ({
        name: m.name.trim(),
        parameterSize: m.details?.parameter_size,
      }));

    return { ok: true, models };
  } catch {
    return {
      ok: false,
      models: [],
      error: '로컬 서버가 연결되지 않았습니다',
    };
  } finally {
    clearTimeout(timer);
  }
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

  let res: Response;
  try {
    res = await fetch(`${cleanUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
    });
  } catch {
    throw new Error(
      `로컬 Ollama 서버(${cleanUrl})에 연결할 수 없습니다. Ollama 실행 상태와 OLLAMA_ORIGINS="*" 환경변수를 확인해 주세요.`
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama 오류 (${res.status}): ${errText.slice(0, 120) || '요청 실패'}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    response?: string;
  };
  const rawOutput = data.message?.content || data.response || '';
  if (!rawOutput.trim()) {
    throw new Error('Ollama 모델로부터 응답을 받지 못했습니다.');
  }

  return normalizeLocalModelOutput(rawOutput, prompt, context);
}
