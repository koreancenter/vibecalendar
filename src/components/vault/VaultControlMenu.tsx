import React, { useEffect, useRef, useState } from 'react';
import { Bell, Fingerprint, Loader2, Lock, LockOpen, Shield, X } from 'lucide-react';
import {
  AutoLockMinutesOption,
  PinLengthOption,
} from '../../utils/vaultCrypto';
import { BiometricUserCancelledError } from '../../utils/webauthnBiometrics';
import { ReminderLeadMinutes } from '../../hooks/useEventReminders';
import { PWAInstallButton } from '../PWAInstallButton';
import { TopBarTooltip } from '../common/TopBarTooltip';
import { LegalDrawerTab } from './LegalAndColophonDrawer';

interface VaultControlMenuProps {
  isVaultEncrypted: boolean;
  isBiometricEnabled: boolean;
  isBiometricHardwareAvailable: boolean;
  autoLockMinutes: AutoLockMinutesOption;
  onChangeAutoLockMinutes: (minutes: AutoLockMinutesOption) => void;
  onToggleBiometrics: (enable: boolean) => Promise<void>;
  onLockNow: () => void;
  onReturnToIntroGate: () => void;
  onSetupOrChangePin: (
    newPin: string,
    pinLength: PinLengthOption,
    enableBiometricsAfterSetup?: boolean
  ) => Promise<void>;
  onDisableVaultEncryption: () => void;
  onOpenLegalDrawer: (tab: LegalDrawerTab) => void;
  hasSampleData?: boolean;
  onLoadSampleData?: () => void;
  onClearSampleData?: () => void;
  reminderLeadMinutes?: ReminderLeadMinutes;
  onChangeReminderLeadMinutes?: (lead: ReminderLeadMinutes) => void;
  onPwaInstalled?: () => void;
}

export const VaultControlMenu: React.FC<VaultControlMenuProps> = ({
  isVaultEncrypted,
  isBiometricEnabled,
  isBiometricHardwareAvailable,
  autoLockMinutes,
  onChangeAutoLockMinutes,
  onToggleBiometrics,
  onLockNow,
  onReturnToIntroGate,
  onSetupOrChangePin,
  onDisableVaultEncryption,
  onOpenLegalDrawer,
  hasSampleData = false,
  onLoadSampleData,
  onClearSampleData,
  reminderLeadMinutes = 0,
  onChangeReminderLeadMinutes,
  onPwaInstalled,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pinLength, setPinLength] = useState<PinLengthOption>(4);
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [enrollBioAfterPin, setEnrollBioAfterPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [isSavingPin, setIsSavingPin] = useState(false);

  const [isTogglingBio, setIsTogglingBio] = useState(false);
  const [bioFeedbackError, setBioFeedbackError] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setBioFeedbackError(null);
      return;
    }
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  const openPinSetupModal = () => {
    setIsOpen(false);
    setPinLength(4);
    setPinInput('');
    setPinConfirm('');
    setEnrollBioAfterPin(false);
    setPinError(null);
    setIsPinModalOpen(true);
  };

  const handleBiometricSwitchClick = async () => {
    if (isTogglingBio) return;
    setIsTogglingBio(true);
    setBioFeedbackError(null);
    try {
      await onToggleBiometrics(!isBiometricEnabled);
    } catch (err) {
      if (err instanceof BiometricUserCancelledError) {
        setBioFeedbackError('생체 인증 등록이 취소되었습니다.');
      } else {
        setBioFeedbackError(
          err instanceof Error
            ? err.message
            : '생체 인증 설정을 변경하는 중 오류가 발생했습니다.'
        );
      }
    } finally {
      setIsTogglingBio(false);
    }
  };

  const handleSubmitPinModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!new RegExp(`^[0-9]{${pinLength}}$`).test(pinInput)) {
      setPinError(`숫자 ${pinLength}자리를 정확히 입력해 주세요.`);
      return;
    }
    if (pinInput !== pinConfirm) {
      setPinError('입력한 두 PIN이 일치하지 않습니다.');
      return;
    }

    setIsSavingPin(true);
    setPinError(null);
    try {
      await onSetupOrChangePin(
        pinInput,
        pinLength,
        !isVaultEncrypted && enrollBioAfterPin
      );
      setIsPinModalOpen(false);
    } catch (err) {
      setPinError(
        err instanceof Error ? err.message : '암호화 볼트 설정 중 오류가 발생했습니다.'
      );
    } finally {
      setIsSavingPin(false);
    }
  };

  return (
    <div ref={menuRef} className="relative flex items-center shrink-0">
      <TopBarTooltip
        label={isVaultEncrypted ? '보안 볼트 활성' : '보안 볼트 · 설정'}
        shortcut={isVaultEncrypted ? '⌘L' : undefined}
        align="right"
        disabled={isOpen}
      >
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="로컬 볼트 및 보안 메뉴"
          aria-expanded={isOpen}
          className={`relative h-7 w-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25 ${
            isOpen
              ? 'bg-white/[0.09] text-white'
              : isVaultEncrypted
              ? 'text-neutral-300 hover:text-white hover:bg-white/[0.06]'
              : 'text-neutral-400 hover:text-white hover:bg-white/[0.06]'
          }`}
        >
          {isVaultEncrypted ? (
            <Lock className="w-[15px] h-[15px]" strokeWidth={1.65} />
          ) : (
            <LockOpen className="w-[15px] h-[15px]" strokeWidth={1.65} />
          )}
        </button>
      </TopBarTooltip>

      {isOpen && (
        <div className="luxury-glass-border absolute right-0 top-full mt-2 w-72 rounded-xl bg-gradient-to-b from-[#181c27]/82 via-[#11141d]/80 to-[#0c0e15]/88 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.78),0_8px_20px_-4px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)] py-2 z-50 text-xs text-neutral-200 select-none overflow-hidden">
          <div className="px-3.5 py-2 border-b border-white/[0.06] space-y-0.5">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>
                {isVaultEncrypted ? 'AES-256-GCM 볼트 활성' : '잠금 없이 둘러보는 중'}
              </span>
            </div>
            <p className="text-[11px] text-neutral-500">
              {isVaultEncrypted
                ? isBiometricEnabled
                  ? 'PIN 및 하드웨어 생체 인증 잠금 해제 보호 중'
                  : '로컬 스토리지 평문 제거 및 암호화 적용됨'
                : 'PIN을 설정하면 일정이 암호화 보관됩니다'}
            </p>
          </div>

          {isVaultEncrypted ? (
            <>
              <div className="py-1 border-b border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onLockNow();
                  }}
                  className="w-full px-3.5 py-2 flex items-center justify-between hover:bg-white/[0.05] text-white font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap"
                >
                  <span>즉시 볼트 잠금</span>
                  <span className="text-[11px] text-neutral-500 tabular-nums">⌘L</span>
                </button>

                <button
                  type="button"
                  onClick={openPinSetupModal}
                  className="w-full px-3.5 py-2 text-left hover:bg-white/[0.05] text-neutral-300 hover:text-white transition-colors duration-150 cursor-pointer whitespace-nowrap"
                >
                  PIN 번호 변경
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onDisableVaultEncryption();
                  }}
                  className="w-full px-3.5 py-2 text-left hover:bg-white/[0.05] text-neutral-400 hover:text-neutral-200 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                >
                  볼트 암호화 해제 (일반 모드)
                </button>
              </div>

              {/* 생체 인증 사용 (WebAuthn) 토글 섹션 */}
              <div className="px-3.5 py-2.5 border-b border-white/[0.06] space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Fingerprint
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isBiometricEnabled ? 'text-white' : 'text-neutral-400'
                      }`}
                      strokeWidth={1.75}
                    />
                    <span className="text-xs font-medium text-neutral-100 whitespace-nowrap">
                      생체 인증 사용 (WebAuthn)
                    </span>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={isBiometricEnabled}
                    aria-label="생체 인증 사용"
                    disabled={isTogglingBio}
                    onClick={handleBiometricSwitchClick}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 cursor-pointer disabled:opacity-50 ${
                      isBiometricEnabled
                        ? 'bg-white border-white'
                        : 'bg-white/[0.06] border-white/[0.14] hover:border-white/[0.25]'
                    }`}
                  >
                    {isTogglingBio ? (
                      <Loader2
                        className={`w-3 h-3 mx-auto animate-spin ${
                          isBiometricEnabled ? 'text-[#0c0e14]' : 'text-neutral-300'
                        }`}
                      />
                    ) : (
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full transition-transform duration-150 ${
                          isBiometricEnabled
                            ? 'translate-x-[17px] bg-[#0c0e14]'
                            : 'translate-x-[2px] bg-neutral-400'
                        }`}
                      />
                    )}
                  </button>
                </div>

                <p className="text-[11px] text-neutral-500 leading-snug">
                  {isBiometricEnabled
                    ? 'Face ID · Touch ID · 지문으로 빠르게 잠금을 해제합니다.'
                    : isBiometricHardwareAvailable
                      ? '기기 생체 인증을 등록해 PIN 입력 없이 빠르게 해제합니다.'
                      : '독립 브라우저 탭 및 생체 인식 지원 기기에서 등록할 수 있습니다.'}
                </p>

                {bioFeedbackError && (
                  <p className="text-[11px] text-amber-300/95 leading-snug pt-0.5 select-text">
                    {bioFeedbackError}
                  </p>
                )}
              </div>

              <div className="px-3.5 py-2.5 border-b border-white/[0.06] space-y-2">
                <span className="text-[11px] text-neutral-500 block">
                  자리 비움 자동 잠금
                </span>
                <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                  {(
                    [
                      { value: 5, label: '5분' },
                      { value: 15, label: '15분' },
                      { value: 30, label: '30분' },
                      { value: 0, label: '꺼짐' },
                    ] as const
                  ).map((opt) => {
                    const selected = autoLockMinutes === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChangeAutoLockMinutes(opt.value)}
                        className={`py-1 rounded-md text-[11px] tabular-nums transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                          selected
                            ? 'bg-white/[0.12] text-white font-medium'
                            : 'text-neutral-500 hover:text-neutral-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="py-1 border-b border-white/[0.06]">
              <button
                type="button"
                onClick={openPinSetupModal}
                className="w-full px-3.5 py-2 text-left hover:bg-white/[0.05] text-white font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap"
              >
                AES-256-GCM PIN 잠금 설정
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onReturnToIntroGate();
                }}
                className="w-full px-3.5 py-2 text-left hover:bg-white/[0.05] text-neutral-300 hover:text-white transition-colors duration-150 cursor-pointer whitespace-nowrap"
              >
                인트로 게이트로 이동
              </button>
            </div>
          )}

          {onChangeReminderLeadMinutes && (
            <div className="px-3.5 py-2.5 border-b border-white/[0.06] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-neutral-400 flex items-center gap-1.5 whitespace-nowrap">
                  <Bell className="w-3 h-3 text-neutral-400 shrink-0" />
                  <span>임박 일정 로컬 알림</span>
                </span>
                <span className="text-[10.5px] font-mono text-neutral-500 tabular-nums whitespace-nowrap">
                  {reminderLeadMinutes === 0 ? '꺼짐' : `${reminderLeadMinutes}분 전`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                {(
                  [
                    { value: 0, label: '꺼짐' },
                    { value: 10, label: '10분' },
                    { value: 15, label: '15분' },
                    { value: 30, label: '30분' },
                  ] as const
                ).map((opt) => {
                  const selected = reminderLeadMinutes === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onChangeReminderLeadMinutes(opt.value)}
                      className={`py-1 rounded-md text-[11px] tabular-nums transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                        selected
                          ? 'bg-white/[0.12] text-white font-medium'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="px-1.5 py-1 border-b border-white/[0.06] empty:hidden">
            <PWAInstallButton
              variant="menu"
              onInstalled={() => {
                setIsOpen(false);
                onPwaInstalled?.();
              }}
            />
          </div>

          {(onLoadSampleData || (hasSampleData && onClearSampleData)) && (
            <div className="py-1 border-b border-white/[0.06]">
              {onLoadSampleData && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onLoadSampleData();
                  }}
                  className="w-full px-3.5 py-2 text-left hover:bg-white/[0.05] text-neutral-300 hover:text-white transition-colors duration-150 cursor-pointer whitespace-nowrap"
                >
                  샘플 데이터 불러오기
                </button>
              )}
              {hasSampleData && onClearSampleData && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onClearSampleData();
                  }}
                  className="w-full px-3.5 py-2 text-left hover:bg-white/[0.05] text-amber-300/90 hover:text-amber-200 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                >
                  샘플 데이터 비우기
                </button>
              )}
            </div>
          )}

          <div className="py-1">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenLegalDrawer('disclaimer');
              }}
              className="w-full px-3.5 py-1.5 text-left hover:bg-white/[0.05] text-neutral-400 hover:text-neutral-200 transition-colors duration-150 cursor-pointer whitespace-nowrap"
            >
              AI 보안·과금 면책고지
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenLegalDrawer('privacy');
              }}
              className="w-full px-3.5 py-1.5 text-left hover:bg-white/[0.05] text-neutral-400 hover:text-neutral-200 transition-colors duration-150 cursor-pointer whitespace-nowrap"
            >
              개인정보처리방침
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenLegalDrawer('colophon');
              }}
              className="w-full px-3.5 py-1.5 text-left hover:bg-white/[0.05] text-neutral-400 hover:text-neutral-200 transition-colors duration-150 cursor-pointer whitespace-nowrap"
            >
              제작 노트 (GOGUMA APP Team)
            </button>
          </div>
        </div>
      )}

      {/* 워크스페이스 내부 PIN 설정 / 변경 모달 */}
      {isPinModalOpen && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 backdrop-blur-xs px-4"
          role="dialog"
          aria-modal="true"
          aria-label="AES-256-GCM PIN 설정"
          onClick={() => setIsPinModalOpen(false)}
        >
          <form
            onSubmit={handleSubmitPinModal}
            onClick={(e) => e.stopPropagation()}
            className="luxury-glass-border relative w-full max-w-sm rounded-xl bg-gradient-to-b from-[#181c27]/84 via-[#11141d]/82 to-[#0c0e15]/90 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.78),0_8px_20px_-4px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)] p-6 space-y-5 text-neutral-200 overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-white tracking-tight">
                {isVaultEncrypted ? '볼트 PIN 번호 변경' : 'AES-256-GCM 볼트 활성화'}
              </h3>
              <button
                type="button"
                onClick={() => setIsPinModalOpen(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/[0.05] cursor-pointer"
                aria-label="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed">
              현재 워크스페이스의 일정과 프로젝트를 숫자 PIN 기반 AES-256-GCM 키로 암호화합니다.
              {isVaultEncrypted && isBiometricEnabled
                ? ' 기존에 등록된 생체 인증(WebAuthn)은 그대로 유지됩니다.'
                : ' PIN 분실 시 복구할 수 없으므로 반드시 기억해 주세요.'}
            </p>

            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-400">PIN 자릿수</span>
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                {([4, 6] as const).map((len) => (
                  <button
                    key={len}
                    type="button"
                    onClick={() => {
                      setPinLength(len);
                      setPinInput('');
                      setPinConfirm('');
                      setPinError(null);
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs tabular-nums cursor-pointer whitespace-nowrap ${
                      pinLength === len
                        ? 'bg-white/[0.12] text-white font-medium'
                        : 'text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    {len}자리
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1.5">
                  새 숫자 PIN ({pinLength}자리)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={pinLength}
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value.replace(/\D/g, '').slice(0, pinLength));
                    setPinError(null);
                  }}
                  placeholder={'•'.repeat(pinLength)}
                  autoFocus
                  className="w-full h-10 px-3.5 rounded-xl bg-[#0c0e14] border border-white/[0.1] text-sm text-white tracking-[0.35em] tabular-nums focus:border-white/30 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-1.5">
                  PIN 다시 입력
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={pinLength}
                  value={pinConfirm}
                  onChange={(e) => {
                    setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, pinLength));
                    setPinError(null);
                  }}
                  placeholder={'•'.repeat(pinLength)}
                  className="w-full h-10 px-3.5 rounded-xl bg-[#0c0e14] border border-white/[0.1] text-sm text-white tracking-[0.35em] tabular-nums focus:border-white/30 outline-none"
                />
              </div>
            </div>

            {!isVaultEncrypted && isBiometricHardwareAvailable && (
              <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] cursor-pointer">
                <span className="flex items-center gap-2 text-xs text-neutral-300">
                  <Fingerprint className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span>설정 직후 생체 인증(Face ID · 지문) 함께 등록</span>
                </span>
                <input
                  type="checkbox"
                  checked={enrollBioAfterPin}
                  onChange={(e) => setEnrollBioAfterPin(e.target.checked)}
                  className="accent-white w-3.5 h-3.5 cursor-pointer shrink-0"
                />
              </label>
            )}

            {pinError && <p className="text-xs text-amber-400">{pinError}</p>}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsPinModalOpen(false)}
                className="flex-1 h-10 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] text-xs font-medium text-neutral-300 cursor-pointer whitespace-nowrap"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isSavingPin}
                className="flex-1 h-10 rounded-xl bg-white text-[#0c0e14] hover:bg-neutral-200 disabled:opacity-50 text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                {isSavingPin ? '암호화 중...' : '암호화 적용'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
