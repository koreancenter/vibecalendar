import React, { useEffect, useMemo, useState } from 'react';
import { Bell, Check, Clock, Loader2, Plus, Send, Shield, Trash2, X } from 'lucide-react';
import { NotificationEnginePreferences } from '../../types';
import {
  formatLeadMinutesLabel,
  LEAD_TIME_PRESET_OPTIONS,
  MAX_CUSTOM_LEAD_MINUTES,
  MAX_LEAD_TIMES_PER_ITEM,
  ScheduledAlertRecord,
  summarizeLeadMinutesList,
} from '../../shared/notificationSchema';
import { NotificationPlatformCapabilities } from '../../services/notifications/pushClient';
import { HelpTooltip } from '../common/HelpTooltip';

interface NotificationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isVaultEncrypted: boolean;
  prefs: NotificationEnginePreferences;
  notificationPermission: NotificationPermission | 'unsupported';
  capabilities: NotificationPlatformCapabilities;
  upcomingAlerts: ScheduledAlertRecord[];
  isWebPushSubscribed: boolean;
  isPushBusy: boolean;
  pendingOfflineSyncCount: number;
  onUpdatePrefs: (
    patch:
      | Partial<NotificationEnginePreferences>
      | ((prev: NotificationEnginePreferences) => NotificationEnginePreferences)
  ) => Promise<void>;
  onToggleDefaultLeadMinute: (minute: number) => Promise<void>;
  onAddCustomDefaultLeadMinute: (minute: number) => Promise<boolean>;
  onRequestPermission: () => Promise<NotificationPermission | 'unsupported'>;
  onEnableWebPush: () => Promise<boolean>;
  onDisableWebPush: () => Promise<void>;
  onSendTestAlert: () => Promise<'web-push' | 'sw-local' | 'dom-fallback'>;
  onSnoozeAlert: (alert: ScheduledAlertRecord, delayMinutes?: number) => Promise<void>;
  onDismissAlert: (triggerId: string) => Promise<void>;
  onSelectScheduledEvent?: (eventId: string, eventDate: string) => void;
  showToast: (msg: string) => void;
}

const ALL_DAY_HOUR_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: '꺼짐' },
  { value: 8, label: '08:00' },
  { value: 9, label: '09:00' },
  { value: 10, label: '10:00' },
];

function formatTriggerStamp(epochMs: number): string {
  const dt = new Date(epochMs);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

function formatRelativeCountdown(triggerAtMs: number, nowMs: number): string {
  const diffMs = triggerAtMs - nowMs;
  if (diffMs <= 0) return '곧 발송';
  const totalMins = Math.ceil(diffMs / 60_000);
  if (totalMins < 60) return `${totalMins}분 후`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) {
    return mins > 0 ? `${hours}시간 ${mins}분 후` : `${hours}시간 후`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}일 ${remHours}시간 후` : `${days}일 후`;
}

export const NotificationSettingsModal: React.FC<NotificationSettingsModalProps> = ({
  isOpen,
  onClose,
  isVaultEncrypted,
  prefs,
  notificationPermission,
  capabilities,
  upcomingAlerts,
  isWebPushSubscribed,
  isPushBusy,
  pendingOfflineSyncCount,
  onUpdatePrefs,
  onToggleDefaultLeadMinute,
  onAddCustomDefaultLeadMinute,
  onRequestPermission,
  onEnableWebPush,
  onDisableWebPush,
  onSendTestAlert,
  onSnoozeAlert,
  onDismissAlert,
  onSelectScheduledEvent,
  showToast,
}) => {
  const [customMinuteInput, setCustomMinuteInput] = useState('');
  const [customInputError, setCustomInputError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [isTestingAlert, setIsTestingAlert] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) {
      setCustomInputError(null);
      setPushError(null);
      return;
    }

    setNowMs(Date.now());
    const tickId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15_000);

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);

    return () => {
      window.clearInterval(tickId);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  const presetMinuteSet = useMemo(
    () => new Set(LEAD_TIME_PRESET_OPTIONS.map((opt) => opt.minutes)),
    []
  );

  const customSelectedMinutes = useMemo(
    () => prefs.defaultLeadMinutes.filter((m) => !presetMinuteSet.has(m)),
    [prefs.defaultLeadMinutes, presetMinuteSet]
  );

  if (!isOpen) return null;

  const permissionText =
    notificationPermission === 'granted'
      ? '브라우저 권한 허용됨'
      : notificationPermission === 'denied'
      ? '브라우저 권한 차단됨'
      : notificationPermission === 'default'
      ? '브라우저 권한 요청 대기'
      : '알림 API 미지원 환경';

  const activeWebPush = Boolean(prefs.webPushEnabled && isWebPushSubscribed);

  const handleToggleMasterSwitch = async () => {
    const nextEnabled = !prefs.enabled;
    await onUpdatePrefs({ enabled: nextEnabled });
    showToast(
      nextEnabled
        ? `일정 알림 엔진이 활성화되었습니다 (${summarizeLeadMinutesList(prefs.defaultLeadMinutes)}).`
        : '일정 알림 엔진이 일시 중지되었습니다.'
    );
  };

  const handleAddCustomMinute = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customMinuteInput.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_CUSTOM_LEAD_MINUTES) {
      setCustomInputError(`0분부터 ${MAX_CUSTOM_LEAD_MINUTES.toLocaleString()}분(7일) 사이 숫자를 입력해 주세요.`);
      return;
    }
    const rounded = Math.round(parsed);
    if (
      !prefs.defaultLeadMinutes.includes(rounded) &&
      prefs.defaultLeadMinutes.length >= MAX_LEAD_TIMES_PER_ITEM
    ) {
      setCustomInputError(`기본 리드타임은 최대 ${MAX_LEAD_TIMES_PER_ITEM}개까지 조합할 수 있습니다.`);
      return;
    }

    const ok = await onAddCustomDefaultLeadMinute(rounded);
    if (ok) {
      setCustomMinuteInput('');
      setCustomInputError(null);
      showToast(`기본 리드타임에 '${formatLeadMinutesLabel(rounded, true)}' 알림이 추가되었습니다.`);
    }
  };

  const handleToggleWebPush = async () => {
    if (isPushBusy) return;
    setPushError(null);

    if (activeWebPush) {
      await onDisableWebPush();
      showToast('앱 종료 상태 Web Push 구독이 해제되었습니다.');
      return;
    }

    try {
      await onEnableWebPush();
      showToast('제로 지식 VAPID Web Push가 활성화되었습니다. 브라우저가 닫혀 있어도 정밀 알림이 동작합니다.');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Web Push 구독 중 오류가 발생했습니다. 독립 브라우저 탭 또는 설치된 PWA에서 다시 시도해 주세요.';
      setPushError(msg);
    }
  };

  const handleRunTestAlert = async () => {
    if (isTestingAlert) return;
    setIsTestingAlert(true);
    setPushError(null);
    try {
      const channel = await onSendTestAlert();
      if (channel === 'web-push') {
        showToast(
          '3초 후 VAPID Web Push 경로로 백그라운드 알림이 발송됩니다. 창을 최소화해 확인해 보세요.'
        );
      } else if (channel === 'sw-local') {
        showToast('3초 후 PWA Service Worker 백그라운드 타이머로 로컬 알림이 발송됩니다.');
      } else {
        showToast('3초 후 브라우저 로컬 알림으로 테스트 알림이 표시됩니다.');
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '테스트 알림 예약 중 오류가 발생했습니다.';
      setPushError(msg);
    } finally {
      setIsTestingAlert(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[72] flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="고급 알림 및 백그라운드 동기화 설정"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="luxury-glass-border relative w-full max-w-2xl h-[580px] max-h-[90vh] rounded-2xl bg-gradient-to-b from-[#181c27]/96 via-[#11141d]/96 to-[#0c0e15]/98 backdrop-blur-xl shadow-[0_28px_72px_-16px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden text-neutral-200"
      >
        {/* 상단 헤더 */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Bell className="w-4 h-4 text-neutral-300 shrink-0" strokeWidth={1.75} />
            <h2 className="text-[15px] font-semibold text-white tracking-tight truncate">
              고급 알림 및 백그라운드 동기화 엔진
            </h2>
            <HelpTooltip
              title="고급 알림 및 백그라운드 동기화 엔진"
              content={
                <div className="space-y-1">
                  <p>
                    {prefs.enabled
                      ? `알림 활성: ${summarizeLeadMinutesList(prefs.defaultLeadMinutes)}`
                      : '현재 알림이 비활성화되어 있습니다.'}
                  </p>
                  <p className="text-neutral-400">
                    권한 상태: {permissionText} · 예약 대기 {upcomingAlerts.length}건
                  </p>
                </div>
              }
              align="left"
              placement="bottom"
            />
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 본문 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06]">
          {/* 01. 마스터 알림 스위치 및 시스템 권한 */}
          <section className="px-6 py-5 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5 min-w-0">
                <h3 className="text-[13px] font-semibold text-white">
                  01. 로컬 알림 엔진 및 브라우저 권한
                </h3>
                <HelpTooltip
                  title="로컬 알림 스케줄러"
                  content="반복 일정과 글로벌 시차(DST 일광절약시간제 포함)를 자동 보정하여 향후 14일간의 정밀 알림 스케줄을 기기 내 IndexedDB에 유지합니다."
                  align="left"
                  placement="bottom"
                />
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={prefs.enabled}
                aria-label="일정 알림 엔진 활성화"
                onClick={() => void handleToggleMasterSwitch()}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                  prefs.enabled
                    ? 'bg-white border-white'
                    : 'bg-white/[0.06] border-white/[0.14] hover:border-white/[0.25]'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full transition-transform duration-150 ${
                    prefs.enabled
                      ? 'translate-x-[22px] bg-[#0c0e14]'
                      : 'translate-x-[3px] bg-neutral-400'
                  }`}
                />
              </button>
            </div>

            {notificationPermission !== 'granted' && (
              <div className="pt-1 flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="text-amber-300/90 leading-snug">
                  {notificationPermission === 'denied'
                    ? '브라우저 주소창 좌측의 사이트 권한 설정에서 알림(Notifications) 차단을 해제해 주세요.'
                    : notificationPermission === 'unsupported'
                    ? '현재 환경에서는 시스템 알림 API가 제한되어 인앱 토스트 알림으로 대체 동작합니다.'
                    : '운영체제 네이티브 배너로 알림을 받으려면 브라우저 알림 권한 허용이 필요합니다.'}
                </span>

                {notificationPermission === 'default' && (
                  <button
                    type="button"
                    onClick={() => {
                      void onRequestPermission().then((perm) => {
                        if (perm === 'granted') {
                          showToast('브라우저 시스템 알림 권한이 허용되었습니다.');
                        }
                      });
                    }}
                    className="h-8 px-3.5 rounded-lg bg-white text-[#0c0e14] hover:bg-neutral-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    알림 권한 허용
                  </button>
                )}
              </div>
            )}
          </section>

          {/* 02. 기본 리드타임 다중 조합 및 종일 일정 브리핑 */}
          <section className="px-6 py-5 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-white">
                02. 기본 리드타임 조합 및 종일 브리핑
              </h3>
              <span className="text-[11px] text-neutral-500 tabular-nums">
                최대 {MAX_LEAD_TIMES_PER_ITEM}개 동시 선택 · 개별 일정에서 덮어쓰기 가능
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {LEAD_TIME_PRESET_OPTIONS.map((opt) => {
                const selected = prefs.defaultLeadMinutes.includes(opt.minutes);
                return (
                  <button
                    key={opt.minutes}
                    type="button"
                    onClick={() => void onToggleDefaultLeadMinute(opt.minutes)}
                    className={`h-8 px-3 rounded-lg border text-xs tabular-nums inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25 ${
                      selected
                        ? 'bg-white/[0.13] border-white/25 text-white font-medium'
                        : 'bg-white/[0.02] border-white/[0.07] text-neutral-400 hover:text-neutral-200 hover:border-white/[0.14]'
                    }`}
                  >
                    {selected && <Check className="w-3 h-3 text-white shrink-0" />}
                    <span>{opt.shortLabel}</span>
                  </button>
                );
              })}

              {customSelectedMinutes.map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => void onToggleDefaultLeadMinute(min)}
                  title="클릭하여 기본 리드타임에서 제거"
                  className="h-8 px-3 rounded-lg border bg-white/[0.13] border-white/25 text-white text-xs font-medium tabular-nums inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap hover:bg-white/[0.18]"
                >
                  <Check className="w-3 h-3 text-white shrink-0" />
                  <span>{formatLeadMinutesLabel(min, true)}</span>
                  <X className="w-3 h-3 text-neutral-400 shrink-0" />
                </button>
              ))}
            </div>

            <form onSubmit={(e) => void handleAddCustomMinute(e)} className="flex flex-wrap items-center gap-2">
              <div className="relative flex items-center">
                <input
                  type="number"
                  min={0}
                  max={MAX_CUSTOM_LEAD_MINUTES}
                  step={1}
                  value={customMinuteInput}
                  onChange={(e) => {
                    setCustomMinuteInput(e.target.value);
                    setCustomInputError(null);
                  }}
                  placeholder="직접 입력 (예: 25, 45, 90)"
                  className="h-8 w-52 pl-3 pr-9 rounded-lg bg-[#0b0d13] border border-white/[0.09] focus:border-white/25 text-xs text-white placeholder:text-neutral-500 tabular-nums outline-none"
                />
                <span className="absolute right-3 text-[11px] text-neutral-500 pointer-events-none">
                  분 전
                </span>
              </div>
              <button
                type="submit"
                className="h-8 px-3.5 rounded-lg border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.09] text-xs font-medium text-neutral-200 hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>리드타임 추가</span>
              </button>
              <span className="text-[11px] text-neutral-500 tabular-nums">
                0분(정각) ~ 10,080분(7일 전)
              </span>
            </form>

            {customInputError && (
              <p className="text-xs text-amber-300/95">{customInputError}</p>
            )}

            {/* 종일 일정 브리핑 시각 선택 */}
            <div className="pt-1 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-medium text-neutral-200">
                  종일 일정 당일 브리핑 시각
                </span>
                <HelpTooltip
                  title="종일 일정 아침 브리핑"
                  content="시각이 지정되지 않은 종일(All-Day) 행사가 있는 날, 아침 알림을 발송할 기준 시각입니다. '꺼짐' 선택 시 종일 일정은 알림에서 제외됩니다."
                  align="left"
                  placement="top"
                />
              </div>

              <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.07]">
                {ALL_DAY_HOUR_OPTIONS.map((opt) => {
                  const active = prefs.allDayNotifyHour === opt.value;
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => void onUpdatePrefs({ allDayNotifyHour: opt.value })}
                      className={`h-7 px-3 rounded-md text-xs tabular-nums transition-colors cursor-pointer whitespace-nowrap ${
                        active
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
          </section>

          {/* 03. 백그라운드 푸시(앱 종료 상태 동작) · Background Sync · 볼트 마스킹 */}
          <section className="px-6 py-5 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-white">
                03. 앱 종료 백그라운드 푸시 및 오프라인 동기화
              </h3>
              <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                <span>SW {capabilities.serviceWorker ? '지원' : '제한'}</span>
                <span aria-hidden="true">·</span>
                <span>Push {capabilities.pushManager ? '지원' : '제한'}</span>
                <span aria-hidden="true">·</span>
                <span>BG Sync {capabilities.backgroundSync ? '지원' : '폴백'}</span>
                {capabilities.osTimestampTrigger && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>OS Trigger 활성</span>
                  </>
                )}
              </div>
            </div>

            {/* 3-A. 제로 지식 VAPID Web Push */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-medium text-neutral-100">
                  앱 · 브라우저 종료 상태 알림 유지 (VAPID Web Push)
                </span>
                <HelpTooltip
                  title="제로 지식(Zero-Knowledge) VAPID 푸시"
                  content="서버에는 일정 제목이나 장소 없이 익명 트리거 ID와 시각(Epoch)만 보관됩니다. 푸시 수신 시 기기 내 Service Worker가 로컬 볼트/IndexedDB에서 일정 원본을 복원하여 안전하게 표시합니다."
                  align="left"
                  placement="top"
                />
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={activeWebPush}
                aria-label="앱 종료 상태 Web Push 활성화"
                disabled={isPushBusy}
                onClick={() => void handleToggleWebPush()}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 cursor-pointer disabled:opacity-50 ${
                  activeWebPush
                    ? 'bg-white border-white'
                    : 'bg-white/[0.06] border-white/[0.14] hover:border-white/[0.25]'
                }`}
              >
                {isPushBusy ? (
                  <Loader2
                    className={`w-3.5 h-3.5 mx-auto animate-spin ${
                      activeWebPush ? 'text-[#0c0e14]' : 'text-neutral-300'
                    }`}
                  />
                ) : (
                  <span
                    className={`inline-block h-4 w-4 rounded-full transition-transform duration-150 ${
                      activeWebPush
                        ? 'translate-x-[22px] bg-[#0c0e14]'
                        : 'translate-x-[3px] bg-neutral-400'
                    }`}
                  />
                )}
              </button>
            </div>

            {/* 3-B. Background Sync & Periodic Sync */}
            <div className="flex items-center justify-between gap-4 pt-1">
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <span className="text-xs font-medium text-neutral-100">
                  Service Worker 백그라운드 동기화 (Background Sync)
                </span>
                {pendingOfflineSyncCount > 0 && (
                  <span className="text-[11px] font-mono text-amber-300 tabular-nums">
                    · 오프라인 대기 {pendingOfflineSyncCount}건
                  </span>
                )}
                <HelpTooltip
                  title="오프라인 대기열 & 백그라운드 스케줄 스윕"
                  content="오프라인 상태에서 보류된 외부 캘린더 동기화 작업을 큐에 적재하고 네트워크 복구 즉시 자동 실행하며, 주기적으로 백그라운드 알림 대기열을 점검합니다."
                  align="left"
                  placement="top"
                />
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={prefs.backgroundSyncEnabled}
                aria-label="Service Worker 백그라운드 동기화 활성화"
                onClick={() =>
                  void onUpdatePrefs({ backgroundSyncEnabled: !prefs.backgroundSyncEnabled })
                }
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 cursor-pointer ${
                  prefs.backgroundSyncEnabled
                    ? 'bg-white border-white'
                    : 'bg-white/[0.06] border-white/[0.14] hover:border-white/[0.25]'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full transition-transform duration-150 ${
                    prefs.backgroundSyncEnabled
                      ? 'translate-x-[22px] bg-[#0c0e14]'
                      : 'translate-x-[3px] bg-neutral-400'
                  }`}
                />
              </button>
            </div>

            {/* 3-C. AES-256-GCM 암호화 볼트 프라이버시 마스킹 */}
            <div className="flex items-start justify-between gap-4 pt-1">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <span className="text-xs font-medium text-neutral-100">
                    암호화 볼트 활성 시 알림 본문 프라이버시 마스킹
                  </span>
                </div>
                <p className="text-[11.5px] text-neutral-400 leading-relaxed">
                  {isVaultEncrypted
                    ? '현재 AES-256-GCM 볼트가 활성화되어 있습니다. 잠금 화면 배너와 백그라운드 캐시에 민감한 제목·장소 대신 예정 시각만 노출합니다.'
                    : 'PIN 암호화 볼트를 켜면 시스템 알림 배너와 IndexedDB에 일정 제목 대신 보안 안내 문구만 표시합니다.'}
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={prefs.privacyMaskWhenEncrypted}
                aria-label="암호화 볼트 알림 프라이버시 마스킹"
                onClick={() =>
                  void onUpdatePrefs({
                    privacyMaskWhenEncrypted: !prefs.privacyMaskWhenEncrypted,
                  })
                }
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 cursor-pointer ${
                  prefs.privacyMaskWhenEncrypted
                    ? 'bg-white border-white'
                    : 'bg-white/[0.06] border-white/[0.14] hover:border-white/[0.25]'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full transition-transform duration-150 ${
                    prefs.privacyMaskWhenEncrypted
                      ? 'translate-x-[22px] bg-[#0c0e14]'
                      : 'translate-x-[3px] bg-neutral-400'
                  }`}
                />
              </button>
            </div>

            {pushError && (
              <p className="text-xs text-amber-300/95 leading-relaxed select-text">{pushError}</p>
            )}

            <div className="pt-1 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-neutral-500">
                알림 배너에서 ‘10분 후 다시 알림’ 스누즈 및 ‘완료 처리’ 액션을 즉시 실행할 수 있습니다.
              </span>

              <button
                type="button"
                disabled={isTestingAlert}
                onClick={() => void handleRunTestAlert()}
                className="h-8 px-3.5 rounded-lg border border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-50 text-xs font-medium text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {isTestingAlert ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>3초 후 백그라운드 알림 검증</span>
              </button>
            </div>
          </section>

          {/* 04. 향후 14일 예약 알림 대기열 */}
          <section className="px-6 py-5 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-white">
                04. 예약된 알림 대기열 (향후 14일)
              </h3>
              <span className="text-[11px] font-mono text-neutral-500 tabular-nums">
                총 {upcomingAlerts.length}건
              </span>
            </div>

            {!prefs.enabled ? (
              <p className="py-4 text-xs text-neutral-500">
                알림 엔진이 비활성화되어 있습니다. 상단 스위치를 켜면 예정된 행사 일정이 자동으로 스케줄링됩니다.
              </p>
            ) : upcomingAlerts.length === 0 ? (
              <p className="py-4 text-xs text-neutral-500">
                향후 14일 이내에 발송 대기 중인 미완료 일정 알림이 없습니다.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.05] border-t border-b border-white/[0.05] max-h-56 overflow-y-auto">
                {upcomingAlerts.slice(0, 30).map((alert) => (
                  <div
                    key={alert.triggerId}
                    className="py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400 font-mono tabular-nums">
                        <Clock className="w-3 h-3 text-neutral-500 shrink-0" />
                        <span className="text-neutral-200">
                          {formatTriggerStamp(alert.triggerAtMs)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRelativeCountdown(alert.triggerAtMs, nowMs)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {alert.isSnoozed
                            ? '스누즈 연장'
                            : formatLeadMinutesLabel(alert.leadMinutes, true)}
                        </span>
                      </div>

                      {onSelectScheduledEvent ? (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onSelectScheduledEvent(
                              alert.masterEventId || alert.eventId,
                              alert.eventDate
                            );
                          }}
                          className="text-left text-xs font-medium text-neutral-100 hover:text-white hover:underline truncate block max-w-full cursor-pointer"
                        >
                          {alert.notificationBody}
                        </button>
                      ) : (
                        <p className="text-xs font-medium text-neutral-100 truncate">
                          {alert.notificationBody}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          void onSnoozeAlert(alert, 10);
                          showToast('해당 알림을 지금으로부터 10분 뒤로 연장했습니다.');
                        }}
                        className="h-7 px-2.5 rounded-md border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-[11px] text-neutral-300 hover:text-white tabular-nums transition-colors cursor-pointer whitespace-nowrap"
                      >
                        +10분
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onDismissAlert(alert.triggerId);
                          showToast('선택한 예정 알림을 대기열에서 제외했습니다.');
                        }}
                        aria-label="예약 알림 제외"
                        title="이 알림 제외"
                        className="h-7 w-7 rounded-md border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.08] text-neutral-500 hover:text-neutral-200 flex items-center justify-center transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* 하단 푸터 */}
        <div className="px-6 py-3.5 border-t border-white/[0.06] bg-[#0b0d13]/80 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-neutral-500">
            단축키 B로 언제든 알림 엔진 설정을 열 수 있습니다.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-4 rounded-lg bg-white text-[#0c0e14] hover:bg-neutral-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};
