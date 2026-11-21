import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronUp,
  Copy,
  Delete,
  Fingerprint,
  Loader2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import {
  PinLengthOption,
  VaultInvalidPinError,
} from '../../utils/vaultCrypto';
import { BiometricUserCancelledError } from '../../utils/webauthnBiometrics';
import { CREATOR_ENTITY } from '../../constants/legal';
import type { LegalDrawerTab } from './LegalAndColophonDrawer';

const LegalAndColophonDrawer = React.lazy(() =>
  import('./LegalAndColophonDrawer').then((m) => ({ default: m.LegalAndColophonDrawer }))
);

interface VaultIntroGateProps {
  mode: 'onboarding' | 'locked';
  vaultPinLength: PinLengthOption;
  isBiometricEnabled?: boolean;
  initialHasConsented: boolean;
  onCreateVault: (pin: string, pinLength: PinLengthOption) => Promise<void>;
  onUnlockVault: (pin: string) => Promise<void>;
  onUnlockVaultWithBiometrics?: () => Promise<void>;
  onEnterBrowseWithoutLock: () => void;
  onFactoryResetVault: () => void;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

interface FooterDirectoryItem {
  label: string;
  href: string;
}

const GOGUMA_UNIVERSE_LINKS: FooterDirectoryItem[] = [
  { label: 'AI 앱 기획', href: 'https://goguma.app' },
  { label: '디지털 명함', href: 'https://eerum.goguma.app' },
  { label: 'AI 슬라이드', href: 'https://vibeslide.goguma.app' },
  { label: 'AI 자산관리', href: 'https://vibevault.goguma.app' },
];

const RELATED_SITE_LINKS: FooterDirectoryItem[] = [
  { label: 'K-Design.md', href: 'https://kdesign.koreancenter.net' },
  { label: 'AI Podium', href: 'https://aipodium.net' },
  { label: 'Net-to-Dot', href: 'https://nettodot.org' },
  { label: '한국센터글로벌네트워크', href: 'https://koreancenter.net' },
  { label: 'Global K-Edu Community', href: 'https://kedu.koreancenter.net' },
  { label: '인도네시아센터', href: 'https://indonesiacenter.net' },
  { label: '인도네시아 창업지원센터', href: 'https://visas.indonesiacenter.net' },
  { label: '인도네시아 언어 연수', href: 'https://bipa.indonesiacenter.net' },
  { label: '인도네시아 기업 연수', href: 'https://retreat.indonesiacenter.net' },
];

export const VaultIntroGate: React.FC<VaultIntroGateProps> = ({
  mode,
  vaultPinLength,
  isBiometricEnabled = false,
  initialHasConsented,
  onCreateVault,
  onUnlockVault,
  onUnlockVaultWithBiometrics,
  onEnterBrowseWithoutLock,
  onFactoryResetVault,
}) => {
  const [pinLength, setPinLength] = useState<PinLengthOption>(
    mode === 'locked' ? vaultPinLength : 4
  );
  const [setupStep, setSetupStep] = useState<'enter' | 'confirm' | 'awaiting_consent'>('enter');
  const [firstPin, setFirstPin] = useState<string>('');
  const [stagedConfirmedPin, setStagedConfirmedPin] = useState<string>('');
  const [digits, setDigits] = useState<string>('');

  const [hasConsented, setHasConsented] = useState<boolean>(initialHasConsented);
  const [consentHighlight, setConsentHighlight] = useState<boolean>(false);

  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [isBioVerifying, setIsBioVerifying] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isErrorShake, setIsErrorShake] = useState<boolean>(false);

  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [lockoutRemaining, setLockoutRemaining] = useState<number>(0);

  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState<boolean>(false);
  const [drawerState, setDrawerState] = useState<{
    isOpen: boolean;
    tab: LegalDrawerTab;
  }>({
    isOpen: false,
    tab: 'disclaimer',
  });

  const [copiedCreatorEmail, setCopiedCreatorEmail] = useState<boolean>(false);
  const [inlineToast, setInlineToast] = useState<string | null>(null);
  const [openSiteMenu, setOpenSiteMenu] = useState<'universe' | 'related' | null>(null);

  const consentCheckboxRef = useRef<HTMLInputElement>(null);
  const siteMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode === 'locked') {
      setPinLength(vaultPinLength);
      setSetupStep('enter');
      setFirstPin('');
      setStagedConfirmedPin('');
      setDigits('');
      setStatusMessage(null);
    } else {
      setSetupStep('enter');
      setFirstPin('');
      setStagedConfirmedPin('');
      setDigits('');
      setStatusMessage(null);
    }
  }, [mode, vaultPinLength]);

  useEffect(() => {
    if (lockoutRemaining <= 0) return;
    const timer = setInterval(() => {
      setLockoutRemaining((prev) => {
        if (prev <= 1) {
          setStatusMessage(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutRemaining]);

  const showGateToast = useCallback((msg: string) => {
    setInlineToast(msg);
    setTimeout(() => {
      setInlineToast((current) => (current === msg ? null : current));
    }, 2600);
  }, []);

  useEffect(() => {
    if (!openSiteMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (siteMenuRef.current && !siteMenuRef.current.contains(e.target as Node)) {
        setOpenSiteMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpenSiteMenu(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openSiteMenu]);

  const triggerShake = useCallback((message: string) => {
    setStatusMessage(message);
    setIsErrorShake(false);
    requestAnimationFrame(() => {
      setIsErrorShake(true);
      setTimeout(() => setIsErrorShake(false), 240);
    });
  }, []);

  const openLegalDrawer = useCallback((tab: LegalDrawerTab) => {
    setDrawerState({ isOpen: true, tab });
  }, []);

  const handleCopyCreatorEmail = async () => {
    try {
      await navigator.clipboard.writeText(CREATOR_ENTITY.email);
      setCopiedCreatorEmail(true);
      showGateToast(`문의 이메일(${CREATOR_ENTITY.email})이 복사되었습니다.`);
      setTimeout(() => setCopiedCreatorEmail(false), 2000);
    } catch {
      showGateToast(`문의 이메일: ${CREATOR_ENTITY.email}`);
    }
  };

  const resetSetupFlow = useCallback((nextLength?: PinLengthOption) => {
    if (nextLength) setPinLength(nextLength);
    setSetupStep('enter');
    setFirstPin('');
    setStagedConfirmedPin('');
    setDigits('');
    setStatusMessage(null);
  }, []);

  const executeOnboardingCreation = useCallback(
    async (confirmedPin: string, length: PinLengthOption) => {
      setIsBusy(true);
      setStatusMessage('AES-256-GCM 암호화 키를 생성하고 있습니다...');
      try {
        await onCreateVault(confirmedPin, length);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : '볼트 암호화 생성 중 오류가 발생했습니다.';
        triggerShake(msg);
        setSetupStep('enter');
        setFirstPin('');
        setStagedConfirmedPin('');
        setDigits('');
      } finally {
        setIsBusy(false);
      }
    },
    [onCreateVault, triggerShake]
  );

  const executeVaultUnlock = useCallback(
    async (enteredPin: string) => {
      if (!hasConsented) {
        setStagedConfirmedPin(enteredPin);
        setConsentHighlight(true);
        setStatusMessage('잠금 해제 전 아래 AI API 보안·과금 면책 조항에 동의해 주세요.');
        consentCheckboxRef.current?.focus();
        return;
      }

      setIsBusy(true);
      setStatusMessage(null);
      try {
        await onUnlockVault(enteredPin);
      } catch (err) {
        setDigits('');
        setStagedConfirmedPin('');
        if (err instanceof VaultInvalidPinError) {
          const nextFails = failedAttempts + 1;
          if (nextFails >= MAX_FAILED_ATTEMPTS) {
            setFailedAttempts(0);
            setLockoutRemaining(LOCKOUT_SECONDS);
            triggerShake(
              `PIN 5회 불일치로 ${LOCKOUT_SECONDS}초간 입력이 일시 제한됩니다.`
            );
          } else {
            setFailedAttempts(nextFails);
            triggerShake(
              `PIN이 일치하지 않습니다. (${nextFails}/${MAX_FAILED_ATTEMPTS})`
            );
          }
        } else {
          const msg =
            err instanceof Error ? err.message : '볼트 복호화 중 오류가 발생했습니다.';
          triggerShake(msg);
        }
      } finally {
        setIsBusy(false);
      }
    },
    [failedAttempts, hasConsented, onUnlockVault, triggerShake]
  );

  const handleBiometricUnlock = useCallback(async () => {
    if (
      mode !== 'locked' ||
      !isBiometricEnabled ||
      !onUnlockVaultWithBiometrics ||
      isBusy ||
      isBioVerifying ||
      lockoutRemaining > 0
    ) {
      return;
    }

    if (!hasConsented) {
      setConsentHighlight(true);
      setStatusMessage('잠금 해제 전 아래 AI API 보안·과금 면책 조항에 동의해 주세요.');
      consentCheckboxRef.current?.focus();
      return;
    }

    setIsBioVerifying(true);
    setStatusMessage('기기 생체 인증을 확인하고 있습니다...');
    try {
      await onUnlockVaultWithBiometrics();
    } catch (err) {
      if (err instanceof BiometricUserCancelledError) {
        setStatusMessage('생체 인증이 취소되었습니다. PIN을 입력하거나 다시 시도해 주세요.');
      } else {
        const msg =
          err instanceof Error
            ? err.message
            : '생체 인증 확인 중 오류가 발생했습니다. PIN을 입력해 주세요.';
        triggerShake(msg);
      }
    } finally {
      setIsBioVerifying(false);
    }
  }, [
    hasConsented,
    isBioVerifying,
    isBiometricEnabled,
    isBusy,
    lockoutRemaining,
    mode,
    onUnlockVaultWithBiometrics,
    triggerShake,
  ]);

  const handleCompleteDigits = useCallback(
    (completed: string) => {
      if (mode === 'locked') {
        void executeVaultUnlock(completed);
        return;
      }

      if (setupStep === 'enter') {
        setFirstPin(completed);
        setDigits('');
        setSetupStep('confirm');
        setStatusMessage(null);
        return;
      }

      if (setupStep === 'confirm') {
        if (completed !== firstPin) {
          setDigits('');
          setFirstPin('');
          setSetupStep('enter');
          triggerShake('입력한 두 PIN이 일치하지 않습니다. 처음부터 다시 입력해 주세요.');
          return;
        }

        if (!hasConsented) {
          setStagedConfirmedPin(completed);
          setSetupStep('awaiting_consent');
          setConsentHighlight(true);
          setStatusMessage('아래 면책 동의란에 체크하면 즉시 암호화 볼트가 열립니다.');
          consentCheckboxRef.current?.focus();
          return;
        }

        void executeOnboardingCreation(completed, pinLength);
      }
    },
    [
      executeOnboardingCreation,
      executeVaultUnlock,
      firstPin,
      hasConsented,
      mode,
      pinLength,
      setupStep,
      triggerShake,
    ]
  );

  const handleAppendDigit = useCallback(
    (digit: string) => {
      if (isBusy || isBioVerifying || lockoutRemaining > 0 || isResetConfirmOpen) return;
      if (setupStep === 'awaiting_consent') {
        setConsentHighlight(true);
        consentCheckboxRef.current?.focus();
        return;
      }
      setStatusMessage(null);
      setDigits((prev) => {
        if (prev.length >= pinLength) return prev;
        const next = prev + digit;
        if (next.length === pinLength) {
          queueMicrotask(() => handleCompleteDigits(next));
        }
        return next;
      });
    },
    [
      handleCompleteDigits,
      isBioVerifying,
      isBusy,
      isResetConfirmOpen,
      lockoutRemaining,
      pinLength,
      setupStep,
    ]
  );

  const handleBackspace = useCallback(() => {
    if (isBusy || isBioVerifying || lockoutRemaining > 0 || isResetConfirmOpen) return;
    if (setupStep === 'awaiting_consent') {
      resetSetupFlow();
      return;
    }
    setStatusMessage(null);
    setDigits((prev) => prev.slice(0, -1));
  }, [
    isBioVerifying,
    isBusy,
    isResetConfirmOpen,
    lockoutRemaining,
    resetSetupFlow,
    setupStep,
  ]);

  useEffect(() => {
    if (drawerState.isOpen || isResetConfirmOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleAppendDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape' && digits.length > 0) {
        e.preventDefault();
        setDigits('');
      } else if (
        e.key === 'Enter' &&
        mode === 'locked' &&
        isBiometricEnabled &&
        digits.length === 0
      ) {
        e.preventDefault();
        void handleBiometricUnlock();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    digits.length,
    drawerState.isOpen,
    handleAppendDigit,
    handleBackspace,
    handleBiometricUnlock,
    isBiometricEnabled,
    isResetConfirmOpen,
    mode,
  ]);

  const handleToggleConsent = (checked: boolean) => {
    setHasConsented(checked);
    if (checked) {
      setConsentHighlight(false);
      setStatusMessage(null);
      if (stagedConfirmedPin) {
        const readyPin = stagedConfirmedPin;
        setStagedConfirmedPin('');
        if (mode === 'onboarding') {
          void executeOnboardingCreation(readyPin, pinLength);
        } else {
          void executeVaultUnlock(readyPin);
        }
      }
    }
  };

  const handleBrowseWithoutLockClick = () => {
    if (isBusy || isBioVerifying) return;
    if (!hasConsented) {
      setConsentHighlight(true);
      triggerShake('둘러보기를 시작하려면 AI API Key 보안 및 과금 면책 조항에 동의해 주세요.');
      consentCheckboxRef.current?.focus();
      return;
    }
    onEnterBrowseWithoutLock();
  };

  const activeDotCount =
    setupStep === 'awaiting_consent' || (mode === 'locked' && stagedConfirmedPin)
      ? pinLength
      : digits.length;

  const canUseBiometricOnGate =
    mode === 'locked' && isBiometricEnabled && Boolean(onUnlockVaultWithBiometrics);

  return (
    <div className="min-h-screen lg:h-screen w-screen overflow-x-hidden lg:overflow-hidden bg-[#0b0d12] text-neutral-200 font-sans antialiased grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] lg:grid-rows-[auto_1fr_auto] select-none">
      {/* 1. 컴팩트 브랜드 헤더 (모바일 1번 / 데스크톱 좌측 상단) */}
      <header className="order-1 lg:order-none lg:col-start-1 lg:row-start-1 px-6 sm:px-12 lg:px-16 xl:px-20 pt-5 pb-4 lg:pt-9 lg:pb-3 flex items-center justify-between">
        <span className="text-[14px] font-semibold text-white tracking-tight whitespace-nowrap">
          바이브 행사
        </span>
        <span className="text-xs text-neutral-500 hidden sm:inline whitespace-nowrap">
          Local-First Event Command Workspace
        </span>
      </header>

      {/* 3. 에디토리얼 선언 (모바일 3번 / 데스크톱 좌측 중단) */}
      <section className="order-3 lg:order-none lg:col-start-1 lg:row-start-2 px-6 sm:px-12 lg:px-16 xl:px-20 pt-7 pb-8 lg:pt-10 xl:pt-14 lg:pb-6 flex flex-col justify-start">
        <div className="max-w-xl space-y-4 lg:space-y-5">
          <p className="text-xs font-medium text-neutral-400 tracking-tight">
            프라이빗 행사 공정 아키텍처
          </p>

          <h1 className="text-[clamp(1.75rem,3.1vw,2.85rem)] font-semibold text-white tracking-tight leading-[1.2] [text-wrap:balance]">
            복잡한 행사 준비 공정을 고요하게 통제하는 로컬 볼트.
          </h1>

          <p className="text-[14px] sm:text-[15px] text-neutral-400 leading-[1.68] max-w-[46ch]">
            아이디나 중앙 서버 가입 없이 모든 일정, 프로젝트, 체크리스트를 사용자의 기기 내부에
            보관합니다. 고급 AES-256-GCM 볼트 암호화와 기기 생체 인증으로 보호하거나, 잠금 없이 즉시
            둘러보실 수 있습니다.
          </p>

          {/* 무테(Unboxed) 신뢰 사양 메타데이터 */}
          <div className="pt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-neutral-500">
            <span>계정 불필요</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">AES-256-GCM 로컬 암호화</span>
            <span aria-hidden="true">·</span>
            <span>WebAuthn 생체 인증</span>
            <span aria-hidden="true">·</span>
            <span>클라우드 및 온디바이스 AI</span>
          </div>
        </div>
      </section>

      {/* 4. 하단 제작자 서명(Colophon) · 법적 고지 · 바로가기 리스트 박스 (모바일 4번 최하단 / 데스크톱 좌측 하단) */}
      <footer className="order-4 lg:order-none lg:col-start-1 lg:row-start-3 px-6 sm:px-12 lg:px-16 xl:px-20 pb-8 pt-2 lg:pb-9 lg:pt-2 text-xs text-neutral-500">
        <div className="pt-4 border-t border-white/[0.05] space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-neutral-400">
            <span>{CREATOR_ENTITY.fullTitle}</span>
            <span aria-hidden="true" className="text-neutral-600">
              ·
            </span>
            <span>{CREATOR_ENTITY.jurisdiction}</span>
            <span aria-hidden="true" className="text-neutral-600">
              ·
            </span>
            <button
              type="button"
              onClick={handleCopyCreatorEmail}
              className="inline-flex items-center gap-1 text-neutral-400 hover:text-white transition-colors duration-150 cursor-pointer whitespace-nowrap"
              title="클릭하여 제작자 이메일 복사"
            >
              <span>{CREATOR_ENTITY.email}</span>
              {copiedCreatorEmail ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 text-neutral-600" />
              )}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={() => openLegalDrawer('disclaimer')}
                className="text-neutral-500 hover:text-neutral-200 underline-offset-4 hover:underline transition-colors duration-150 cursor-pointer whitespace-nowrap"
              >
                AI 보안·과금 면책고지
              </button>
              <span aria-hidden="true" className="text-neutral-700">
                ·
              </span>
              <button
                type="button"
                onClick={() => openLegalDrawer('privacy')}
                className="text-neutral-500 hover:text-neutral-200 underline-offset-4 hover:underline transition-colors duration-150 cursor-pointer whitespace-nowrap"
              >
                개인정보처리방침
              </button>
              <span aria-hidden="true" className="text-neutral-700">
                ·
              </span>
              <button
                type="button"
                onClick={() => openLegalDrawer('opensource')}
                className="text-neutral-500 hover:text-neutral-200 underline-offset-4 hover:underline transition-colors duration-150 cursor-pointer whitespace-nowrap"
              >
                오픈소스 저작권 고지
              </button>
              <span aria-hidden="true" className="text-neutral-700">
                ·
              </span>
              <button
                type="button"
                onClick={() => openLegalDrawer('colophon')}
                className="text-neutral-500 hover:text-neutral-200 underline-offset-4 hover:underline transition-colors duration-150 cursor-pointer whitespace-nowrap"
              >
                제작 노트
              </button>
            </div>

            {/* 바로가기 리스트 박스 (고구마 유니버스 · 관련 사이트) */}
            <div ref={siteMenuRef} className="flex items-center gap-2 shrink-0">
              {/* 고구마 유니버스 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenSiteMenu((prev) => (prev === 'universe' ? null : 'universe'))
                  }
                  aria-haspopup="menu"
                  aria-expanded={openSiteMenu === 'universe'}
                  className={`h-7 px-2.5 rounded-md border text-[11.5px] inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                    openSiteMenu === 'universe'
                      ? 'bg-white/[0.08] border-white/[0.18] text-white'
                      : 'bg-white/[0.02] border-white/[0.07] hover:border-white/[0.15] text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>고구마 유니버스</span>
                  <ChevronUp
                    className={`w-3 h-3 text-neutral-500 transition-transform duration-150 shrink-0 ${
                      openSiteMenu === 'universe' ? 'rotate-180 text-neutral-300' : ''
                    }`}
                  />
                </button>

                {openSiteMenu === 'universe' && (
                  <div
                    role="menu"
                    aria-label="고구마 유니버스 바로가기"
                    className="absolute bottom-full mb-2 left-0 xl:left-auto xl:right-0 min-w-[200px] py-1.5 rounded-xl bg-[#12151d]/98 border border-white/[0.10] shadow-[0_14px_32px_rgba(0,0,0,0.65)] backdrop-blur-xl z-30"
                  >
                    {GOGUMA_UNIVERSE_LINKS.map((item) => (
                      <a
                        key={item.label}
                        role="menuitem"
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setOpenSiteMenu(null)}
                        aria-label={`${item.label} 이동`}
                        className="group flex items-center justify-between gap-4 px-3 py-1.5 text-[12px] text-neutral-300 hover:text-white hover:bg-white/[0.05] transition-colors duration-150 whitespace-nowrap"
                      >
                        <span>{item.label}</span>
                        <ArrowUpRight className="w-3 h-3 text-neutral-500 group-hover:text-neutral-200 transition-colors shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* 관련 사이트 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenSiteMenu((prev) => (prev === 'related' ? null : 'related'))
                  }
                  aria-haspopup="menu"
                  aria-expanded={openSiteMenu === 'related'}
                  className={`h-7 px-2.5 rounded-md border text-[11.5px] inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                    openSiteMenu === 'related'
                      ? 'bg-white/[0.08] border-white/[0.18] text-white'
                      : 'bg-white/[0.02] border-white/[0.07] hover:border-white/[0.15] text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>관련 사이트</span>
                  <ChevronUp
                    className={`w-3 h-3 text-neutral-500 transition-transform duration-150 shrink-0 ${
                      openSiteMenu === 'related' ? 'rotate-180 text-neutral-300' : ''
                    }`}
                  />
                </button>

                {openSiteMenu === 'related' && (
                  <div
                    role="menu"
                    aria-label="관련 사이트 바로가기"
                    className="absolute bottom-full mb-2 left-[-96px] sm:left-0 xl:left-auto xl:right-0 min-w-[248px] max-h-[60vh] overflow-y-auto py-1.5 rounded-xl bg-[#12151d]/98 border border-white/[0.10] shadow-[0_14px_32px_rgba(0,0,0,0.65)] backdrop-blur-xl z-30"
                  >
                    {RELATED_SITE_LINKS.map((item) => (
                      <a
                        key={item.label}
                        role="menuitem"
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setOpenSiteMenu(null)}
                        aria-label={`${item.label} 이동`}
                        className="group flex items-center justify-between gap-4 px-3 py-1.5 text-[12px] text-neutral-300 hover:text-white hover:bg-white/[0.05] transition-colors duration-150 whitespace-nowrap"
                      >
                        <span>{item.label}</span>
                        <ArrowUpRight className="w-3 h-3 text-neutral-500 group-hover:text-neutral-200 transition-colors shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* 2. 핵심 볼트 설정 / 잠금 해제 모듈 (모바일 2번 헤더 바로 아래 / 데스크톱 우측 42% 수직 중앙) */}
      <section className="order-2 lg:order-none lg:col-start-2 lg:row-start-1 lg:row-span-3 bg-[#10131a] border-y lg:border-y-0 lg:border-l border-white/[0.05] flex flex-col items-center justify-center px-6 sm:px-10 py-6 sm:py-8 lg:py-6">
        <div className="w-full max-w-[368px]">
          {isResetConfirmOpen ? (
            /* 로컬 볼트 초기화 확인 패널 */
            <div className="relative rounded-2xl bg-[#141720] p-6 luxury-glass-border space-y-5">
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-white tracking-tight">
                  로컬 암호화 볼트 초기화
                </h2>
                <p className="text-[13px] text-neutral-400 leading-relaxed">
                  이 워크스페이스는 중앙 서버에 PIN이나 복구 키를 보관하지 않는 순수 로컬
                  AES-256-GCM 암호화 구조입니다. 초기화를 실행하면 현재 브라우저에 암호화되어 저장된
                  일정, 프로젝트 및 등록된 생체 인증 연결이 모두 영구 삭제됩니다.
                </p>
              </div>

              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsResetConfirmOpen(false)}
                  className="flex-1 h-10 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] text-xs font-medium text-neutral-300 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsResetConfirmOpen(false);
                    setFailedAttempts(0);
                    setLockoutRemaining(0);
                    onFactoryResetVault();
                    showGateToast('로컬 볼트가 초기화되었습니다.');
                  }}
                  className="flex-1 h-10 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-xs font-semibold text-white transition-colors duration-150 cursor-pointer whitespace-nowrap"
                >
                  영구 초기화 실행
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              {/* Primary Flow: Create Encrypted Vault / Unlock Vault */}
              <div className="space-y-3">
                {/* 챔버 헤더 & 자릿수 선택 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-neutral-400 shrink-0" strokeWidth={1.75} />
                      <h2 className="text-[15px] font-semibold text-white tracking-tight">
                        {mode === 'locked' ? '볼트 잠금 해제' : 'AES-256-GCM 볼트 설정'}
                      </h2>
                    </div>

                    {mode === 'onboarding' ? (
                      <div
                        className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]"
                        role="group"
                        aria-label="PIN 자릿수 선택"
                      >
                        {([4, 6] as const).map((len) => {
                          const active = pinLength === len;
                          return (
                            <button
                              key={len}
                              type="button"
                              onClick={() => resetSetupFlow(len)}
                              className={`px-2.5 py-1 rounded-md text-xs tabular-nums transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                                active
                                  ? 'bg-white/[0.12] text-white font-medium'
                                  : 'text-neutral-500 hover:text-neutral-300'
                              }`}
                            >
                              {len}자리
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-500 tabular-nums whitespace-nowrap">
                        {canUseBiometricOnGate
                          ? `${pinLength}자리 PIN · 생체 인증`
                          : `${pinLength}자리 PIN`}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 min-h-[20px]">
                    <p className="text-xs text-neutral-400">
                      {mode === 'locked' &&
                        (canUseBiometricOnGate
                          ? '생체 인증 또는 PIN 번호로 볼트를 잠금 해제해 주세요.'
                          : '키보드 숫자키 또는 패드로 PIN을 입력해 주세요.')}
                      {mode === 'onboarding' &&
                        setupStep === 'enter' &&
                        `새 ${pinLength}자리 숫자 PIN으로 로컬 데이터를 암호화합니다.`}
                      {mode === 'onboarding' &&
                        setupStep === 'confirm' &&
                        `확인을 위해 동일한 ${pinLength}자리 PIN을 다시 입력해 주세요.`}
                      {mode === 'onboarding' &&
                        setupStep === 'awaiting_consent' &&
                        'PIN 확인 완료 · 아래 면책 동의 체크 시 즉시 시작됩니다.'}
                    </p>

                    {mode === 'onboarding' && setupStep !== 'enter' && (
                      <button
                        type="button"
                        onClick={() => resetSetupFlow()}
                        className="text-xs text-neutral-400 hover:text-white underline underline-offset-4 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        다시 입력
                      </button>
                    )}
                  </div>
                </div>

                {/* PIN 슬롯 디스플레이 */}
                <div
                  className={`relative h-12 sm:h-13 rounded-2xl bg-[#151822] luxury-glass-border flex items-center justify-center gap-4 px-6 ${
                    isErrorShake ? 'vault-shake' : ''
                  }`}
                  aria-live="polite"
                >
                  {Array.from({ length: pinLength }).map((_, idx) => {
                    const filled = idx < activeDotCount;
                    return (
                      <span
                        key={idx}
                        className={`w-3 h-3 rounded-full transition-all duration-150 ${
                          filled
                            ? 'bg-white scale-105 shadow-[0_0_10px_rgba(255,255,255,0.45)]'
                            : 'bg-transparent border border-white/25 scale-100'
                        }`}
                      />
                    );
                  })}
                </div>

                {/* 상태 및 오류 피드백 라인 */}
                <div className="min-h-[18px] text-center">
                  {lockoutRemaining > 0 ? (
                    <p className="text-xs text-amber-400 tabular-nums">
                      보안 대기 중 · {lockoutRemaining}초 후 다시 시도할 수 있습니다.
                    </p>
                  ) : statusMessage ? (
                    <p className="text-xs text-amber-300/95">{statusMessage}</p>
                  ) : (
                    <p className="text-[11.5px] text-neutral-500">
                      {canUseBiometricOnGate
                        ? '숫자 키보드 직접 입력 또는 Enter로 생체 인증 실행'
                        : '숫자 키보드 직접 입력 지원 (0–9, Backspace)'}
                    </p>
                  )}
                </div>

                {/* 무테(Unboxed) 촉각 숫자 키패드 (데스크톱 슬림 높이) */}
                <div
                  className="grid grid-cols-3 gap-1.5"
                  role="group"
                  aria-label="PIN 숫자 키패드"
                >
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                    <button
                      key={num}
                      type="button"
                      disabled={isBusy || isBioVerifying || lockoutRemaining > 0}
                      onClick={() => handleAppendDigit(num)}
                      className="h-11 lg:h-10 rounded-xl text-[17px] font-medium text-neutral-200 hover:text-white hover:bg-white/[0.05] active:bg-white/[0.09] disabled:opacity-35 transition-colors duration-150 tabular-nums cursor-pointer"
                    >
                      {num}
                    </button>
                  ))}

                  {canUseBiometricOnGate && digits.length === 0 ? (
                    <button
                      type="button"
                      disabled={isBusy || isBioVerifying || lockoutRemaining > 0}
                      onClick={handleBiometricUnlock}
                      aria-label="생체 인증 실행"
                      title="Face ID · Touch ID · 지문 인증"
                      className="h-11 lg:h-10 rounded-xl flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/[0.05] active:bg-white/[0.09] disabled:opacity-35 transition-colors duration-150 cursor-pointer"
                    >
                      {isBioVerifying ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Fingerprint className="w-4 h-4" strokeWidth={1.75} />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        isBusy || isBioVerifying || lockoutRemaining > 0 || digits.length === 0
                      }
                      onClick={() => {
                        setDigits('');
                        setStatusMessage(null);
                      }}
                      className="h-11 lg:h-10 rounded-xl text-xs font-normal text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.04] disabled:opacity-25 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                    >
                      지우기
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isBusy || isBioVerifying || lockoutRemaining > 0}
                    onClick={() => handleAppendDigit('0')}
                    className="h-11 lg:h-10 rounded-xl text-[17px] font-medium text-neutral-200 hover:text-white hover:bg-white/[0.05] active:bg-white/[0.09] disabled:opacity-35 transition-colors duration-150 tabular-nums cursor-pointer"
                  >
                    0
                  </button>

                  <button
                    type="button"
                    disabled={
                      isBusy ||
                      isBioVerifying ||
                      lockoutRemaining > 0 ||
                      (digits.length === 0 && setupStep !== 'awaiting_consent')
                    }
                    onClick={handleBackspace}
                    aria-label="한 자리 지우기"
                    className="h-11 lg:h-10 rounded-xl flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.05] active:bg-white/[0.09] disabled:opacity-25 transition-colors duration-150 cursor-pointer"
                  >
                    <Delete className="w-4 h-4" strokeWidth={1.7} />
                  </button>
                </div>

                {/* 잠금 상태 생체 인증 원클릭 버튼 */}
                {canUseBiometricOnGate && (
                  <button
                    type="button"
                    disabled={isBusy || isBioVerifying || lockoutRemaining > 0}
                    onClick={handleBiometricUnlock}
                    className="w-full h-10 rounded-xl border border-white/[0.11] bg-white/[0.035] hover:bg-white/[0.075] disabled:opacity-40 flex items-center justify-center gap-2 text-[13px] font-medium text-white transition-colors duration-150 cursor-pointer whitespace-nowrap"
                  >
                    {isBioVerifying ? (
                      <Loader2 className="w-4 h-4 animate-spin text-neutral-300 shrink-0" />
                    ) : (
                      <Fingerprint className="w-4 h-4 text-neutral-200 shrink-0" strokeWidth={1.75} />
                    )}
                    <span>생체 인증으로 빠른 잠금 해제</span>
                  </button>
                )}

                {/* AI API Key 보안·과금 제작자 면책 체크박스 (Primary Create Vault 흐름에 포함) */}
                {mode === 'onboarding' || !initialHasConsented ? (
                  <div
                    className={`rounded-xl border p-3 transition-colors duration-150 ${
                      consentHighlight
                        ? 'border-amber-400/55 bg-amber-500/[0.05]'
                        : 'border-white/[0.08] bg-white/[0.015]'
                    }`}
                  >
                    <label className="flex items-start gap-3 cursor-pointer">
                      <span className="relative flex items-center justify-center mt-0.5 shrink-0">
                        <input
                          ref={consentCheckboxRef}
                          type="checkbox"
                          checked={hasConsented}
                          onChange={(e) => handleToggleConsent(e.target.checked)}
                          className="peer sr-only"
                        />
                        <span className="w-4 h-4 rounded border border-white/30 bg-[#0d0f15] peer-checked:bg-white peer-checked:border-white peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400 transition-colors duration-150 flex items-center justify-center">
                          {hasConsented && (
                            <Check className="w-3 h-3 text-[#0d0f15]" strokeWidth={2.6} />
                          )}
                        </span>
                      </span>

                      <span className="text-xs leading-relaxed text-neutral-300">
                        <span className="font-semibold text-white">
                          [필수] AI API Key 보안 및 과금 책임 면책 동의
                        </span>
                        <span className="block mt-1 text-[11.5px] text-neutral-400">
                          AI API Key의 보관·보안 관리 및 API 호출로 발생하는 클라우드 과금 책임은
                          전적으로 사용자 본인에게 있으며, 제작자({CREATOR_ENTITY.teamName})는 이에
                          대한 법적·금전적 책임을 부담하지 않음에 동의합니다.{' '}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openLegalDrawer('disclaimer');
                            }}
                            className="text-neutral-200 hover:text-white underline underline-offset-4 cursor-pointer whitespace-nowrap"
                          >
                            전문 보기
                          </button>
                        </span>
                      </span>
                    </label>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 px-1 pt-0.5 text-[11.5px] text-neutral-500">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span>AI API 보안·과금 면책 동의됨</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => openLegalDrawer('disclaimer')}
                      className="text-neutral-400 hover:text-neutral-200 underline underline-offset-4 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                    >
                      조항 보기
                    </button>
                  </div>
                )}
              </div>

              {/* Secondary Flow: 또는 구분선 + 잠금 없이 둘러 보기 / PIN 초기화 */}
              {mode === 'onboarding' ? (
                <div className="space-y-3">
                  <div className="relative flex items-center" aria-hidden="true">
                    <div className="flex-1 border-t border-white/[0.07]" />
                    <span className="px-3 text-[11px] font-medium text-neutral-500 whitespace-nowrap">
                      또는
                    </span>
                    <div className="flex-1 border-t border-white/[0.07]" />
                  </div>

                  <button
                    type="button"
                    disabled={isBusy || isBioVerifying}
                    onClick={handleBrowseWithoutLockClick}
                    className="w-full h-10 rounded-xl border border-white/[0.09] bg-white/[0.02] hover:bg-white/[0.06] text-[13px] font-medium text-neutral-300 hover:text-white transition-colors duration-150 cursor-pointer whitespace-nowrap"
                  >
                    잠금 없이 둘러 보기
                  </button>
                </div>
              ) : (
                <div className="pt-0.5 text-center">
                  <button
                    type="button"
                    onClick={() => setIsResetConfirmOpen(true)}
                    className="text-xs text-neutral-500 hover:text-neutral-300 underline-offset-4 hover:underline transition-colors duration-150 cursor-pointer whitespace-nowrap"
                  >
                    PIN을 잊으셨나요? 로컬 볼트 초기화
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 법적 고지 및 제작 노트 슬라이드오버 시트 */}
      <React.Suspense fallback={null}>
        <LegalAndColophonDrawer
          isOpen={drawerState.isOpen}
          initialTab={drawerState.tab}
          onClose={() => setDrawerState((prev) => ({ ...prev, isOpen: false }))}
          onCopySuccess={showGateToast}
        />
      </React.Suspense>

      {/* 게이트 내부 토스트 알림 */}
      {inlineToast && (
        <div className="fixed bottom-6 right-6 z-[90] bg-[#1b1f2a] text-neutral-100 text-xs px-4 py-2.5 rounded-xl border border-white/10 shadow-2xl">
          {inlineToast}
        </div>
      )}
    </div>
  );
};
