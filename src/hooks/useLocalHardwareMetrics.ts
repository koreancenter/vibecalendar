import { useState, useEffect, useRef, useMemo } from 'react';
import { AiProviderType } from '../types';
import {
  fetchOllamaRuntimePs,
  getKnownOllamaModelSizeBytes,
  getOllamaActivityState,
  OllamaActivityState,
  OllamaRuntimePsSnapshot,
  subscribeOllamaActivity,
} from '../services/ollamaProvider';
import {
  getEstimatedWebLlmVramMB,
  getWebLlmActivityState,
  isWebGpuAvailable,
  probeWebGpuDeviceInfo,
  subscribeWebLlmActivity,
  WebGpuDeviceInfo,
  WebLlmActivityState,
  WebLlmLoadProgress,
} from '../services/webllmProvider';

export type TelemetryConnectionState =
  | 'active'
  | 'loading'
  | 'standby'
  | 'offline'
  | 'unsupported';

export type MetricLoadTone = 'nominal' | 'elevated' | 'critical' | 'muted';

export interface HardwareTelemetrySnapshot {
  provider: 'ollama' | 'webllm';
  engineLabel: string;
  stateLabel: string;
  connectionState: TelemetryConnectionState;
  vram: {
    usedMB: number | null;
    ceilingMB: number;
    percent: number;
    previewPercent: number | null;
    displayValue: string;
    compactValue: string;
    subLabel: string;
    tone: MetricLoadTone;
  };
  cpu: {
    percent: number | null;
    displayValue: string;
    subLabel: string;
    history: number[];
    tone: MetricLoadTone;
  };
  canUnloadWebLlm: boolean;
}

interface UseLocalHardwareMetricsParams {
  provider: AiProviderType;
  modelId: string;
  ollamaBaseUrl: string;
  hoveredModelId?: string | null;
  webllmProgress?: WebLlmLoadProgress | null;
  enabled: boolean;
}

const HISTORY_LENGTH = 16;

function formatMemoryFromMB(mb: number): string {
  if (mb <= 0) return '0.0 GB';
  if (mb < 950) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function formatCompactMemoryFromMB(mb: number): string {
  if (mb <= 0) return '0.0G';
  if (mb < 950) return `${Math.round(mb)}M`;
  return `${(mb / 1024).toFixed(1)}G`;
}

function resolveTone(percent: number | null, isMuted = false): MetricLoadTone {
  if (isMuted || percent === null) return 'muted';
  if (percent >= 88) return 'critical';
  if (percent >= 72) return 'elevated';
  return 'nominal';
}

export function useLocalHardwareMetrics({
  provider,
  modelId,
  ollamaBaseUrl,
  hoveredModelId = null,
  webllmProgress = null,
  enabled,
}: UseLocalHardwareMetricsParams): HardwareTelemetrySnapshot {
  const effectiveLocalProvider: 'ollama' | 'webllm' =
    provider === 'ollama' ? 'ollama' : 'webllm';

  const [webGpuInfo, setWebGpuInfo] = useState<WebGpuDeviceInfo>(() => ({
    available: isWebGpuAvailable(),
    vendorLabel: 'WebGPU',
    maxBufferMB: 2048,
    maxStorageBufferMB: 1024,
    ceilingMB: 4096,
  }));

  const [webLlmActivity, setWebLlmActivity] = useState<WebLlmActivityState>(() =>
    getWebLlmActivityState()
  );
  const [ollamaActivity, setOllamaActivity] = useState<OllamaActivityState>(() =>
    getOllamaActivityState()
  );
  const [ollamaPs, setOllamaPs] = useState<OllamaRuntimePsSnapshot | null>(null);

  const [clientCpuPercent, setClientCpuPercent] = useState<number>(4);
  const [cpuHistory, setCpuHistory] = useState<number[]>(() =>
    Array.from({ length: HISTORY_LENGTH }, () => 4)
  );

  const smoothedCpuRef = useRef<number>(4);
  const coresCount =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 8;

  // WebLLM 및 Ollama 실시간 이벤트 구독
  useEffect(() => {
    const unsubWebLlm = subscribeWebLlmActivity(setWebLlmActivity);
    const unsubOllama = subscribeOllamaActivity(setOllamaActivity);
    return () => {
      unsubWebLlm();
      unsubOllama();
    };
  }, []);

  // WebGPU 어댑터 한도 프로빙 (1회 캐시)
  useEffect(() => {
    if (!enabled || effectiveLocalProvider !== 'webllm') return;
    let cancelled = false;
    void probeWebGpuDeviceInfo().then((info) => {
      if (!cancelled) setWebGpuInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, effectiveLocalProvider]);

  // Ollama /api/ps 주기적 폴링 (활성화 시에만 동작)
  useEffect(() => {
    if (!enabled || effectiveLocalProvider !== 'ollama') return;
    let cancelled = false;

    const pollPs = async () => {
      const snap = await fetchOllamaRuntimePs(ollamaBaseUrl);
      if (!cancelled) {
        setOllamaPs(snap);
      }
    };

    void pollPs();
    const intervalMs = ollamaActivity.isGenerating ? 2000 : 4500;
    const id = window.setInterval(() => {
      void pollPs();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, effectiveLocalProvider, ollamaBaseUrl, ollamaActivity.isGenerating, modelId]);

  // 실제 브라우저 이벤트 루프 스케줄링 지연 + 로컬 연산 상태 기반 CPU 부하 측정
  useEffect(() => {
    if (!enabled) return;

    const SAMPLE_MS = 1200;
    let lastTick = performance.now();

    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTick;
      lastTick = now;

      // 타이머 드리프트로 메인 스레드/워커 스케줄링 압력 산출
      const driftMs = Math.max(0, elapsed - SAMPLE_MS);
      const driftRatio = Math.min(1, driftMs / 180);

      let measuredTarget = 3 + Math.round(driftRatio * 48);

      if (effectiveLocalProvider === 'webllm') {
        const activeLoadPct = webllmProgress?.percent ?? webLlmActivity.loadPercent;
        const isCompilingOrLoading =
          Boolean(webllmProgress && webllmProgress.percent < 100) ||
          Boolean(webLlmActivity.loadingModelId);

        if (isCompilingOrLoading) {
          const isShaderStage = /compile|shader|wasm|finish/i.test(
            webllmProgress?.stageText || webLlmActivity.stageText || ''
          );
          measuredTarget = Math.max(
            measuredTarget,
            isShaderStage ? 54 : 32 + Math.round((activeLoadPct % 17) * 0.8)
          );
        } else if (webLlmActivity.isGenerating) {
          measuredTarget = Math.max(measuredTarget, 24 + Math.round(driftRatio * 35));
        }
      } else {
        // Ollama: 로컬 호스트 서버 메트릭이 존재하면 실제 OS CPU 사용률 최우선 반영
        if (ollamaPs?.hostMetrics?.isLocalHostServer) {
          measuredTarget = ollamaPs.hostMetrics.cpuPercent;
        } else if (ollamaPs?.ok) {
          const totalBytes = ollamaPs.totalVramBytes + ollamaPs.totalCpuBytes;
          const cpuOffloadShare =
            totalBytes > 0 ? ollamaPs.totalCpuBytes / totalBytes : 0;

          if (ollamaActivity.isGenerating) {
            measuredTarget = Math.max(
              measuredTarget,
              Math.round(22 + cpuOffloadShare * 58)
            );
          } else if (ollamaPs.models.length > 0) {
            measuredTarget = Math.max(measuredTarget, Math.round(5 + cpuOffloadShare * 10));
          }
        }
      }

      const clamped = Math.max(1, Math.min(99, measuredTarget));
      const smoothed = Math.round(smoothedCpuRef.current * 0.55 + clamped * 0.45);
      smoothedCpuRef.current = smoothed;

      setClientCpuPercent(smoothed);
      setCpuHistory((prev) => [...prev.slice(1), smoothed]);
    }, SAMPLE_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    enabled,
    effectiveLocalProvider,
    webllmProgress,
    webLlmActivity.loadingModelId,
    webLlmActivity.loadPercent,
    webLlmActivity.stageText,
    webLlmActivity.isGenerating,
    ollamaPs,
    ollamaActivity.isGenerating,
  ]);

  return useMemo<HardwareTelemetrySnapshot>(() => {
    if (effectiveLocalProvider === 'webllm') {
      if (!webGpuInfo.available) {
        return {
          provider: 'webllm',
          engineLabel: 'WebGPU',
          stateLabel: '미지원',
          connectionState: 'unsupported',
          vram: {
            usedMB: null,
            ceilingMB: 4096,
            percent: 0,
            previewPercent: null,
            displayValue: '--',
            compactValue: '--',
            subLabel: '브라우저 WebGPU 미지원',
            tone: 'muted',
          },
          cpu: {
            percent: null,
            displayValue: '--',
            subLabel: '실행 불가 환경',
            history: cpuHistory,
            tone: 'muted',
          },
          canUnloadWebLlm: false,
        };
      }

      const ceilingMB = webGpuInfo.ceilingMB;
      const activeLoadingModelId =
        webllmProgress && webllmProgress.percent < 100
          ? webllmProgress.modelId
          : webLlmActivity.loadingModelId;
      const activeLoadingPct =
        webllmProgress && webllmProgress.percent < 100
          ? webllmProgress.percent
          : webLlmActivity.loadPercent;

      if (activeLoadingModelId) {
        const targetMB = getEstimatedWebLlmVramMB(activeLoadingModelId);
        const currentMB = Math.max(
          64,
          Math.round((Math.max(4, activeLoadingPct) / 100) * targetMB)
        );
        const pct = Math.min(98, Math.round((currentMB / ceilingMB) * 100));
        const previewPct = Math.min(98, Math.round((targetMB / ceilingMB) * 100));

        return {
          provider: 'webllm',
          engineLabel: 'WebGPU',
          stateLabel: `적재 ${activeLoadingPct}%`,
          connectionState: 'loading',
          vram: {
            usedMB: currentMB,
            ceilingMB,
            percent: pct,
            previewPercent: previewPct,
            displayValue: formatMemoryFromMB(currentMB),
            compactValue: formatCompactMemoryFromMB(currentMB),
            subLabel: `목표 약 ${formatMemoryFromMB(targetMB)}`,
            tone: resolveTone(pct),
          },
          cpu: {
            percent: clientCpuPercent,
            displayValue: `${clientCpuPercent}%`,
            subLabel: '가중치·셰이더 적재 중',
            history: cpuHistory,
            tone: resolveTone(clientCpuPercent),
          },
          canUnloadWebLlm: false,
        };
      }

      if (webLlmActivity.loadedModelId) {
        const baseMB = getEstimatedWebLlmVramMB(webLlmActivity.loadedModelId);
        const kvOverheadMB = webLlmActivity.isGenerating ? 145 : 65;
        const usedMB = baseMB + kvOverheadMB;
        const pct = Math.min(98, Math.round((usedMB / ceilingMB) * 100));

        const hoveredDiffModel =
          hoveredModelId && hoveredModelId !== webLlmActivity.loadedModelId
            ? hoveredModelId
            : null;
        const previewMB = hoveredDiffModel ? getEstimatedWebLlmVramMB(hoveredDiffModel) : null;
        const previewPct = previewMB
          ? Math.min(98, Math.round((previewMB / ceilingMB) * 100))
          : null;

        const vramSubLabel = previewMB
          ? `선택 시 약 ${formatMemoryFromMB(previewMB)}`
          : webLlmActivity.lastTokPerSec
          ? `상주 · ${webLlmActivity.lastTokPerSec} tok/s`
          : 'GPU 버퍼 상주 중';

        const cpuSubLabel = webLlmActivity.isGenerating
          ? `${coresCount}코어 · 추론 연산 중`
          : `${coresCount}코어 스레드 · 안정`;

        return {
          provider: 'webllm',
          engineLabel: 'WebGPU',
          stateLabel: webLlmActivity.isGenerating ? '추론 중' : '상주 중',
          connectionState: 'active',
          vram: {
            usedMB,
            ceilingMB,
            percent: pct,
            previewPercent: previewPct,
            displayValue: formatMemoryFromMB(usedMB),
            compactValue: formatCompactMemoryFromMB(usedMB),
            subLabel: vramSubLabel,
            tone: resolveTone(pct),
          },
          cpu: {
            percent: clientCpuPercent,
            displayValue: `${clientCpuPercent}%`,
            subLabel: cpuSubLabel,
            history: cpuHistory,
            tone: resolveTone(clientCpuPercent),
          },
          canUnloadWebLlm: !webLlmActivity.isGenerating,
        };
      }

      // 아직 적재된 모델이 없는 대기 상태
      const focusModelId = hoveredModelId || modelId;
      const estimatedMB = getEstimatedWebLlmVramMB(focusModelId);
      const previewPct =
        estimatedMB > 0 ? Math.min(96, Math.round((estimatedMB / ceilingMB) * 100)) : null;

      return {
        provider: 'webllm',
        engineLabel: 'WebGPU',
        stateLabel: '대기',
        connectionState: 'standby',
        vram: {
          usedMB: 0,
          ceilingMB,
          percent: 0,
          previewPercent: previewPct,
          displayValue: '0.0 GB',
          compactValue: '0.0G',
          subLabel:
            estimatedMB > 0
              ? `필요 약 ${formatMemoryFromMB(estimatedMB)}`
              : '모델 선택 시 적재',
          tone: 'nominal',
        },
        cpu: {
          percent: clientCpuPercent,
          displayValue: `${clientCpuPercent}%`,
          subLabel: `${coresCount}코어 스레드 · 유휴`,
          history: cpuHistory,
          tone: resolveTone(clientCpuPercent),
        },
        canUnloadWebLlm: false,
      };
    }

    // Ollama 텔레메트리 계산
    const focusOllamaModel = hoveredModelId || modelId;
    const estBytes = getKnownOllamaModelSizeBytes(focusOllamaModel);
    const estMB = estBytes ? Math.round(estBytes / (1024 * 1024)) : null;

    if (!ollamaPs || !ollamaPs.ok) {
      return {
        provider: 'ollama',
        engineLabel: 'Ollama',
        stateLabel: '미연결',
        connectionState: 'offline',
        vram: {
          usedMB: null,
          ceilingMB: 8192,
          percent: 0,
          previewPercent: estMB ? Math.min(95, Math.round((estMB / 8192) * 100)) : null,
          displayValue: '--',
          compactValue: '--',
          subLabel: estMB
            ? `예상 약 ${formatMemoryFromMB(estMB)}`
            : '로컬 서버 연결 대기',
          tone: 'muted',
        },
        cpu: {
          percent: null,
          displayValue: '--',
          subLabel: '로컬 데몬 오프라인',
          history: cpuHistory,
          tone: 'muted',
        },
        canUnloadWebLlm: false,
      };
    }

    const effectiveCores = ollamaPs.hostMetrics?.isLocalHostServer
      ? ollamaPs.hostMetrics.cores
      : coresCount;

    if (ollamaPs.models.length > 0) {
      const usedVramMB = Math.round(ollamaPs.totalVramBytes / (1024 * 1024));
      const usedCpuMB = Math.round(ollamaPs.totalCpuBytes / (1024 * 1024));
      const totalResidentMB = Math.max(1, usedVramMB + usedCpuMB);
      const gpuSharePct = Math.round((usedVramMB / totalResidentMB) * 100);

      const ceilingMB = Math.max(
        8192,
        Math.ceil(Math.max(usedVramMB, totalResidentMB) / 4096) * 4096
      );
      const pct = Math.min(98, Math.round((usedVramMB / ceilingMB) * 100));

      const hoveredDiff =
        hoveredModelId && !ollamaPs.models.some((m) => m.name === hoveredModelId)
          ? getKnownOllamaModelSizeBytes(hoveredModelId)
          : null;
      const previewPct = hoveredDiff
        ? Math.min(96, Math.round((hoveredDiff / (1024 * 1024) / ceilingMB) * 100))
        : null;

      const vramSubLabel = hoveredDiff
        ? `선택 시 약 ${formatMemoryFromMB(Math.round(hoveredDiff / (1024 * 1024)))}`
        : gpuSharePct >= 99
        ? 'GPU 100% 할당'
        : gpuSharePct === 0
        ? `CPU 메모리 ${formatMemoryFromMB(usedCpuMB)}`
        : `GPU ${gpuSharePct}% · CPU ${100 - gpuSharePct}%`;

      const cpuSubLabel = ollamaActivity.isGenerating
        ? `${effectiveCores}코어 · 추론 연산 중`
        : ollamaPs.viaProxy
        ? `${effectiveCores}코어 · 프록시 연결`
        : `${effectiveCores}코어 · 데몬 활성`;

      return {
        provider: 'ollama',
        engineLabel: 'Ollama',
        stateLabel: ollamaActivity.isGenerating
          ? '추론 중'
          : ollamaPs.viaProxy
          ? '프록시'
          : '상주 중',
        connectionState: 'active',
        vram: {
          usedMB: usedVramMB,
          ceilingMB,
          percent: pct,
          previewPercent: previewPct,
          displayValue: formatMemoryFromMB(usedVramMB),
          compactValue: formatCompactMemoryFromMB(usedVramMB),
          subLabel: vramSubLabel,
          tone: resolveTone(pct),
        },
        cpu: {
          percent: clientCpuPercent,
          displayValue: `${clientCpuPercent}%`,
          subLabel: cpuSubLabel,
          history: cpuHistory,
          tone: resolveTone(clientCpuPercent),
        },
        canUnloadWebLlm: false,
      };
    }

    // Ollama 서버는 연결되었으나 현재 메모리에 적재된 모델이 없는 유휴 상태
    const previewPct = estMB ? Math.min(95, Math.round((estMB / 8192) * 100)) : null;

    return {
      provider: 'ollama',
      engineLabel: 'Ollama',
      stateLabel: ollamaActivity.isGenerating
        ? '적재 중'
        : ollamaPs.viaProxy
        ? '프록시'
        : '유휴',
      connectionState: ollamaActivity.isGenerating ? 'loading' : 'standby',
      vram: {
        usedMB: 0,
        ceilingMB: 8192,
        percent: 0,
        previewPercent: previewPct,
        displayValue: '0.0 GB',
        compactValue: '0.0G',
        subLabel: estMB
          ? `적재 시 약 ${formatMemoryFromMB(estMB)}`
          : '첫 요청 시 GPU 적재',
        tone: 'nominal',
      },
      cpu: {
        percent: clientCpuPercent,
        displayValue: `${clientCpuPercent}%`,
        subLabel: ollamaPs.viaProxy
          ? `${effectiveCores}코어 · 프록시 대기`
          : `${effectiveCores}코어 · 유휴 대기`,
        history: cpuHistory,
        tone: resolveTone(clientCpuPercent),
      },
      canUnloadWebLlm: false,
    };
  }, [
    effectiveLocalProvider,
    webGpuInfo,
    webllmProgress,
    webLlmActivity,
    hoveredModelId,
    modelId,
    clientCpuPercent,
    cpuHistory,
    coresCount,
    ollamaPs,
    ollamaActivity.isGenerating,
  ]);
}
