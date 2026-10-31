import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface PWAInstallButtonProps {
  variant?: 'toolbar' | 'menu';
  onInstalled?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'toolbar',
  onInstalled,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled || (!isInstallable && !isIOS)) {
    return null;
  }

  const handleTrigger = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) {
        onInstalled?.();
      }
      return;
    }
    if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  return (
    <>
      {variant === 'menu' ? (
        <button
          type="button"
          onClick={handleTrigger}
          className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-md text-xs text-neutral-200 hover:bg-white/[0.06] transition-colors whitespace-nowrap"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Download className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="truncate">현장 오프라인 앱 설치</span>
          </span>
          <span className="text-[11px] text-neutral-500 font-mono shrink-0">PWA</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleTrigger}
          title="홈 화면 또는 데스크톱 앱으로 설치하여 오프라인에서도 런시트를 열람합니다"
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] text-[11px] font-medium text-neutral-200 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>앱 설치</span>
        </button>
      )}

      {showIOSGuide && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
          onClick={() => setShowIOSGuide(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-white/[0.1] bg-[#12141c] p-5 text-neutral-100 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-sky-400 shrink-0" />
                <h3 className="text-sm font-semibold text-neutral-100">
                  iPhone · iPad 홈 화면에 설치
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                aria-label="설치 안내 닫기"
                className="p-1 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.06] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="mt-3.5 space-y-2 text-xs text-neutral-300 leading-relaxed list-decimal list-inside">
              <li>Safari 하단 또는 상단 도구 모음에서 공유 버튼을 탭합니다.</li>
              <li>메뉴를 내려 홈 화면에 추가를 선택합니다.</li>
              <li>오른쪽 상단 추가를 탭하면 현장 오프라인 모드에서도 바로 실행됩니다.</li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="mt-4 w-full py-2 px-4 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-xs font-medium text-neutral-100 transition-colors whitespace-nowrap"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineStatusBanner: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-[95] flex items-center gap-2 rounded-lg border border-amber-400/30 bg-[#12141c]/95 px-3 py-2 text-xs text-amber-200 shadow-lg backdrop-blur-xs"
    >
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span className="whitespace-nowrap">
        오프라인 현장 모드 · 로컬 금고 및 캐시 데이터로 동작 중
      </span>
    </div>
  );
};
