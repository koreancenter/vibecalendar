import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  EyeOff,
  GitMerge,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import {
  CalendarCategory,
  CalendarSyncMode,
  ConnectedCalendarAccount,
  ProjectItem,
  SubscribedExternalCalendar,
  SyncConflictItem,
  SyncConflictPolicy,
  VaultExternalSyncState,
} from '../../types';
import { CALENDAR_CATEGORIES } from '../../constants/categories';
import { HelpTooltip } from '../common/HelpTooltip';

interface ExternalSyncHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  isVaultEncrypted: boolean;
  projects: ProjectItem[];
  syncState: VaultExternalSyncState;
  googleConfigured: boolean;
  hasGoogleSessionToken: boolean;
  microsoftStatus: {
    configured: boolean;
    callbackUrl: string;
  };
  isSyncing: boolean;
  syncingAccountId: string | null;
  hasCalDavPasswordInMemory: (accountId: string) => boolean;
  onConnectGoogle: () => Promise<void>;
  onConnectMicrosoft: () => Promise<void>;
  onConnectCalDav: (input: {
    serverUrl: string;
    username: string;
    appPassword: string;
    displayName?: string;
  }) => Promise<void>;
  onDisconnectAccount: (accountId: string, removeSyncedLocalEvents: boolean) => void;
  onUpdateCalendar: (
    accountId: string,
    calendarId: string,
    patch: Partial<
      Pick<
        SubscribedExternalCalendar,
        | 'enabled'
        | 'syncMode'
        | 'maskLabel'
        | 'boundProjectId'
        | 'pushLocalProjectEvents'
        | 'defaultCategory'
        | 'conflictPolicy'
      >
    >
  ) => void;
  onSetSessionCalDavPassword: (accountId: string, password: string) => void;
  onSyncAll: () => Promise<void>;
  onSyncAccount: (accountId: string) => Promise<void>;
  onResolveConflict: (conflictId: string, resolution: 'keep_local' | 'accept_remote') => void;
}

const CALDAV_PRESETS = [
  { id: 'icloud', label: 'Apple iCloud', url: 'https://caldav.icloud.com' },
  { id: 'fastmail', label: 'Fastmail', url: 'https://caldav.fastmail.com' },
  { id: 'nextcloud', label: 'Nextcloud', url: 'https://cloud.example.com/remote.php/dav' },
  { id: 'custom', label: '직접 입력', url: '' },
] as const;

export const ExternalSyncHubModal: React.FC<ExternalSyncHubModalProps> = ({
  isOpen,
  onClose,
  isVaultEncrypted,
  projects,
  syncState,
  googleConfigured,
  hasGoogleSessionToken,
  microsoftStatus,
  isSyncing,
  syncingAccountId,
  hasCalDavPasswordInMemory,
  onConnectGoogle,
  onConnectMicrosoft,
  onConnectCalDav,
  onDisconnectAccount,
  onUpdateCalendar,
  onSetSessionCalDavPassword,
  onSyncAll,
  onSyncAccount,
  onResolveConflict,
}) => {
  const [activeTab, setActiveTab] = useState<'accounts' | 'caldav' | 'conflicts'>('accounts');
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isConnectingMs, setIsConnectingMs] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [copiedCallback, setCopiedCallback] = useState(false);

  // CalDAV form state
  const [caldavPreset, setCaldavPreset] = useState<string>('icloud');
  const [caldavServerUrl, setCaldavServerUrl] = useState('https://caldav.icloud.com');
  const [caldavUsername, setCaldavUsername] = useState('');
  const [caldavPassword, setCaldavPassword] = useState('');
  const [caldavLabel, setCaldavLabel] = useState('');
  const [isDiscoveringCalDav, setIsDiscoveringCalDav] = useState(false);

  // Per-account session password prompt state (when browse mode cleared memory)
  const [reauthPasswords, setReauthPasswords] = useState<Record<string, string>>({});
  const [disconnectConfirmId, setDisconnectConfirmId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGoogleClick = async () => {
    setConnectError(null);
    setIsConnectingGoogle(true);
    try {
      await onConnectGoogle();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Google 연결 중 오류가 발생했습니다.');
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  const handleMicrosoftClick = async () => {
    setConnectError(null);
    setIsConnectingMs(true);
    try {
      await onConnectMicrosoft();
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message : 'Microsoft 연결 중 오류가 발생했습니다.'
      );
    } finally {
      setIsConnectingMs(false);
    }
  };

  const handleCalDavSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caldavServerUrl.trim() || !caldavUsername.trim() || !caldavPassword) {
      setConnectError('CalDAV 서버 주소, 계정 아이디, 앱 전용 비밀번호를 모두 입력해 주세요.');
      return;
    }
    setConnectError(null);
    setIsDiscoveringCalDav(true);
    try {
      await onConnectCalDav({
        serverUrl: caldavServerUrl,
        username: caldavUsername,
        appPassword: caldavPassword,
        displayName: caldavLabel,
      });
      setCaldavPassword('');
      setCaldavUsername('');
      setCaldavLabel('');
      setActiveTab('accounts');
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'CalDAV 서버 검색에 실패했습니다.');
    } finally {
      setIsDiscoveringCalDav(false);
    }
  };

  const handleCopyCallbackUrl = async () => {
    try {
      await navigator.clipboard.writeText(microsoftStatus.callbackUrl);
      setCopiedCallback(true);
      setTimeout(() => setCopiedCallback(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/75 backdrop-blur-xs px-3 sm:px-6 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="외부 클라우드 및 CalDAV 동기화 허브"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="luxury-glass-border w-full max-w-3xl h-[470px] max-h-[88vh] flex flex-col rounded-2xl bg-gradient-to-b from-[#161a24]/96 via-[#10131c]/96 to-[#0b0d14]/98 backdrop-blur-xl border border-white/[0.08] shadow-[0_28px_72px_-16px_rgba(0,0,0,0.85)] text-neutral-200 overflow-hidden select-none"
      >
        {/* Top Header */}
        <div className="px-5 sm:px-6 py-3.5 border-b border-white/[0.06] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-semibold text-white tracking-tight truncate">
              외부 캘린더 및 CalDAV 하이브리드 동기화
            </h2>
            <HelpTooltip
              title="외부 캘린더 및 CalDAV 하이브리드 동기화"
              content={
                <div className="space-y-1">
                  <p>
                    {isVaultEncrypted
                      ? 'AES-256-GCM 암호화 볼트 브릿지 활성: 암호화 키로 보호되는 볼트에 안전하게 브릿징됩니다.'
                      : '일반 세션 모드: 외부 캘린더 자격증명 및 토큰은 브라우저 메모리에만 격리 보관됩니다.'}
                  </p>
                  <p className="text-neutral-400">
                    현재 연결 계정 {syncState.accounts.length}개
                    {syncState.conflicts.length > 0
                      ? ` · 동기화 충돌 ${syncState.conflicts.length}건`
                      : ''}
                  </p>
                </div>
              }
              align="left"
              placement="bottom"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {syncState.accounts.length > 0 && (
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => void onSyncAll()}
                className="h-8 px-3.5 rounded-lg bg-white text-[#0c0e14] hover:bg-neutral-200 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? '동기화 중...' : '전체 동기화'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Segmented Bar */}
        <div className="px-5 sm:px-6 py-2 border-b border-white/[0.06] bg-white/[0.01] flex items-center gap-4 shrink-0">
          <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <button
              type="button"
              onClick={() => setActiveTab('accounts')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'accounts'
                  ? 'bg-white/[0.11] text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              연결 계정 및 동기화 정책 ({syncState.accounts.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('caldav')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'caldav'
                  ? 'bg-white/[0.11] text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              표준 CalDAV 서버 추가
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('conflicts')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'conflicts'
                  ? 'bg-white/[0.11] text-white'
                  : syncState.conflicts.length > 0
                  ? 'text-amber-300 hover:text-amber-200'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              3-Way 충돌 검토 ({syncState.conflicts.length})
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
          {connectError && (
            <div className="px-4 py-3 rounded-lg border border-amber-400/25 bg-amber-500/[0.07] flex items-start justify-between gap-3 text-xs text-amber-200 select-text">
              <div className="flex items-start gap-2 leading-relaxed">
                <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                <span>{connectError}</span>
              </div>
              <button
                type="button"
                onClick={() => setConnectError(null)}
                className="text-amber-300/70 hover:text-amber-100 shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {activeTab === 'accounts' && (
            <>
              {/* OAuth 2.0 Quick Connect Panel */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs px-0.5">
                  <h3 className="font-semibold text-white">클라우드 캘린더 빠른 연동</h3>
                  <span className="text-[11px] text-neutral-400">
                    최초 연결 시 읽기 전용 마스킹 모드로 안전하게 연동됩니다
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {/* 1. Official Sign in with Google Card */}
                  <div className="rounded-xl border border-white/[0.06] bg-[#0c0e14]/85 p-3.5 flex flex-col justify-between h-full gap-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-white truncate">Google Calendar</span>
                        <HelpTooltip
                          title="Google Calendar 연동"
                          content="구독 중인 Google 캘린더 목록을 조회하고 증분 syncToken 동기화를 통해 개인정보 보호 마스킹 또는 양방향 동기화를 수행합니다."
                          align="left"
                          placement="bottom"
                        />
                      </div>
                      <span className="text-[11px] text-neutral-400 shrink-0">
                        {hasGoogleSessionToken
                          ? '토큰 활성'
                          : googleConfigured
                          ? 'OAuth 2.0 준비됨'
                          : '환경변수 필요'}
                      </span>
                    </div>

                    <div className="space-y-1.5 pt-0.5">
                      <button
                        type="button"
                        disabled={isConnectingGoogle}
                        onClick={() => void handleGoogleClick()}
                        className="w-full h-9.5 px-3 rounded-lg bg-white hover:bg-neutral-100 text-[#1f1f1f] border border-neutral-300 text-xs font-semibold inline-flex items-center justify-center gap-2.5 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 shadow-xs"
                      >
                        {isConnectingGoogle ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-700" />
                        ) : (
                          <svg
                            version="1.1"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 48 48"
                            className="w-4 h-4 shrink-0 block"
                          >
                            <path
                              fill="#EA4335"
                              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                            />
                            <path
                              fill="#4285F4"
                              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                            />
                            <path
                              fill="#34A853"
                              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                            />
                          </svg>
                        )}
                        <span>Sign in with Google</span>
                      </button>

                      <div className="h-5 flex items-center text-[10.5px] text-neutral-400 font-mono truncate select-text">
                        {!googleConfigured ? (
                          <span className="truncate">VITE_GOOGLE_CLIENT_ID 필요</span>
                        ) : hasGoogleSessionToken ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <Check className="w-3 h-3 shrink-0" />
                            <span>세션 토큰 활성</span>
                          </span>
                        ) : (
                          <span className="truncate">OAuth 2.0 연동 준비됨</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 2. Microsoft Graph API OAuth 2.0 + PKCE Card */}
                  <div className="rounded-xl border border-white/[0.06] bg-[#0c0e14]/85 p-3.5 flex flex-col justify-between h-full gap-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-white whitespace-nowrap">Microsoft 365</span>
                        <HelpTooltip
                          title="Microsoft 365 · Outlook 연동"
                          content="Microsoft Graph deltaLink 증분 동기화 및 Windows 타임존 자동 변환을 지원하여 Outlook 일정을 안전하게 동기화합니다."
                          align="left"
                          placement="bottom"
                        />
                      </div>
                      <span className="text-[11px] text-neutral-400 shrink-0">
                        {microsoftStatus.configured ? 'PKCE 활성' : '환경변수 필요'}
                      </span>
                    </div>

                    <div className="space-y-1.5 pt-0.5">
                      <button
                        type="button"
                        disabled={isConnectingMs}
                        onClick={() => void handleMicrosoftClick()}
                        className="w-full h-9.5 px-3 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-xs font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
                      >
                        {isConnectingMs ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Globe className="w-3.5 h-3.5 text-sky-300" />
                        )}
                        <span>Microsoft 계정 연결</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleCopyCallbackUrl()}
                        title={microsoftStatus.callbackUrl}
                        className="w-full h-5 flex items-center justify-between gap-1.5 text-[10.5px] text-neutral-400 hover:text-neutral-200 font-mono truncate cursor-pointer"
                      >
                        <span className="truncate">Callback: {microsoftStatus.callbackUrl}</span>
                        {copiedCallback ? (
                          <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                        ) : (
                          <Copy className="w-3 h-3 shrink-0" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 3. Standard CalDAV RFC 4791 Card */}
                  <div className="rounded-xl border border-white/[0.06] bg-[#0c0e14]/85 p-3.5 flex flex-col justify-between h-full gap-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-white truncate">표준 CalDAV (RFC 4791)</span>
                        <HelpTooltip
                          title="표준 CalDAV (RFC 4791) 연동"
                          content="Apple iCloud, Fastmail, Nextcloud, Synology 등 RFC 4791 규격을 준수하는 표준 CalDAV 서버와 양방향 연동합니다."
                          align="left"
                          placement="bottom"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => setActiveTab('caldav')}
                        className="w-full h-9.5 px-3 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-xs font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Server className="w-3.5 h-3.5 text-indigo-300" />
                        <span>CalDAV 서버 설정 열기</span>
                      </button>

                      <div className="h-5 flex items-center text-[10.5px] text-neutral-400 font-mono truncate">
                        <span className="truncate">RFC 4791 표준 · 앱 비밀번호 지원</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Connected Accounts & Per-Calendar Sync Mode Configuration */}
              {syncState.accounts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-4 py-3 text-center">
                  <p className="text-xs text-neutral-400">
                    아직 연결된 계정이 없습니다. 상단 서비스 버튼을 통해 캘린더를 연동해 보세요.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {syncState.accounts.map((acc) => {
                    const isThisSyncing =
                      isSyncing && (syncingAccountId === 'all' || syncingAccountId === acc.id);
                    const needsCalDavSessionPw =
                      acc.provider === 'caldav' &&
                      !acc.caldavConfig?.appPassword &&
                      !hasCalDavPasswordInMemory(acc.id);

                    return (
                      <div
                        key={acc.id}
                        className="rounded-xl border border-white/[0.07] bg-[#12151f]/75 overflow-hidden"
                      >
                        {/* Account Row Header */}
                        <div className="px-5 py-3.5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-semibold text-white truncate">
                                {acc.displayName}
                              </span>
                              <span aria-hidden="true" className="text-neutral-600">
                                ·
                              </span>
                              <span className="text-neutral-400 uppercase text-[11px]">
                                {acc.provider}
                              </span>
                              <span aria-hidden="true" className="text-neutral-600">
                                ·
                              </span>
                              <span
                                className={`text-[11px] ${
                                  acc.status === 'connected' && !needsCalDavSessionPw
                                    ? 'text-emerald-300'
                                    : 'text-amber-300'
                                }`}
                              >
                                {needsCalDavSessionPw
                                  ? '세션 비밀번호 입력 필요'
                                  : acc.status === 'connected'
                                  ? '정상 연결됨'
                                  : acc.status === 'reauth_required'
                                  ? '재인증 필요'
                                  : '동기화 오류'}
                              </span>
                            </div>
                            {acc.errorMessage && (
                              <p className="text-[11px] text-amber-300/90 mt-1 select-text">
                                {acc.errorMessage}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {acc.provider === 'google' && !hasGoogleSessionToken && (
                              <button
                                type="button"
                                onClick={() => void handleGoogleClick()}
                                className="h-7 px-2.5 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-[11px] font-medium text-white cursor-pointer whitespace-nowrap"
                              >
                                Google 토큰 갱신
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={isSyncing}
                              onClick={() => void onSyncAccount(acc.id)}
                              className="h-7 px-2.5 rounded-md border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.1] text-[11px] text-neutral-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
                            >
                              <RefreshCw
                                className={`w-3 h-3 ${isThisSyncing ? 'animate-spin' : ''}`}
                              />
                              <span>동기화</span>
                            </button>

                            {disconnectConfirmId === acc.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDisconnectAccount(acc.id, true);
                                    setDisconnectConfirmId(null);
                                  }}
                                  className="h-7 px-2 rounded-md bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-[11px] text-rose-200 cursor-pointer whitespace-nowrap"
                                >
                                  일정까지 정리
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDisconnectAccount(acc.id, false);
                                    setDisconnectConfirmId(null);
                                  }}
                                  className="h-7 px-2 rounded-md bg-white/[0.07] hover:bg-white/[0.12] text-[11px] text-neutral-200 cursor-pointer whitespace-nowrap"
                                >
                                  사본 남기고 해제
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDisconnectConfirmId(null)}
                                  className="h-7 px-1.5 text-[11px] text-neutral-400 hover:text-white cursor-pointer"
                                >
                                  취소
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDisconnectConfirmId(acc.id)}
                                aria-label="계정 연결 해제"
                                className="h-7 w-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Ephemeral CalDAV Password Re-entry Banner in Unencrypted Browse Mode */}
                        {needsCalDavSessionPw && (
                          <div className="px-5 py-3 border-b border-white/[0.06] bg-amber-500/[0.05] flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs text-amber-200 flex items-center gap-1.5">
                              <KeyRound className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                일반 모드에서는 CalDAV 앱 비밀번호를 평문 저장하지 않습니다. 현재 세션용 비밀번호를 입력해 주세요.
                              </span>
                            </span>
                            <div className="flex items-center gap-2">
                              <input
                                type="password"
                                placeholder="앱 전용 비밀번호"
                                value={reauthPasswords[acc.id] || ''}
                                onChange={(e) =>
                                  setReauthPasswords((p) => ({ ...p, [acc.id]: e.target.value }))
                                }
                                className="h-7 px-2.5 rounded-md bg-[#0c0e14] border border-white/[0.12] text-xs text-white outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const pw = reauthPasswords[acc.id];
                                  if (pw) {
                                    onSetSessionCalDavPassword(acc.id, pw);
                                    setReauthPasswords((p) => ({ ...p, [acc.id]: '' }));
                                  }
                                }}
                                className="h-7 px-3 rounded-md bg-white text-[#0c0e14] text-xs font-semibold cursor-pointer whitespace-nowrap"
                              >
                                세션 적용
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Subscribed Calendars Table */}
                        <div className="divide-y divide-white/[0.05]">
                          {acc.calendars.map((cal) => {
                            const isMasked = cal.syncMode === 'read_only_masking';
                            return (
                              <div key={cal.id} className="px-5 py-3.5 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <label className="flex items-center gap-2.5 cursor-pointer min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={cal.enabled}
                                      onChange={(e) =>
                                        onUpdateCalendar(acc.id, cal.id, {
                                          enabled: e.target.checked,
                                        })
                                      }
                                      className="accent-white w-3.5 h-3.5 cursor-pointer shrink-0"
                                    />
                                    <span
                                      aria-hidden="true"
                                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                                      style={{ backgroundColor: cal.color }}
                                    />
                                    <span className="text-xs font-medium text-white truncate">
                                      {cal.name}
                                    </span>
                                    {cal.readOnlyRemote && (
                                      <span className="text-[11px] text-neutral-500 whitespace-nowrap">
                                        · 원격 읽기 전용
                                      </span>
                                    )}
                                  </label>

                                  {/* Sync Mode Segmented Switch */}
                                  <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[#0c0e14] border border-white/[0.07] shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onUpdateCalendar(acc.id, cal.id, {
                                          syncMode: 'read_only_masking',
                                        })
                                      }
                                      className={`h-6 px-2.5 rounded-md text-[11px] inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                                        isMasked
                                          ? 'bg-white/[0.12] text-white font-medium'
                                          : 'text-neutral-500 hover:text-neutral-300'
                                      }`}
                                    >
                                      <EyeOff className="w-3 h-3 shrink-0" />
                                      <span>읽기 전용 마스킹</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={Boolean(cal.readOnlyRemote)}
                                      onClick={() =>
                                        onUpdateCalendar(acc.id, cal.id, {
                                          syncMode: 'bidirectional_hybrid',
                                        })
                                      }
                                      title={
                                        cal.readOnlyRemote
                                          ? '원격 캘린더에 쓰기 권한이 없어 양방향 동기화를 켤 수 없습니다'
                                          : '양방향 하이브리드 동기화'
                                      }
                                      className={`h-6 px-2.5 rounded-md text-[11px] inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-35 disabled:cursor-not-allowed ${
                                        !isMasked
                                          ? 'bg-white/[0.12] text-white font-medium'
                                          : 'text-neutral-500 hover:text-neutral-300'
                                      }`}
                                    >
                                      <GitMerge className="w-3 h-3 shrink-0" />
                                      <span>양방향 하이브리드</span>
                                    </button>
                                  </div>
                                </div>

                                {cal.enabled && (
                                  <div className="pl-6 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                                    {isMasked ? (
                                      <div className="sm:col-span-2">
                                        <label className="block text-[11px] text-neutral-500 mb-1">
                                          개인정보 보호 마스킹 표시명 (원본 제목·장소·메모 비노출)
                                        </label>
                                        <input
                                          type="text"
                                          value={cal.maskLabel}
                                          onChange={(e) =>
                                            onUpdateCalendar(acc.id, cal.id, {
                                              maskLabel: e.target.value,
                                            })
                                          }
                                          placeholder={`외부 일정 (${cal.name})`}
                                          className="w-full h-8 px-2.5 rounded-md bg-[#0c0e14] border border-white/[0.08] text-xs text-neutral-200 focus:border-white/25 outline-none"
                                        />
                                      </div>
                                    ) : (
                                      <>
                                        <div>
                                          <label className="block text-[11px] text-neutral-500 mb-1">
                                            연결 로컬 프로젝트
                                          </label>
                                          <select
                                            value={cal.boundProjectId || ''}
                                            onChange={(e) =>
                                              onUpdateCalendar(acc.id, cal.id, {
                                                boundProjectId: e.target.value || undefined,
                                              })
                                            }
                                            className="w-full h-8 px-2 rounded-md bg-[#0c0e14] border border-white/[0.08] text-xs text-neutral-200 outline-none"
                                          >
                                            <option value="">프로젝트 지정 안 함</option>
                                            {projects.map((p) => (
                                              <option key={p.id} value={p.id}>
                                                {p.name}
                                              </option>
                                            ))}
                                          </select>
                                        </div>

                                        <div>
                                          <label className="block text-[11px] text-neutral-500 mb-1">
                                            동시 수정 충돌 정책
                                          </label>
                                          <select
                                            value={cal.conflictPolicy}
                                            onChange={(e) =>
                                              onUpdateCalendar(acc.id, cal.id, {
                                                conflictPolicy: e.target
                                                  .value as SyncConflictPolicy,
                                              })
                                            }
                                            className="w-full h-8 px-2 rounded-md bg-[#0c0e14] border border-white/[0.08] text-xs text-neutral-200 outline-none"
                                          >
                                            <option value="manual_review">수동 비교 검토</option>
                                            <option value="prefer_local">로컬 볼트 우선</option>
                                            <option value="prefer_remote">원격 클라우드 우선</option>
                                          </select>
                                        </div>
                                      </>
                                    )}

                                    <div>
                                      <label className="block text-[11px] text-neutral-500 mb-1">
                                        기본 분류
                                      </label>
                                      <select
                                        value={cal.defaultCategory}
                                        onChange={(e) =>
                                          onUpdateCalendar(acc.id, cal.id, {
                                            defaultCategory: e.target.value as CalendarCategory,
                                          })
                                        }
                                        className="w-full h-8 px-2 rounded-md bg-[#0c0e14] border border-white/[0.08] text-xs text-neutral-200 outline-none"
                                      >
                                        {CALENDAR_CATEGORIES.map((cat) => (
                                          <option key={cat} value={cat}>
                                            {cat}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    {!isMasked && cal.boundProjectId && (
                                      <label className="sm:col-span-3 flex items-center gap-2 text-[11px] text-neutral-400 cursor-pointer pt-0.5">
                                        <input
                                          type="checkbox"
                                          checked={cal.pushLocalProjectEvents}
                                          onChange={(e) =>
                                            onUpdateCalendar(acc.id, cal.id, {
                                              pushLocalProjectEvents: e.target.checked,
                                            })
                                          }
                                          className="accent-white w-3.5 h-3.5 cursor-pointer"
                                        />
                                        <span>
                                          이 프로젝트에 새로 작성한 로컬 일정도 승인 후 원격 캘린더({cal.name})로 함께 내보내기
                                        </span>
                                      </label>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeTab === 'caldav' && (
            <form
              onSubmit={(e) => void handleCalDavSubmit(e)}
              className="space-y-3.5 pt-1"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <h3 className="text-sm font-semibold text-white">
                  표준 CalDAV 계정 연결 (RFC 4791)
                </h3>
                <span className="text-[11px] text-neutral-400">
                  앱 전용 비밀번호(App Password) 지원
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {CALDAV_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setCaldavPreset(preset.id);
                      if (preset.url) setCaldavServerUrl(preset.url);
                    }}
                    className={`h-6.5 px-2.5 rounded-md text-[11px] transition-colors cursor-pointer whitespace-nowrap ${
                      caldavPreset === preset.id
                        ? 'bg-white text-[#0c0e14] font-semibold'
                        : 'bg-white/[0.04] hover:bg-white/[0.08] text-neutral-300 border border-white/[0.06]'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-neutral-400 mb-1">
                    CalDAV 서버 URL (HTTPS 필수)
                  </label>
                  <input
                    type="url"
                    required
                    value={caldavServerUrl}
                    onChange={(e) => setCaldavServerUrl(e.target.value)}
                    placeholder="https://caldav.icloud.com"
                    className="w-full h-8.5 px-3 rounded-lg bg-[#0c0e14] border border-white/[0.1] text-xs text-white font-mono focus:border-white/30 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">
                    계정 아이디 또는 이메일
                  </label>
                  <input
                    type="text"
                    required
                    value={caldavUsername}
                    onChange={(e) => setCaldavUsername(e.target.value)}
                    placeholder="user@icloud.com"
                    className="w-full h-8.5 px-3 rounded-lg bg-[#0c0e14] border border-white/[0.1] text-xs text-white focus:border-white/30 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">
                    앱 전용 비밀번호 (App Password)
                  </label>
                  <input
                    type="password"
                    required
                    value={caldavPassword}
                    onChange={(e) => setCaldavPassword(e.target.value)}
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    className="w-full h-8.5 px-3 rounded-lg bg-[#0c0e14] border border-white/[0.1] text-xs text-white focus:border-white/30 outline-none"
                  />
                </div>

                <div className="sm:col-span-2 flex items-center gap-3 pt-1">
                  <label className="text-xs text-neutral-300 font-medium whitespace-nowrap shrink-0">
                    표시 설정 <span className="text-neutral-500 font-normal">(선택)</span>
                  </label>
                  <input
                    type="text"
                    value={caldavLabel}
                    onChange={(e) => setCaldavLabel(e.target.value)}
                    placeholder="예: 개인 iCloud 캘린더 (미입력 시 서버 주소로 자동 지정)"
                    className="flex-1 h-8.5 px-3 rounded-lg bg-[#0c0e14] border border-white/[0.1] text-xs text-white placeholder:text-neutral-500 focus:border-white/30 outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('accounts')}
                  className="h-8.5 px-3.5 rounded-lg border border-white/[0.08] text-xs text-neutral-300 hover:bg-white/[0.05] cursor-pointer whitespace-nowrap"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isDiscoveringCalDav}
                  className="h-8.5 px-4 rounded-lg bg-white text-[#0c0e14] hover:bg-neutral-200 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  {isDiscoveringCalDav ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>PROPFIND 검색 중...</span>
                    </>
                  ) : (
                    <span>CalDAV 컬렉션 검색 및 연결</span>
                  )}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'conflicts' && (
            <div>
              {syncState.conflicts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-8 text-center space-y-2">
                  <GitMerge className="w-5 h-5 text-neutral-500 mx-auto" />
                  <p className="text-xs sm:text-sm font-medium text-neutral-200">
                    검토가 필요한 양방향 동기화 충돌이 없습니다
                  </p>
                  <p className="text-[11px] text-neutral-500 max-w-md mx-auto leading-relaxed">
                    로컬 볼트와 외부 클라우드에서 동일한 일정을 동시에 수정한 경우에만 이곳에 충돌 해결 카드가 표시됩니다.
                  </p>
                </div>
              ) : (
                syncState.conflicts.map((conflict: SyncConflictItem) => (
                  <div
                    key={conflict.id}
                    className="rounded-xl border border-amber-400/20 bg-[#12151f]/85 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-neutral-400">
                      <span>
                        {conflict.provider.toUpperCase()} · {conflict.calendarName}
                      </span>
                      <span className="font-mono tabular-nums text-[11px]">
                        감지 시각 {conflict.detectedAt.slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-white/[0.07] bg-[#0c0e14] p-3.5 space-y-1.5">
                        <div className="text-[11px] font-medium text-sky-300">
                          로컬 암호화 볼트 버전
                        </div>
                        <div className="text-xs font-semibold text-white">
                          {conflict.localSnapshot.title}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-neutral-400">
                          {conflict.localSnapshot.date}{' '}
                          {conflict.localSnapshot.isAllDay
                            ? '종일'
                            : `${conflict.localSnapshot.startTime}–${conflict.localSnapshot.endTime}`}
                        </div>
                        {conflict.localSnapshot.location && (
                          <div className="text-[11px] text-neutral-400 truncate">
                            {conflict.localSnapshot.location}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => onResolveConflict(conflict.id, 'keep_local')}
                          className="mt-2 h-7 px-3 rounded-md bg-white/[0.08] hover:bg-white/[0.15] text-[11px] font-medium text-white cursor-pointer whitespace-nowrap"
                        >
                          로컬 버전 유지 (다음 동기화 시 원격 덮어쓰기)
                        </button>
                      </div>

                      <div className="rounded-lg border border-white/[0.07] bg-[#0c0e14] p-3.5 space-y-1.5">
                        <div className="text-[11px] font-medium text-emerald-300">
                          원격 클라우드 버전
                        </div>
                        <div className="text-xs font-semibold text-white">
                          {conflict.remoteSnapshot.title}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-neutral-400">
                          {conflict.remoteSnapshot.date}{' '}
                          {conflict.remoteSnapshot.isAllDay
                            ? '종일'
                            : `${conflict.remoteSnapshot.startTime}–${conflict.remoteSnapshot.endTime}`}
                        </div>
                        {conflict.remoteSnapshot.location && (
                          <div className="text-[11px] text-neutral-400 truncate">
                            {conflict.remoteSnapshot.location}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => onResolveConflict(conflict.id, 'accept_remote')}
                          className="mt-2 h-7 px-3 rounded-md bg-white text-[#0c0e14] hover:bg-neutral-200 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                        >
                          원격 버전 수용
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
