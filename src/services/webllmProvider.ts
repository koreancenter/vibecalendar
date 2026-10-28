import type { MLCEngine } from '@mlc-ai/web-llm';
import { AgentCommandResponse } from '../types';
import { AgentAttachmentPayload, AgentContext } from './agentApi';
import {
  COMPACT_LOCAL_SYSTEM_PROMPT,
  normalizeLocalModelOutput,
  prepareLocalPromptPayload,
} from './localAgentNormalizer';

export interface CuratedWebLlmModel {
  id: string;
  label: string;
  sizeLabel: string;
}

export const CURATED_WEBLLM_MODELS: CuratedWebLlmModel[] = [
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 1.5B',
    sizeLabel: '1.6 GB',
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 3B',
    sizeLabel: '2.5 GB',
  },
  {
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    label: 'Gemma 2 2B',
    sizeLabel: '1.9 GB',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B',
    sizeLabel: '2.3 GB',
  },
];

export interface WebLlmLoadProgress {
  modelId: string;
  percent: number;
  stageText: string;
}

let engineInstance: MLCEngine | null = null;
let currentLoadedModelId: string | null = null;
let loadingPromise: Promise<MLCEngine> | null = null;
let loadingTargetModelId: string | null = null;

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export async function getCachedWebLlmModelIds(): Promise<Set<string>> {
  const cached = new Set<string>();
  if (typeof window === 'undefined' || !isWebGpuAvailable()) return cached;

  try {
    const webllm = await import('@mlc-ai/web-llm');
    await Promise.all(
      CURATED_WEBLLM_MODELS.map(async (m) => {
        try {
          const exists = await webllm.hasModelInCache(m.id);
          if (exists) cached.add(m.id);
        } catch {
          // ignore cache check error for individual model
        }
      })
    );
  } catch {
    // ignore module load error
  }
  return cached;
}

export function getLoadedWebLlmModelId(): string | null {
  return currentLoadedModelId;
}

export async function ensureWebLlmEngine(
  modelId: string,
  onProgress?: (progress: WebLlmLoadProgress) => void
): Promise<MLCEngine> {
  if (!isWebGpuAvailable()) {
    throw new Error('현재 브라우저 환경에서 WebGPU를 지원하지 않아 WebLLM을 실행할 수 없습니다.');
  }

  if (engineInstance && currentLoadedModelId === modelId) {
    return engineInstance;
  }

  if (loadingPromise && loadingTargetModelId === modelId) {
    return loadingPromise;
  }

  loadingTargetModelId = modelId;
  loadingPromise = (async () => {
    try {
      const webllm = await import('@mlc-ai/web-llm');
      const progressCallback = (report: { progress: number; text: string }) => {
        const pct = Math.min(100, Math.max(0, Math.round((report.progress || 0) * 100)));
        onProgress?.({
          modelId,
          percent: pct,
          stageText: report.text || '',
        });
      };

      if (!engineInstance) {
        engineInstance = await webllm.CreateMLCEngine(modelId, {
          initProgressCallback: progressCallback,
        });
      } else {
        engineInstance.setInitProgressCallback(progressCallback);
        await engineInstance.reload(modelId);
      }

      currentLoadedModelId = modelId;
      onProgress?.({ modelId, percent: 100, stageText: 'Ready' });
      return engineInstance;
    } catch (err) {
      currentLoadedModelId = null;
      throw err instanceof Error
        ? err
        : new Error('WebLLM 모델을 GPU 메모리에 적재하는 중 오류가 발생했습니다.');
    } finally {
      loadingPromise = null;
      loadingTargetModelId = null;
    }
  })();

  return loadingPromise;
}

export async function executeWebLlmAgentCommand(
  modelId: string,
  prompt: string,
  context: AgentContext,
  attachments: AgentAttachmentPayload[] = [],
  onProgress?: (progress: WebLlmLoadProgress) => void
): Promise<AgentCommandResponse> {
  const { userContent } = prepareLocalPromptPayload(prompt, context, attachments, false);
  const engine = await ensureWebLlmEngine(modelId, onProgress);

  const completion = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: COMPACT_LOCAL_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
    max_tokens: 1024,
  });

  const rawOutput = completion.choices?.[0]?.message?.content || '';
  if (!rawOutput.trim()) {
    throw new Error('WebLLM 모델로부터 응답을 생성하지 못했습니다.');
  }

  return normalizeLocalModelOutput(rawOutput, prompt, context);
}
