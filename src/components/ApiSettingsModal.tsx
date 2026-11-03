import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2, Trash2, X } from 'lucide-react';
import { CloudModelOption, verifyCloudApiKey } from '../services/agentApi';
import {
  clearSavedCloudApiKey,
  ensureCloudKeyHydrated,
  getCachedCloudApiKey,
  saveVerifiedCloudApiKey,
} from '../utils/cloudApiKeyStorage';

export type ApiConnectivityState = 'idle' | 'testing' | 'connected' | 'error';

interface ApiSettingsModalProps {
  isOpen: boolean;
  alertMessage?: string | null;
  onClose: () => void;
  showToast?: (msg: string) => void;
}

const CONNECTIVITY_CHIP_META: Record<
  ApiConnectivityState,
  {
    label: 'Idle' | 'Testing' | 'Connected' | 'Error';
    chipClass: string;
    dotClass: string;
  }
> = {
  idle: {
    label: 'Idle',
    chipClass: 'bg-white/[0.04] border-white/[0.09] text-neutral-300',
    dotClass: 'bg-neutral-500',
  },
  testing: {
    label: 'Testing',
    chipClass: 'bg-amber-500/[0.11] border-amber-400/25 text-amber-200',
    dotClass: 'bg-amber-400 animate-pulse',
  },
  connected: {
    label: 'Connected',
    chipClass: 'bg-emerald-500/[0.11] border-emerald-400/25 text-emerald-200',
    dotClass: 'bg-emerald-400',
  },
  error: {
    label: 'Error',
    chipClass: 'bg-rose-500/[0.11] border-rose-400/25 text-rose-200',
    dotClass: 'bg-rose-400',
  },
};

export const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({
  isOpen,
  alertMessage = null,
  onClose,
  showToast,
}) => {
  const [keyInput, setKeyInput] = useState('');
  const [showPlainKey, setShowPlainKey] = useState(false);
  const [storedKey, setStoredKey] = useState('');
  const [testedKey, setTestedKey] = useState('');
  const [testedModels, setTestedModels] = useState<CloudModelOption[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [connectivityState, setConnectivityState] = useState<ApiConnectivityState>('idle');
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    setShowPlainKey(false);
    setIsTesting(false);
    setIsSaving(false);
    setPingMs(null);
    setLiveElapsedMs(0);
    setErrorBanner(alertMessage || null);
    setConnectivityState(alertMessage ? 'error' : 'idle');

    let mounted = true;
    void ensureCloudKeyHydrated().then(({ apiKey, models }) => {
      if (!mounted) return;
      if (alertMessage) {
        // 401 만료·권한 오류로 열린 경우 즉시 새 키를 입력할 수 있도록 입력란 초기화
        setStoredKey('');
        setKeyInput('');
        setTestedKey('');
        setTestedModels([]);
        setConnectivityState('error');
      } else {
        setStoredKey(apiKey);
        setKeyInput(apiKey);
        setTestedKey(apiKey);
        setTestedModels(models);
        setConnectivityState(apiKey && models.length > 0 ? 'connected' : 'idle');
      }
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 40);
    });

    return () => {
      mounted = false;
    };
  }, [isOpen, alertMessage]);

  useEffect(() => {
    if (!isOpen || connectivityState !== 'testing') return;

    const startedAt = performance.now();
    setLiveElapsedMs(1);

    const timerId = window.setInterval(() => {
      setLiveElapsedMs(Math.max(1, Math.round(performance.now() - startedAt)));
    }, 35);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isOpen, connectivityState]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const trimmedInput = keyInput.trim();
  const isVerifiedMatch =
    Boolean(trimmedInput) && trimmedInput === testedKey && testedModels.length > 0;
  const hasSavedStoredKey = Boolean(storedKey || getCachedCloudApiKey());

  const handleTestConnectivity = async () => {
    if (!trimmedInput || isTesting || isSaving) {
      if (!trimmedInput) {
        setConnectivityState('error');
        setPingMs(null);
        setErrorBanner('Gemini API Key를 입력해 주세요.');
      }
      return;
    }

    setIsTesting(true);
    setConnectivityState('testing');
    setPingMs(null);
    setErrorBanner(null);

    try {
      const res = await verifyCloudApiKey(trimmedInput);
      const measuredMs = typeof res.latencyMs === 'number' ? res.latencyMs : null;

      if (!res.ok || res.models.length === 0) {
        setTestedKey('');
        setTestedModels([]);
        setConnectivityState('error');
        setPingMs(measuredMs);
        setErrorBanner(res.error || '유효하지 않은 API Key입니다.');
        return;
      }

      setTestedKey(trimmedInput);
      setTestedModels(res.models);
      setConnectivityState('connected');
      setPingMs(measuredMs);
      setErrorBanner(null);
    } catch {
      setTestedKey('');
      setTestedModels([]);
      setConnectivityState('error');
      setPingMs(null);
      setErrorBanner('API Key 연결 검증에 실패했습니다.');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveVerifiedKey = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!trimmedInput || isTesting || isSaving) {
      if (!trimmedInput) {
        setConnectivityState('error');
        setPingMs(null);
        setErrorBanner('Gemini API Key를 입력해 주세요.');
        inputRef.current?.focus();
      }
      return;
    }

    setIsSaving(true);
    setErrorBanner(null);

    try {
      let modelsToPersist = isVerifiedMatch ? testedModels : [];
      if (!isVerifiedMatch) {
        setConnectivityState('testing');
        setPingMs(null);

        const res = await verifyCloudApiKey(trimmedInput);
        const measuredMs = typeof res.latencyMs === 'number' ? res.latencyMs : null;

        if (!res.ok || res.models.length === 0) {
          setTestedKey('');
          setTestedModels([]);
          setConnectivityState('error');
          setPingMs(measuredMs);
          setErrorBanner(res.error || '유효하지 않은 API Key입니다.');
          return;
        }
        modelsToPersist = res.models;
        setTestedKey(trimmedInput);
        setTestedModels(res.models);
        setConnectivityState('connected');
        setPingMs(measuredMs);
      }

      await saveVerifiedCloudApiKey(trimmedInput, modelsToPersist);
      setStoredKey(trimmedInput);
      showToast?.('Gemini API Key 연결이 검증되어 안전하게 암호화 저장되었습니다.');
      onClose();
    } catch {
      setConnectivityState('error');
      setErrorBanner('API Key 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSavedKey = async () => {
    await clearSavedCloudApiKey();
    setStoredKey('');
    setKeyInput('');
    setTestedKey('');
    setTestedModels([]);
    setConnectivityState('idle');
    setPingMs(null);
    setErrorBanner(null);
    showToast?.('저장된 Cloud API Key가 삭제되었습니다.');
    inputRef.current?.focus();
  };

  const chipMeta = CONNECTIVITY_CHIP_META[connectivityState];

  const statusDetailText = (() => {
    if (connectivityState === 'testing') {
      return '실시간 연결 확인 중...';
    }
    if (connectivityState === 'connected') {
      return testedModels.length > 0 ? `사용 가능 모델 ${testedModels.length}개` : '연결 확인됨';
    }
    if (connectivityState === 'error') {
      return alertMessage && errorBanner === alertMessage
        ? '인증 만료 · 재입력 필요'
        : '연결 확인 실패';
    }
    return trimmedInput ? '연결 검증 대기' : 'API Key 입력 대기';
  })();

  const pingDisplayText = (() => {
    if (connectivityState === 'testing') {
      return `${liveElapsedMs} ms`;
    }
    if (pingMs !== null) {
      return `${pingMs} ms`;
    }
    return '-- ms';
  })();

  const pingToneClass = (() => {
    if (connectivityState === 'testing') {
      return 'text-amber-200';
    }
    if (connectivityState === 'connected' && pingMs !== null) {
      return pingMs < 800 ? 'text-emerald-300' : 'text-amber-200';
    }
    if (connectivityState === 'error' && pingMs !== null) {
      return 'text-rose-300';
    }
    return 'text-neutral-500';
  })();

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-settings-modal-title"
    >
      <form
        onSubmit={(e) => void handleSaveVerifiedKey(e)}
        className="luxury-glass-border w-full max-w-[400px] rounded-2xl bg-gradient-to-b from-[#181c27]/88 via-[#11141d]/88 to-[#0c0e15]/92 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.78),0_8px_20px_-4px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)] overflow-hidden select-none"
      >
        {/* 상단 헤더 */}
        <div className="px-5 pt-4 pb-3.5 border-b border-white/[0.06] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <KeyRound className="w-4 h-4 text-neutral-300 shrink-0" strokeWidth={1.75} />
            <h2
              id="api-settings-modal-title"
              className="text-sm font-semibold text-white tracking-tight truncate"
            >
              API 설정
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 space-y-3.5">
          {errorBanner && (
            <div
              role="alert"
              className="px-3.5 py-2.5 rounded-xl bg-rose-500/[0.09] border border-rose-500/25 flex items-start gap-2.5 text-xs text-rose-200 leading-relaxed select-text"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorBanner}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="cloud-gemini-api-key-input"
                className="text-xs font-medium text-neutral-300"
              >
                Gemini API Key
              </label>

              {hasSavedStoredKey && (
                <button
                  type="button"
                  onClick={() => void handleDeleteSavedKey()}
                  className="text-[11px] text-neutral-400 hover:text-rose-300 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>저장된 키 삭제</span>
                </button>
              )}
            </div>

            <div className="h-10 px-3 rounded-xl bg-black/30 focus-within:bg-black/45 border border-white/[0.08] focus-within:border-white/[0.2] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] flex items-center gap-1.5 transition-colors">
              <input
                ref={inputRef}
                id="cloud-gemini-api-key-input"
                type={showPlainKey ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => {
                  const val = e.target.value;
                  const nextTrimmed = val.trim();
                  setKeyInput(val);

                  if (errorBanner && !alertMessage) {
                    setErrorBanner(null);
                  }
                  if (nextTrimmed && alertMessage && errorBanner === alertMessage) {
                    setErrorBanner(null);
                  }

                  if (Boolean(nextTrimmed) && nextTrimmed === testedKey && testedModels.length > 0) {
                    setConnectivityState('connected');
                  } else {
                    setConnectivityState('idle');
                    setPingMs(null);
                  }
                }}
                placeholder="Gemini API Key 입력"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 min-w-0 bg-transparent border-0 no-focus-outline text-xs font-mono text-neutral-100 placeholder-neutral-500"
              />

              {keyInput.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setKeyInput('');
                    setTestedKey('');
                    setTestedModels([]);
                    setConnectivityState('idle');
                    setPingMs(null);
                    setErrorBanner(null);
                    inputRef.current?.focus();
                  }}
                  className="p-1 rounded-md text-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer shrink-0"
                  title="입력 지우기"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowPlainKey((prev) => !prev)}
                className="p-1 -mr-1 rounded-md text-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer shrink-0"
                title={showPlainKey ? '키 숨기기' : '키 표시'}
              >
                {showPlainKey ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* 실시간 연결 상태 및 Ping 지연시간 인디케이터 */}
          <div
            id="connectivity-status"
            data-testid="connectivity-status"
            data-status={connectivityState}
            role="status"
            aria-live="polite"
            className="pt-0.5 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium tracking-tight shrink-0 transition-colors ${chipMeta.chipClass}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${chipMeta.dotClass}`} />
                <span>{chipMeta.label}</span>
              </span>
              <span className="text-[11px] text-neutral-400 truncate">{statusDetailText}</span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums text-[11px]">
              <span className="text-neutral-500">ping</span>
              <span className={pingToneClass}>{pingDisplayText}</span>
            </div>
          </div>

          <div className="pt-2.5 border-t border-white/[0.05] flex items-center justify-between gap-2 text-[11px] text-neutral-400">
            <span className="truncate">
              {isVerifiedMatch && storedKey === trimmedInput
                ? '브라우저 로컬 스토리지에 암호화 저장됨'
                : '검증을 통과한 키만 기기에 암호화 저장됩니다'}
            </span>
            <span className="text-[10.5px] text-neutral-500 font-mono shrink-0">AES-256-GCM</span>
          </div>
        </div>

        {/* 하단 액션 바 */}
        <div className="px-5 py-3.5 border-t border-white/[0.06] bg-black/20 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void handleTestConnectivity()}
            disabled={!trimmedInput || isTesting || isSaving}
            className="h-8 px-3.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.13] disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-neutral-200 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            {isTesting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-300" />
                <span>검증 중...</span>
              </>
            ) : (
              <span>연결 검증</span>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.05] transition-colors cursor-pointer whitespace-nowrap"
            >
              취소
            </button>

            <button
              type="submit"
              disabled={!trimmedInput || isTesting || isSaving}
              className="h-8 px-4 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 disabled:bg-white/[0.08] disabled:text-neutral-500 disabled:cursor-not-allowed text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-600" />
                  <span>저장 중...</span>
                </>
              ) : (
                <span>저장</span>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
