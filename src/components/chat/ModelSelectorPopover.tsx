import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Check, RefreshCw, Loader2, Copy } from 'lucide-react';
import { AiModelSelection, AiProviderType } from '../../types';
import { CLOUD_MODEL_OPTIONS } from '../../services/agentApi';
import {
  DEFAULT_OLLAMA_BASE_URL,
  fetchOllamaModels,
  normalizeOllamaBaseUrl,
  OllamaDiagnosticKind,
  OllamaModelInfo,
} from '../../services/ollamaProvider';
import {
  CURATED_WEBLLM_MODELS,
  ensureWebLlmEngine,
  getCachedWebLlmModelIds,
  getLoadedWebLlmModelId,
  isWebGpuAvailable,
  unloadWebLlmEngine,
  WebLlmLoadProgress,
} from '../../services/webllmProvider';
import { useLocalHardwareMetrics } from '../../hooks/useLocalHardwareMetrics';
import {
  LocalResourceInlineIndicator,
  LocalResourceTelemetryPanel,
} from './LocalResourceIndicator';

interface ModelSelectorPopoverProps {
  selection: AiModelSelection;
  onChangeSelection: (next: AiModelSelection) => void;
  disabled?: boolean;
  webllmProgress: WebLlmLoadProgress | null;
  onWebLlmProgress: (progress: WebLlmLoadProgress | null) => void;
  showToast?: (msg: string) => void;
}

export const ModelSelectorPopover: React.FC<ModelSelectorPopoverProps> = ({
  selection,
  onChangeSelection,
  disabled = false,
  webllmProgress,
  onWebLlmProgress,
  showToast,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AiProviderType>(selection.provider);
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);

  const [ollamaUrlInput, setOllamaUrlInput] = useState(
    selection.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL
  );
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [isLoadingOllama, setIsLoadingOllama] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [ollamaDiagnostic, setOllamaDiagnostic] = useState<OllamaDiagnosticKind | null>(null);
  const [ollamaCorsCommand, setOllamaCorsCommand] = useState<string | null>(null);

  const [webGpuSupported] = useState<boolean>(() => isWebGpuAvailable());
  const [cachedWebLlmIds, setCachedWebLlmIds] = useState<Set<string>>(new Set());

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveTab(selection.provider);
  }, [selection.provider]);

  useEffect(() => {
    setHoveredModelId(null);
  }, [activeTab, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  const syncOllamaModels = useCallback(async (targetUrl: string) => {
    setIsLoadingOllama(true);
    setOllamaError(null);
    setOllamaCorsCommand(null);
    const clean = normalizeOllamaBaseUrl(targetUrl);
    setOllamaUrlInput(clean);

    try {
      const res = await fetchOllamaModels(clean);
      setOllamaDiagnostic(res.diagnosticKind ?? null);

      if (!res.ok) {
        setOllamaModels([]);
        setOllamaError(res.error || '로컬 서버가 연결되지 않았습니다');
        setOllamaCorsCommand(res.corsCommand ?? null);
        return;
      }

      setOllamaModels(res.models);
      if (res.models.length === 0) {
        setOllamaError('설치된 로컬 모델이 없습니다 (ollama pull 필요)');
      }
    } catch {
      setOllamaModels([]);
      setOllamaError('로컬 서버 상태를 확인하는 중 오류가 발생했습니다');
    } finally {
      setIsLoadingOllama(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'ollama') {
      void syncOllamaModels(ollamaUrlInput);
    } else if (activeTab === 'webllm' && webGpuSupported) {
      void getCachedWebLlmModelIds().then(setCachedWebLlmIds);
    }
  }, [isOpen, activeTab]);

  const handleCopyCorsCommand = async () => {
    const cmd = ollamaCorsCommand || 'OLLAMA_ORIGINS="*" ollama serve';
    try {
      await navigator.clipboard.writeText(cmd);
      showToast?.('CORS 허용 실행 명령어가 클립보드에 복사되었습니다.');
    } catch {
      showToast?.(`터미널에서 ${cmd} 명령으로 실행해 주세요.`);
    }
  };

  const handleSelectCloudModel = (id: string, label: string) => {
    onChangeSelection({
      provider: 'cloud',
      modelId: id,
      displayName: label,
      ollamaBaseUrl: normalizeOllamaBaseUrl(ollamaUrlInput),
    });
    setIsOpen(false);
  };

  const handleSelectOllamaModel = (modelName: string) => {
    const cleanUrl = normalizeOllamaBaseUrl(ollamaUrlInput);
    onChangeSelection({
      provider: 'ollama',
      modelId: modelName,
      displayName: modelName,
      ollamaBaseUrl: cleanUrl,
    });
    setIsOpen(false);
  };

  const handleSelectWebLlmModel = async (id: string, label: string) => {
    const cleanUrl = normalizeOllamaBaseUrl(ollamaUrlInput);
    onChangeSelection({
      provider: 'webllm',
      modelId: id,
      displayName: label,
      ollamaBaseUrl: cleanUrl,
    });

    if (getLoadedWebLlmModelId() === id) {
      setIsOpen(false);
      return;
    }

    onWebLlmProgress({ modelId: id, percent: 0, stageText: 'Initializing' });
    try {
      await ensureWebLlmEngine(id, (prog) => {
        onWebLlmProgress(prog);
      });
      setCachedWebLlmIds((prev) => new Set([...prev, id]));
      onWebLlmProgress(null);
      showToast?.(`'${label}' 모델 준비가 완료되었습니다.`);
    } catch (err) {
      onWebLlmProgress(null);
      showToast?.(
        err instanceof Error ? err.message : 'WebLLM 모델 적재에 실패했습니다.'
      );
    }
  };

  const handleUnloadWebLlm = async () => {
    await unloadWebLlmEngine();
    showToast?.('WebLLM 모델이 GPU 메모리에서 해제되었습니다.');
  };

  const isLocalSelected =
    selection.provider === 'ollama' || selection.provider === 'webllm';
  const isLocalActiveTab = activeTab === 'ollama' || activeTab === 'webllm';

  // 팝오버가 열려 있을 때는 현재 보고 있는 로컬 탭 기준, 닫혀 있을 때는 선택된 로컬 모델 기준으로 측정
  const effectiveTelemetryProvider: AiProviderType =
    isOpen && isLocalActiveTab ? activeTab : selection.provider;

  const effectiveTelemetryModelId =
    isOpen && isLocalActiveTab && activeTab !== selection.provider
      ? activeTab === 'webllm'
        ? getLoadedWebLlmModelId() || CURATED_WEBLLM_MODELS[0]?.id || ''
        : ollamaModels[0]?.name || ''
      : selection.modelId;

  const shouldEnableTelemetry = isLocalSelected || (isOpen && isLocalActiveTab);

  const telemetry = useLocalHardwareMetrics({
    provider: effectiveTelemetryProvider,
    modelId: effectiveTelemetryModelId,
    ollamaBaseUrl: normalizeOllamaBaseUrl(ollamaUrlInput),
    hoveredModelId,
    webllmProgress,
    enabled: shouldEnableTelemetry,
  });

  const isDownloadingCurrent =
    webllmProgress !== null && webllmProgress.percent < 100;

  return (
    <div className="relative flex items-center min-w-0" ref={containerRef}>
      {/* 평상시 무테(Borderless Ghost) 모델 선택 트리거 */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`h-7 px-2 rounded-lg flex items-center gap-1.5 text-xs transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
          isOpen
            ? 'bg-white/[0.08] text-neutral-100'
            : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.05]'
        }`}
        title="AI 모델 선택"
      >
        {isDownloadingCurrent && (
          <Loader2 className="w-3 h-3 animate-spin text-neutral-300 shrink-0" />
        )}
        <span className="truncate max-w-[112px] sm:max-w-[126px] lg:max-w-[140px] tracking-tight">
          {selection.displayName}
        </span>
        {isDownloadingCurrent && (
          <span className="text-[11px] text-neutral-400 font-mono tabular-nums">
            {webllmProgress.percent}%
          </span>
        )}
        <ChevronDown
          className={`w-3 h-3 text-neutral-500 transition-transform duration-150 shrink-0 ${
            isOpen ? 'rotate-180 text-neutral-200' : ''
          }`}
        />
      </button>

      {/* Ollama · WebLLM 선택 시 모델 선택기 오른쪽 빈 공간에 나타나는 인라인 리소스 인디케이터 */}
      {isLocalSelected && (
        <LocalResourceInlineIndicator
          telemetry={telemetry}
          hidden={isOpen}
          onClick={() => {
            if (disabled) return;
            setActiveTab(selection.provider);
            setIsOpen((prev) => !prev);
          }}
        />
      )}

      {/* 프로스티드 블러 & 투명 그라데이션 경계선 기반 럭셔리 미니멀 팝오버 */}
      {isOpen && (
        <div
          className={`luxury-glass-border absolute bottom-full -left-8 mb-2.5 ${
            isLocalActiveTab
              ? 'w-[min(352px,calc(100vw-2.75rem))] lg:w-[392px]'
              : 'w-64'
          } rounded-xl bg-gradient-to-b from-[#181c27]/78 via-[#11141d]/76 to-[#0c0e15]/84 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.78),0_8px_20px_-4px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)] overflow-hidden z-30`}
        >
          {/* 1. 헤어라인 에디토리얼 탭 바 */}
          <div className="relative px-3.5 pt-2.5 flex items-center justify-between gap-4 after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-gradient-to-r after:from-white/[0.14] after:via-white/[0.07] after:to-white/[0.02]">
            <div className="flex items-center gap-5">
              {(['cloud', 'ollama', 'webllm'] as const).map((tab) => {
                const label =
                  tab === 'cloud' ? 'Cloud' : tab === 'ollama' ? 'Ollama' : 'WebLLM';
                const active = activeTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`relative z-10 pb-2 text-[11px] tracking-tight transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'text-white font-medium after:content-[""] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1.5px] after:bg-white/95 after:rounded-full'
                        : 'text-neutral-400/80 hover:text-neutral-200 font-normal'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {isLocalActiveTab && (
              <span className="pb-2 text-[10px] text-neutral-500 tracking-tight whitespace-nowrap select-none">
                리소스 모니터
              </span>
            )}
          </div>

          {/* 2. 고정 높이 본문 프레임 (좌측 모델 선택 리스트 + 우측 VRAM·CPU 텔레메트리 인스트루먼트) */}
          <div className="h-[172px] p-1.5 flex items-stretch">
            <div className="flex-1 min-w-0 flex flex-col">
              {/* Cloud 탭 */}
              {activeTab === 'cloud' && (
                <div className="space-y-0.5 overflow-y-auto no-scrollbar">
                  {CLOUD_MODEL_OPTIONS.map((item) => {
                    const isSelected =
                      selection.provider === 'cloud' && selection.modelId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectCloudModel(item.id, item.label)}
                        className={`w-full h-[34px] px-2.5 rounded-[7px] text-left flex items-center justify-between gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                          isSelected
                            ? 'bg-white/[0.09] text-white'
                            : 'text-neutral-300/85 hover:bg-white/[0.05] hover:text-white'
                        }`}
                      >
                        <span className="text-xs truncate">{item.label}</span>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-neutral-100 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Ollama 탭 */}
              {activeTab === 'ollama' && (
                <div className="flex-1 flex flex-col min-h-0 gap-1.5 pr-1">
                  <div className="h-8 px-2.5 rounded-[7px] bg-black/25 focus-within:bg-black/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] flex items-center gap-1.5 transition-colors shrink-0">
                    <input
                      type="text"
                      value={ollamaUrlInput}
                      onChange={(e) => setOllamaUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void syncOllamaModels(ollamaUrlInput);
                        }
                      }}
                      placeholder="http://127.0.0.1:11434"
                      aria-label="Ollama 서버 주소"
                      className="flex-1 min-w-0 bg-transparent border-0 no-focus-outline text-[11px] font-mono text-neutral-100 placeholder-neutral-500"
                    />
                    <button
                      type="button"
                      onClick={() => void syncOllamaModels(ollamaUrlInput)}
                      disabled={isLoadingOllama}
                      className="p-1 -mr-1 rounded-md text-neutral-400 hover:text-white transition-colors cursor-pointer shrink-0"
                      title='로컬 모델 새로고침 (5초 타임아웃 · CORS 차단 시 프록시 자동 우회)'
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${isLoadingOllama ? 'animate-spin text-neutral-100' : ''}`}
                      />
                    </button>
                  </div>

                  {ollamaModels.length > 0 ? (
                    <div className="flex-1 overflow-y-auto no-scrollbar space-y-0.5">
                      {ollamaModels.map((m) => {
                        const isSelected =
                          selection.provider === 'ollama' && selection.modelId === m.name;
                        return (
                          <button
                            key={m.name}
                            type="button"
                            onMouseEnter={() => setHoveredModelId(m.name)}
                            onMouseLeave={() => setHoveredModelId(null)}
                            onClick={() => handleSelectOllamaModel(m.name)}
                            className={`w-full h-[34px] px-2.5 rounded-[7px] text-left flex items-center justify-between gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                              isSelected
                                ? 'bg-white/[0.09] text-white'
                                : 'text-neutral-300/85 hover:bg-white/[0.05] hover:text-white'
                            }`}
                          >
                            <span className="text-xs font-mono truncate">{m.name}</span>
                            {isSelected ? (
                              <Check className="w-3.5 h-3.5 text-neutral-100 shrink-0" />
                            ) : m.parameterSize ? (
                              <span className="text-[11px] text-neutral-400/80 font-mono tabular-nums shrink-0">
                                {m.parameterSize}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center px-2 gap-2">
                      <p className="text-[11px] text-neutral-400/85 text-center leading-relaxed">
                        {isLoadingOllama
                          ? '로컬 모델을 확인하고 있습니다...'
                          : ollamaError || '로컬 서버가 연결되지 않았습니다'}
                      </p>

                      {!isLoadingOllama &&
                        (ollamaDiagnostic === 'cors_blocked' || Boolean(ollamaCorsCommand)) && (
                          <button
                            type="button"
                            onClick={() => void handleCopyCorsCommand()}
                            className="h-6 px-2 rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-[10px] font-mono text-neutral-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                            title="클릭하여 터미널 CORS 허용 실행 명령 복사"
                          >
                            <span>OLLAMA_ORIGINS=&quot;*&quot;</span>
                            <Copy className="w-2.5 h-2.5 text-neutral-400 shrink-0" />
                          </button>
                        )}
                    </div>
                  )}
                </div>
              )}

              {/* WebLLM 탭 */}
              {activeTab === 'webllm' && (
                <div className="flex-1 overflow-y-auto no-scrollbar space-y-0.5 pr-1">
                  {!webGpuSupported ? (
                    <div className="h-full flex items-center justify-center px-2">
                      <p className="text-[11px] text-neutral-400/80 text-center">
                        현재 브라우저에서 WebGPU를 지원하지 않습니다
                      </p>
                    </div>
                  ) : (
                    CURATED_WEBLLM_MODELS.map((m) => {
                      const isSelected =
                        selection.provider === 'webllm' && selection.modelId === m.id;
                      const isLoaded = getLoadedWebLlmModelId() === m.id;
                      const isCached = cachedWebLlmIds.has(m.id) || isLoaded;
                      const isThisLoading =
                        webllmProgress !== null && webllmProgress.modelId === m.id;

                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={webllmProgress !== null && !isThisLoading}
                          onMouseEnter={() => setHoveredModelId(m.id)}
                          onMouseLeave={() => setHoveredModelId(null)}
                          onClick={() => void handleSelectWebLlmModel(m.id, m.label)}
                          className={`relative w-full h-[34px] px-2.5 rounded-[7px] text-left flex items-center justify-between gap-2 transition-colors cursor-pointer whitespace-nowrap overflow-hidden disabled:opacity-40 ${
                            isSelected
                              ? 'bg-white/[0.09] text-white'
                              : 'text-neutral-300/85 hover:bg-white/[0.05] hover:text-white'
                          }`}
                        >
                          <span className="text-xs truncate">{m.label}</span>

                          {isThisLoading ? (
                            <span className="text-[11px] font-mono tabular-nums text-neutral-100 shrink-0">
                              {webllmProgress.percent}%
                            </span>
                          ) : isSelected && isLoaded ? (
                            <Check className="w-3.5 h-3.5 text-neutral-100 shrink-0" />
                          ) : isCached ? (
                            <span className="text-[10px] text-neutral-300 shrink-0">
                              준비됨
                            </span>
                          ) : (
                            <span className="text-[11px] text-neutral-400/80 font-mono tabular-nums shrink-0">
                              {m.sizeLabel}
                            </span>
                          )}

                          {isThisLoading && (
                            <progress
                              value={Math.max(3, webllmProgress.percent)}
                              max={100}
                              className="absolute bottom-0 left-2 right-2 w-[calc(100%-1rem)] h-[1.5px] appearance-none bg-transparent overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:bg-white/85 [&::-moz-progress-bar]:bg-white/85"
                            />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Ollama · WebLLM 선택 시 모델 리스트 우측 빈 공간에 렌더링되는 럭셔리 VRAM · CPU 인디케이터 */}
            {isLocalActiveTab && (
              <LocalResourceTelemetryPanel
                telemetry={telemetry}
                onUnloadWebLlm={() => void handleUnloadWebLlm()}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
