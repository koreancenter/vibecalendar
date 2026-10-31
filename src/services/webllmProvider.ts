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
  estimatedVramMB: number;
}

export const CURATED_WEBLLM_MODELS: CuratedWebLlmModel[] = [
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 1.5B',
    sizeLabel: '1.6 GB',
    estimatedVramMB: 1630,
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 3B',
    sizeLabel: '2.5 GB',
    estimatedVramMB: 2510,
  },
  {
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    label: 'Gemma 2 2B',
    sizeLabel: '1.9 GB',
    estimatedVramMB: 1900,
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B',
    sizeLabel: '2.3 GB',
    estimatedVramMB: 2265,
  },
];

export interface WebLlmLoadProgress {
  modelId: string;
  percent: number;
  stageText: string;
}

export interface WebGpuDeviceInfo {
  available: boolean;
  vendorLabel: string;
  maxBufferMB: number;
  maxStorageBufferMB: number;
  ceilingMB: number;
}

export interface WebLlmActivityState {
  loadedModelId: string | null;
  loadingModelId: string | null;
  loadPercent: number;
  stageText: string;
  isGenerating: boolean;
  lastTokPerSec: number | null;
  lastUpdatedAt: number;
}

let engineInstance: MLCEngine | null = null;
let currentLoadedModelId: string | null = null;
let loadingPromise: Promise<MLCEngine> | null = null;
let loadingTargetModelId: string | null = null;

const prebuiltVramMBMap = new Map<string, number>();
let cachedDeviceInfoPromise: Promise<WebGpuDeviceInfo> | null = null;

let activityState: WebLlmActivityState = {
  loadedModelId: null,
  loadingModelId: null,
  loadPercent: 0,
  stageText: '',
  isGenerating: false,
  lastTokPerSec: null,
  lastUpdatedAt: Date.now(),
};

const activityListeners = new Set<(state: WebLlmActivityState) => void>();

function updateWebLlmActivity(patch: Partial<WebLlmActivityState>): void {
  activityState = {
    ...activityState,
    ...patch,
    lastUpdatedAt: Date.now(),
  };
  for (const listener of activityListeners) {
    listener(activityState);
  }
}

export function getWebLlmActivityState(): WebLlmActivityState {
  return activityState;
}

export function subscribeWebLlmActivity(
  listener: (state: WebLlmActivityState) => void
): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}

export function getEstimatedWebLlmVramMB(modelId: string | null | undefined): number {
  if (!modelId) return 0;
  const fromPrebuilt = prebuiltVramMBMap.get(modelId);
  if (typeof fromPrebuilt === 'number' && fromPrebuilt > 0) {
    return Math.round(fromPrebuilt);
  }
  const curated = CURATED_WEBLLM_MODELS.find((m) => m.id === modelId);
  if (curated) return curated.estimatedVramMB;
  return 1850;
}

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

interface NavigatorGpuAdapterLike {
  info?: {
    vendor?: string;
    architecture?: string;
    description?: string;
  };
  limits?: {
    maxBufferSize?: number;
    maxStorageBufferBindingSize?: number;
  };
}

interface NavigatorWithGpu extends Navigator {
  gpu?: {
    requestAdapter: () => Promise<NavigatorGpuAdapterLike | null>;
  };
}

export function probeWebGpuDeviceInfo(): Promise<WebGpuDeviceInfo> {
  if (cachedDeviceInfoPromise) return cachedDeviceInfoPromise;

  cachedDeviceInfoPromise = (async (): Promise<WebGpuDeviceInfo> => {
    if (!isWebGpuAvailable()) {
      return {
        available: false,
        vendorLabel: 'WebGPU 미지원',
        maxBufferMB: 0,
        maxStorageBufferMB: 0,
        ceilingMB: 4096,
      };
    }

    try {
      const nav = navigator as NavigatorWithGpu;
      const adapter = await nav.gpu?.requestAdapter();
      if (!adapter) {
        return {
          available: false,
          vendorLabel: 'GPU 어댑터 없음',
          maxBufferMB: 0,
          maxStorageBufferMB: 0,
          ceilingMB: 4096,
        };
      }

      const maxBufferBytes = adapter.limits?.maxBufferSize || 2 * 1024 * 1024 * 1024;
      const maxStorageBytes =
        adapter.limits?.maxStorageBufferBindingSize || 1024 * 1024 * 1024;
      const maxBufferMB = Math.round(maxBufferBytes / (1024 * 1024));
      const maxStorageBufferMB = Math.round(maxStorageBytes / (1024 * 1024));

      // 브라우저 WebGPU 단일 버퍼 상한을 기반으로 실효 VRAM 버짓 산출 (최소 4GB ~ 최대 12GB)
      const ceilingMB = Math.min(12288, Math.max(4096, maxBufferMB * 2));

      const rawVendor =
        adapter.info?.description || adapter.info?.vendor || adapter.info?.architecture || '';
      const cleanVendor = rawVendor
        ? rawVendor.replace(/\s+/g, ' ').trim().slice(0, 22)
        : 'WebGPU';

      return {
        available: true,
        vendorLabel: cleanVendor,
        maxBufferMB,
        maxStorageBufferMB,
        ceilingMB,
      };
    } catch {
      return {
        available: true,
        vendorLabel: 'WebGPU',
        maxBufferMB: 2048,
        maxStorageBufferMB: 1024,
        ceilingMB: 4096,
      };
    }
  })();

  return cachedDeviceInfoPromise;
}

function syncPrebuiltVramMetadata(
  modelList?: Array<{ model_id?: string; vram_required_MB?: number }>
): void {
  if (!Array.isArray(modelList)) return;
  for (const item of modelList) {
    if (
      item &&
      typeof item.model_id === 'string' &&
      typeof item.vram_required_MB === 'number' &&
      item.vram_required_MB > 0
    ) {
      prebuiltVramMBMap.set(item.model_id, Math.round(item.vram_required_MB));
    }
  }
}

export async function getCachedWebLlmModelIds(): Promise<Set<string>> {
  const cached = new Set<string>();
  if (typeof window === 'undefined' || !isWebGpuAvailable()) return cached;

  try {
    const webllm = await import('@mlc-ai/web-llm');
    syncPrebuiltVramMetadata(webllm.prebuiltAppConfig?.model_list);

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

export async function unloadWebLlmEngine(): Promise<void> {
  if (!engineInstance) {
    currentLoadedModelId = null;
    updateWebLlmActivity({
      loadedModelId: null,
      loadingModelId: null,
      loadPercent: 0,
      stageText: '',
      isGenerating: false,
    });
    return;
  }

  try {
    await engineInstance.unload();
  } catch {
    // ignore unload race
  } finally {
    currentLoadedModelId = null;
    updateWebLlmActivity({
      loadedModelId: null,
      loadingModelId: null,
      loadPercent: 0,
      stageText: '',
      isGenerating: false,
    });
  }
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
  updateWebLlmActivity({
    loadingModelId: modelId,
    loadPercent: 2,
    stageText: 'Initializing',
  });

  loadingPromise = (async () => {
    try {
      const webllm = await import('@mlc-ai/web-llm');
      syncPrebuiltVramMetadata(webllm.prebuiltAppConfig?.model_list);

      const progressCallback = (report: { progress: number; text: string }) => {
        const pct = Math.min(100, Math.max(0, Math.round((report.progress || 0) * 100)));
        const stageText = report.text || '';
        updateWebLlmActivity({
          loadingModelId: modelId,
          loadPercent: pct,
          stageText,
        });
        onProgress?.({
          modelId,
          percent: pct,
          stageText,
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
      updateWebLlmActivity({
        loadedModelId: modelId,
        loadingModelId: null,
        loadPercent: 100,
        stageText: 'Ready',
      });
      onProgress?.({ modelId, percent: 100, stageText: 'Ready' });
      return engineInstance;
    } catch (err) {
      currentLoadedModelId = null;
      updateWebLlmActivity({
        loadedModelId: null,
        loadingModelId: null,
        loadPercent: 0,
        stageText: '',
      });
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

function parseDecodeTokPerSec(statsText: string): number | null {
  const match = statsText.match(/decode:\s*(\d+(?:\.\d+)?)\s*tok\/s/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return Number.isFinite(val) && val > 0 ? Math.round(val * 10) / 10 : null;
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

  updateWebLlmActivity({ isGenerating: true });

  try {
    const completion = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: COMPACT_LOCAL_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    });

    try {
      const statsText = await engine.runtimeStatsText(modelId);
      const tokPerSec = parseDecodeTokPerSec(statsText);
      if (tokPerSec !== null) {
        updateWebLlmActivity({ lastTokPerSec: tokPerSec });
      }
    } catch {
      // ignore runtime stats error
    }

    const rawOutput = completion.choices?.[0]?.message?.content || '';
    if (!rawOutput.trim()) {
      throw new Error('WebLLM 모델로부터 응답을 생성하지 못했습니다.');
    }

    return normalizeLocalModelOutput(rawOutput, prompt, context);
  } finally {
    updateWebLlmActivity({ isGenerating: false });
  }
}
