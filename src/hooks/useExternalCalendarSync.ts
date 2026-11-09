import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCategory,
  CalendarEventItem,
  CalendarSyncMode,
  ConnectedCalendarAccount,
  PendingOutboundDeletion,
  SubscribedExternalCalendar,
  SyncConflictItem,
  SyncConflictPolicy,
  VaultExternalSyncState,
} from '../types';
import { RecordEventHistoryMeta } from './useEventHistory';
import {
  clearCachedGoogleAccessToken,
  getCachedGoogleAccessToken,
  isGoogleClientConfigured,
  listGoogleCalendars,
  pullGoogleCalendarDelta,
  pushGoogleCalendarMutations,
  signInWithGoogleCalendar,
} from '../services/sync/googleCalendarClient';
import {
  applySyncModeTransitionToEvents,
  buildOutboundMutationPlan,
  computeSyncableEventHash,
  OutboundMutationPlanItem,
  reconcileInboundCalendarDelta,
} from '../services/sync/syncEngine';
import { NormalizedRemoteEventPayload } from '../shared/icsSyncCodec';
import { enqueueOfflineSyncTask } from '../services/notifications/notificationIdb';
import { registerBackgroundSyncTags } from '../services/notifications/pushClient';

const SYNC_META_STORAGE_KEY = 'vibe_external_sync_meta_v1';

export interface VaultSyncStateConfig {
  isEncrypted: boolean;
  initialSyncState?: VaultExternalSyncState;
  onEncryptedSyncStateChange: (syncState: VaultExternalSyncState) => void;
}

export interface UseExternalCalendarSyncOptions {
  events: CalendarEventItem[];
  viewerTimeZone: string;
  applyEventsWithHistory: (
    computeNext: CalendarEventItem[] | ((prev: CalendarEventItem[]) => CalendarEventItem[]),
    meta: RecordEventHistoryMeta
  ) => boolean;
  showToast: (msg: string, onUndo?: () => void) => void;
  vaultSyncConfig?: VaultSyncStateConfig;
}

function createEmptySyncState(): VaultExternalSyncState {
  return {
    accounts: [],
    pendingDeletions: [],
    conflicts: [],
  };
}

function readPlaintextSyncState(): VaultExternalSyncState {
  try {
    const raw = localStorage.getItem(SYNC_META_STORAGE_KEY);
    if (!raw) return createEmptySyncState();
    const parsed = JSON.parse(raw) as Partial<VaultExternalSyncState>;
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      pendingDeletions: Array.isArray(parsed.pendingDeletions) ? parsed.pendingDeletions : [],
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    };
  } catch {
    return createEmptySyncState();
  }
}

export function useExternalCalendarSync({
  events,
  viewerTimeZone,
  applyEventsWithHistory,
  showToast,
  vaultSyncConfig,
}: UseExternalCalendarSyncOptions) {
  const [syncState, setSyncState] = useState<VaultExternalSyncState>(() => {
    if (vaultSyncConfig?.isEncrypted) {
      return vaultSyncConfig.initialSyncState ?? createEmptySyncState();
    }
    return readPlaintextSyncState();
  });

  const syncStateRef = useRef(syncState);
  syncStateRef.current = syncState;

  const eventsRef = useRef(events);
  eventsRef.current = events;

  // Ephemeral in-memory CalDAV password map for unencrypted browse sessions (never persisted to plaintext localStorage)
  const sessionCalDavPasswordsRef = useRef<Map<string, string>>(new Map());

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [pendingOutboundPlan, setPendingOutboundPlan] = useState<OutboundMutationPlanItem[] | null>(
    null
  );
  const [isExecutingOutbound, setIsExecutingOutbound] = useState(false);
  const [microsoftStatus, setMicrosoftStatus] = useState<{
    configured: boolean;
    callbackUrl: string;
  }>({
    configured: false,
    callbackUrl: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/microsoft/callback`,
  });

  // Persist syncState either into AES-256-GCM vault or stripped metadata in browse mode
  useEffect(() => {
    if (vaultSyncConfig?.isEncrypted) {
      vaultSyncConfig.onEncryptedSyncStateChange(syncState);
      return;
    }
    try {
      const stripped: VaultExternalSyncState = {
        ...syncState,
        accounts: syncState.accounts.map((acc) =>
          acc.caldavConfig
            ? {
                ...acc,
                caldavConfig: {
                  ...acc.caldavConfig,
                  appPassword: undefined,
                },
              }
            : acc
        ),
      };
      localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(stripped));
    } catch {
      // ignore storage quota errors
    }
  }, [syncState, vaultSyncConfig]);

  // Clear in-memory Google access token & session CalDAV passwords on unmount (e.g. Vault lock ⌘L)
  useEffect(() => {
    return () => {
      clearCachedGoogleAccessToken(false);
      sessionCalDavPasswordsRef.current.clear();
    };
  }, []);

  // Probe Microsoft Graph server status & exact callback URL
  useEffect(() => {
    let active = true;
    const originParam = encodeURIComponent(window.location.origin);
    fetch(`/api/auth/microsoft/status?origin=${originParam}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setMicrosoftStatus({
          configured: Boolean(data.configured),
          callbackUrl:
            typeof data.callbackUrl === 'string' && data.callbackUrl
              ? data.callbackUrl
              : `${window.location.origin}/auth/microsoft/callback`,
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Listen for Microsoft OAuth 2.0 popup postMessage completion
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // 오직 현재 애플리케이션과 완전히 일치하는 출처(Origin)만 신뢰 (외부 Cloud Run 도메인 스푸핑 차단)
      if (origin !== window.location.origin) return;

      const payload = event.data as Record<string, unknown> | null;
      if (!payload || typeof payload !== 'object') return;

      if (payload.type === 'OAUTH_AUTH_ERROR' && payload.provider === 'microsoft') {
        showToast(
          typeof payload.error === 'string' && payload.error
            ? `Microsoft 인증 실패: ${payload.error}`
            : 'Microsoft 인증이 취소되었거나 실패했습니다.'
        );
        return;
      }

      if (payload.type === 'OAUTH_AUTH_SUCCESS' && payload.provider === 'microsoft') {
        const sessionHandle = String(payload.sessionHandle || '');
        const accountEmail = String(payload.accountEmail || 'outlook@microsoft.com');
        const displayName = String(payload.displayName || accountEmail);
        if (!sessionHandle) return;

        try {
          const calRes = await fetch('/api/sync/microsoft/calendars', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionHandle }),
          });
          const calData = (await calRes.json().catch(() => ({}))) as {
            calendars?: Array<{
              remoteCalendarId: string;
              name: string;
              color: string;
              readOnlyRemote: boolean;
              isPrimary: boolean;
            }>;
            error?: string;
          };

          if (!calRes.ok || !Array.isArray(calData.calendars)) {
            throw new Error(calData.error || 'Microsoft 캘린더 목록을 불러오지 못했습니다.');
          }

          const nowIso = new Date().toISOString();
          setSyncState((prev) => {
            const existingAcc = prev.accounts.find(
              (a) =>
                a.provider === 'microsoft' &&
                a.accountEmail.toLowerCase() === accountEmail.toLowerCase()
            );

            const mergedCalendars: SubscribedExternalCalendar[] = calData.calendars!.map(
              (rc, idx) => {
                const prevCal = existingAcc?.calendars.find(
                  (c) => c.remoteCalendarId === rc.remoteCalendarId
                );
                if (prevCal) {
                  return {
                    ...prevCal,
                    name: rc.name,
                    color: rc.color,
                    readOnlyRemote: rc.readOnlyRemote,
                  };
                }
                return {
                  id: `mscal-${Date.now()}-${idx}`,
                  remoteCalendarId: rc.remoteCalendarId,
                  name: rc.name,
                  color: rc.color,
                  enabled: rc.isPrimary || idx === 0,
                  readOnlyRemote: rc.readOnlyRemote,
                  syncMode: 'read_only_masking',
                  maskLabel: `외부 일정 (${rc.name})`,
                  pushLocalProjectEvents: false,
                  defaultCategory: '업무',
                  conflictPolicy: 'manual_review',
                };
              }
            );

            const updatedAccount: ConnectedCalendarAccount = existingAcc
              ? {
                  ...existingAcc,
                  displayName,
                  status: 'connected',
                  errorMessage: undefined,
                  microsoftSessionHandle: sessionHandle,
                  calendars: mergedCalendars,
                }
              : {
                  id: `acc-ms-${Date.now()}`,
                  provider: 'microsoft',
                  accountEmail,
                  displayName,
                  status: 'connected',
                  createdAt: nowIso,
                  microsoftSessionHandle: sessionHandle,
                  calendars: mergedCalendars,
                };

            return {
              ...prev,
              accounts: existingAcc
                ? prev.accounts.map((a) => (a.id === existingAcc.id ? updatedAccount : a))
                : [...prev.accounts, updatedAccount],
            };
          });

          showToast(
            `Microsoft 계정(${accountEmail})이 연결되었습니다. 캘린더 동기화 모드를 확인 후 동기화를 실행해 보세요.`
          );
        } catch (err) {
          showToast(
            err instanceof Error ? err.message : 'Microsoft 계정 초기화 중 오류가 발생했습니다.'
          );
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [showToast]);

  const connectGoogleAccount = useCallback(async () => {
    const authRes = await signInWithGoogleCalendar();
    const remoteCals = await listGoogleCalendars(authRes.accessToken);
    const nowIso = new Date().toISOString();

    setSyncState((prev) => {
      const existingAcc = prev.accounts.find(
        (a) =>
          a.provider === 'google' &&
          a.accountEmail.toLowerCase() === authRes.accountEmail.toLowerCase()
      );

      const mergedCalendars: SubscribedExternalCalendar[] = remoteCals.map((rc, idx) => {
        const prevCal = existingAcc?.calendars.find(
          (c) => c.remoteCalendarId === rc.remoteCalendarId
        );
        if (prevCal) {
          return {
            ...prevCal,
            name: rc.name,
            color: rc.color,
            readOnlyRemote: rc.readOnlyRemote,
          };
        }
        return {
          id: `gcal-${Date.now()}-${idx}`,
          remoteCalendarId: rc.remoteCalendarId,
          name: rc.name,
          color: rc.color,
          enabled: rc.isPrimary || idx === 0,
          readOnlyRemote: rc.readOnlyRemote,
          syncMode: 'read_only_masking',
          maskLabel: `외부 일정 (${rc.name})`,
          pushLocalProjectEvents: false,
          defaultCategory: '업무',
          conflictPolicy: 'manual_review',
        };
      });

      const nextAccount: ConnectedCalendarAccount = existingAcc
        ? {
            ...existingAcc,
            displayName: authRes.displayName,
            status: 'connected',
            errorMessage: undefined,
            calendars: mergedCalendars,
          }
        : {
            id: `acc-google-${Date.now()}`,
            provider: 'google',
            accountEmail: authRes.accountEmail,
            displayName: authRes.displayName,
            status: 'connected',
            createdAt: nowIso,
            calendars: mergedCalendars,
          };

      return {
        ...prev,
        accounts: existingAcc
          ? prev.accounts.map((a) => (a.id === existingAcc.id ? nextAccount : a))
          : [...prev.accounts, nextAccount],
      };
    });

    showToast(`Google Calendar (${authRes.accountEmail}) 연결이 완료되었습니다.`);
  }, [showToast]);

  const connectMicrosoftAccount = useCallback(async () => {
    const originParam = encodeURIComponent(window.location.origin);
    const res = await fetch(`/api/auth/microsoft/url?origin=${originParam}`);
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      throw new Error(data.error || 'Microsoft OAuth 인증 URL을 생성하지 못했습니다.');
    }

    const popup = window.open(
      data.url,
      'microsoft_oauth_popup',
      'width=600,height=720,menubar=no,toolbar=no,status=no'
    );
    if (!popup) {
      showToast('브라우저에서 팝업이 차단되었습니다. 팝업 허용 후 다시 시도해 주세요.');
    }
  }, [showToast]);

  const connectCalDavAccount = useCallback(
    async (input: {
      serverUrl: string;
      username: string;
      appPassword: string;
      displayName?: string;
    }) => {
      const res = await fetch('/api/sync/caldav/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverUrl: input.serverUrl.trim(),
          username: input.username.trim(),
          appPassword: input.appPassword,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        normalizedServerUrl?: string;
        principalUrl?: string;
        calendarHomeUrl?: string;
        calendars?: Array<{
          remoteCalendarId: string;
          name: string;
          color: string;
          ctag?: string;
          syncToken?: string;
          readOnlyRemote: boolean;
        }>;
        error?: string;
      };

      if (!res.ok || !Array.isArray(data.calendars)) {
        throw new Error(data.error || 'CalDAV 서버 연결에 실패했습니다.');
      }

      const nowIso = new Date().toISOString();
      const accountId = `acc-caldav-${Date.now()}`;
      sessionCalDavPasswordsRef.current.set(accountId, input.appPassword);

      const newAccount: ConnectedCalendarAccount = {
        id: accountId,
        provider: 'caldav',
        accountEmail: input.username.trim(),
        displayName:
          input.displayName?.trim() ||
          `${new URL(data.normalizedServerUrl || 'https://caldav.local').hostname} (${input.username.trim()})`,
        status: 'connected',
        createdAt: nowIso,
        caldavConfig: {
          serverUrl: data.normalizedServerUrl || input.serverUrl.trim(),
          username: input.username.trim(),
          appPassword: vaultSyncConfig?.isEncrypted ? input.appPassword : undefined,
          principalUrl: data.principalUrl,
          calendarHomeUrl: data.calendarHomeUrl,
        },
        calendars: data.calendars.map((rc, idx) => ({
          id: `caldav-cal-${Date.now()}-${idx}`,
          remoteCalendarId: rc.remoteCalendarId,
          name: rc.name,
          color: rc.color,
          enabled: idx === 0,
          readOnlyRemote: rc.readOnlyRemote,
          syncMode: 'read_only_masking',
          maskLabel: `외부 일정 (${rc.name})`,
          pushLocalProjectEvents: false,
          defaultCategory: '업무',
          conflictPolicy: 'manual_review',
        })),
      };

      setSyncState((prev) => ({
        ...prev,
        accounts: [...prev.accounts, newAccount],
      }));

      showToast(
        `CalDAV 계정(${input.username.trim()})에서 캘린더 ${data.calendars.length}개를 검색했습니다.`
      );
    },
    [showToast, vaultSyncConfig?.isEncrypted]
  );

  const disconnectAccount = useCallback(
    (accountId: string, removeSyncedLocalEvents: boolean) => {
      const target = syncStateRef.current.accounts.find((a) => a.id === accountId);
      if (!target) return;

      if (target.provider === 'google') {
        const remainingGoogle = syncStateRef.current.accounts.filter(
          (a) => a.provider === 'google' && a.id !== accountId
        );
        if (remainingGoogle.length === 0) {
          clearCachedGoogleAccessToken(true);
        }
      } else if (target.provider === 'microsoft' && target.microsoftSessionHandle) {
        void fetch('/api/auth/microsoft/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionHandle: target.microsoftSessionHandle }),
        }).catch(() => {});
      } else if (target.provider === 'caldav') {
        sessionCalDavPasswordsRef.current.delete(accountId);
      }

      setSyncState((prev) => ({
        accounts: prev.accounts.filter((a) => a.id !== accountId),
        pendingDeletions: prev.pendingDeletions.filter((d) => d.accountId !== accountId),
        conflicts: prev.conflicts.filter((c) => c.accountId !== accountId),
      }));

      if (removeSyncedLocalEvents) {
        applyEventsWithHistory(
          (curr) => curr.filter((ev) => ev.externalSync?.accountId !== accountId),
          {
            kind: 'delete',
            label: `'${target.displayName}' 연동 해제 및 외부 일정 정리`,
          }
        );
      } else {
        applyEventsWithHistory(
          (curr) =>
            curr.map((ev) =>
              ev.externalSync?.accountId === accountId
                ? { ...ev, externalSync: undefined }
                : ev
            ),
          {
            kind: 'update',
            label: `'${target.displayName}' 연동 해제 (로컬 사본 보존)`,
          }
        );
      }

      showToast(`'${target.displayName}' 연결이 해제되었습니다.`);
    },
    [applyEventsWithHistory, showToast]
  );

  const updateSubscribedCalendar = useCallback(
    (
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
    ) => {
      const acc = syncStateRef.current.accounts.find((a) => a.id === accountId);
      const cal = acc?.calendars.find((c) => c.id === calendarId);
      if (!acc || !cal) return;

      const nextSyncMode: CalendarSyncMode =
        patch.syncMode && !cal.readOnlyRemote ? patch.syncMode : cal.syncMode;
      const nextMaskLabel = patch.maskLabel !== undefined ? patch.maskLabel : cal.maskLabel;

      const switchedToUnmasked =
        cal.syncMode === 'read_only_masking' && nextSyncMode === 'bidirectional_hybrid';

      setSyncState((prev) => ({
        ...prev,
        accounts: prev.accounts.map((a) => {
          if (a.id !== accountId) return a;
          return {
            ...a,
            calendars: a.calendars.map((c) => {
              if (c.id !== calendarId) return c;
              return {
                ...c,
                ...patch,
                syncMode: nextSyncMode,
                // Reset delta cursor when switching from masked -> bidirectional so next sync restores full unmasked remote details
                ...(switchedToUnmasked ? { syncCursor: undefined, ctag: undefined } : {}),
              };
            }),
          };
        }),
      }));

      if (patch.syncMode !== undefined || patch.maskLabel !== undefined) {
        applyEventsWithHistory(
          (curr) =>
            applySyncModeTransitionToEvents(
              curr,
              accountId,
              calendarId,
              nextSyncMode,
              nextMaskLabel,
              cal.name
            ),
          {
            kind: 'update',
            label: `'${cal.name}' 동기화 모드 전환`,
            detail:
              nextSyncMode === 'read_only_masking'
                ? '읽기 전용 가용시간 마스킹 적용'
                : '양방향 하이브리드 동기화 전환',
          }
        );
      }
    },
    [applyEventsWithHistory]
  );

  const setSessionCalDavPassword = useCallback(
    (accountId: string, password: string) => {
      sessionCalDavPasswordsRef.current.set(accountId, password);
      if (vaultSyncConfig?.isEncrypted) {
        setSyncState((prev) => ({
          ...prev,
          accounts: prev.accounts.map((a) =>
            a.id === accountId && a.caldavConfig
              ? {
                  ...a,
                  status: 'connected',
                  errorMessage: undefined,
                  caldavConfig: { ...a.caldavConfig, appPassword: password },
                }
              : a
          ),
        }));
      } else {
        setSyncState((prev) => ({
          ...prev,
          accounts: prev.accounts.map((a) =>
            a.id === accountId ? { ...a, status: 'connected', errorMessage: undefined } : a
          ),
        }));
      }
      showToast('CalDAV 앱 비밀번호가 현재 세션에 설정되었습니다.');
    },
    [showToast, vaultSyncConfig?.isEncrypted]
  );

  const recordLocalSyncedDeletion = useCallback((deletedEvent: CalendarEventItem) => {
    const sync = deletedEvent.externalSync;
    if (!sync || sync.readOnly || sync.syncMode !== 'bidirectional_hybrid') return;

    setSyncState((prev) => {
      const account = prev.accounts.find((a) => a.id === sync.accountId);
      const calendar = account?.calendars.find((c) => c.id === sync.calendarId);
      if (!account || !calendar || calendar.readOnlyRemote) return prev;

      const record: PendingOutboundDeletion = {
        id: `pdel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        accountId: account.id,
        calendarId: calendar.id,
        remoteCalendarId: calendar.remoteCalendarId,
        provider: account.provider,
        remoteUid: sync.remoteUid,
        remoteEtag: sync.remoteEtag,
        remoteHref: sync.remoteHref,
        eventTitle: deletedEvent.title,
        eventDate: deletedEvent.date,
        deletedAt: new Date().toISOString(),
      };

      return {
        ...prev,
        pendingDeletions: [...prev.pendingDeletions, record],
      };
    });
  }, []);

  const syncAccounts = useCallback(
    async (targetAccountId?: string) => {
      if (isSyncing) return;
      const snapshotState = syncStateRef.current;
      const targets = targetAccountId
        ? snapshotState.accounts.filter((a) => a.id === targetAccountId)
        : snapshotState.accounts;

      if (targets.length === 0) {
        showToast('연결된 외부 캘린더 계정이 없습니다.');
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await enqueueOfflineSyncTask('manual-offline-sync', targetAccountId);
        await registerBackgroundSyncTags(false);
        showToast(
          '오프라인 상태입니다. 네트워크 복구 시 Service Worker 백그라운드 동기화가 자동 실행되도록 예약했습니다.'
        );
        return;
      }

      setIsSyncing(true);
      setSyncingAccountId(targetAccountId || 'all');

      let workingEvents = [...eventsRef.current];
      let workingConflicts = [...snapshotState.conflicts];
      const updatedAccountsMap = new Map<string, ConnectedCalendarAccount>();

      let totalImported = 0;
      let totalUpdated = 0;
      let totalDeleted = 0;
      let totalConflicts = 0;
      const accountErrors: string[] = [];

      try {
        for (const account of targets) {
          let nextAccount: ConnectedCalendarAccount = {
            ...account,
            calendars: [...account.calendars],
          };

          const enabledCalendars = nextAccount.calendars.filter((c) => c.enabled);
          if (enabledCalendars.length === 0) {
            updatedAccountsMap.set(nextAccount.id, nextAccount);
            continue;
          }

          try {
            if (nextAccount.provider === 'google' && !getCachedGoogleAccessToken()) {
              // Attempt interactive token refresh only if single-account user click, else mark reauth_required
              if (targetAccountId) {
                await signInWithGoogleCalendar();
              } else {
                throw new Error('Google 재인증이 필요합니다 (메모리 보안 토큰 만료).');
              }
            }

            for (let idx = 0; idx < nextAccount.calendars.length; idx++) {
              const cal = nextAccount.calendars[idx];
              if (!cal.enabled) continue;

              let pulledEvents: NormalizedRemoteEventPayload[] = [];
              let deletedHrefs: string[] = [];
              let nextCursor = cal.syncCursor;
              let nextCtag = cal.ctag;

              if (nextAccount.provider === 'google') {
                const pullRes = await pullGoogleCalendarDelta({
                  remoteCalendarId: cal.remoteCalendarId,
                  syncToken: cal.syncCursor,
                  viewerTimeZone,
                });
                pulledEvents = pullRes.events;
                nextCursor = pullRes.nextSyncToken ?? cal.syncCursor;
              } else if (nextAccount.provider === 'microsoft') {
                if (!nextAccount.microsoftSessionHandle) {
                  throw new Error('Microsoft 인증 세션이 없습니다. 다시 로그인해 주세요.');
                }
                const msRes = await fetch('/api/sync/microsoft/pull', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sessionHandle: nextAccount.microsoftSessionHandle,
                    remoteCalendarId: cal.remoteCalendarId,
                    deltaLink: cal.syncCursor,
                    viewerTimeZone,
                  }),
                });
                const msData = (await msRes.json().catch(() => ({}))) as {
                  nextDeltaLink?: string;
                  events?: NormalizedRemoteEventPayload[];
                  error?: string;
                };
                if (!msRes.ok) {
                  throw new Error(msData.error || 'Microsoft 일정 동기화에 실패했습니다.');
                }
                pulledEvents = msData.events || [];
                nextCursor = msData.nextDeltaLink ?? cal.syncCursor;
              } else if (nextAccount.provider === 'caldav') {
                const cfg = nextAccount.caldavConfig;
                const appPassword =
                  cfg?.appPassword || sessionCalDavPasswordsRef.current.get(nextAccount.id);
                if (!cfg || !appPassword) {
                  throw new Error(
                    '보안을 위해 일반 모드에서는 CalDAV 앱 비밀번호를 세션마다 입력해야 합니다. (AES-256-GCM 볼트 잠금 시 암호화 보관 가능)'
                  );
                }

                const knownEtagsByHref: Record<string, string> = {};
                for (const ev of workingEvents) {
                  if (
                    ev.externalSync?.accountId === nextAccount.id &&
                    ev.externalSync?.calendarId === cal.id &&
                    ev.externalSync.remoteHref &&
                    ev.externalSync.remoteEtag
                  ) {
                    knownEtagsByHref[ev.externalSync.remoteHref] = ev.externalSync.remoteEtag;
                  }
                }

                const davRes = await fetch('/api/sync/caldav/pull', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    serverUrl: cfg.serverUrl,
                    username: cfg.username,
                    appPassword,
                    calendarUrl: cal.remoteCalendarId,
                    previousCtag: cal.ctag,
                    knownEtagsByHref,
                    viewerTimeZone,
                  }),
                });
                const davData = (await davRes.json().catch(() => ({}))) as {
                  unchanged?: boolean;
                  nextCtag?: string;
                  nextSyncToken?: string;
                  upsertedEvents?: NormalizedRemoteEventPayload[];
                  deletedHrefs?: string[];
                  error?: string;
                };
                if (!davRes.ok) {
                  throw new Error(davData.error || 'CalDAV 동기화 조회 실패');
                }
                pulledEvents = davData.upsertedEvents || [];
                deletedHrefs = davData.deletedHrefs || [];
                nextCtag = davData.nextCtag ?? cal.ctag;
                nextCursor = davData.nextSyncToken ?? cal.syncCursor;
              }

              const reconciled = reconcileInboundCalendarDelta({
                currentEvents: workingEvents,
                existingConflicts: workingConflicts,
                account: nextAccount,
                calendar: cal,
                upsertedPayloads: pulledEvents,
                deletedHrefs,
              });

              workingEvents = reconciled.nextEvents;
              if (reconciled.newConflicts.length > 0) {
                workingConflicts = [...workingConflicts, ...reconciled.newConflicts];
                totalConflicts += reconciled.newConflicts.length;
              }
              totalImported += reconciled.importedCount;
              totalUpdated += reconciled.updatedCount;
              totalDeleted += reconciled.deletedCount;

              nextAccount.calendars[idx] = {
                ...cal,
                syncCursor: nextCursor,
                ctag: nextCtag,
                lastSyncedAt: new Date().toISOString(),
              };
            }

            nextAccount = {
              ...nextAccount,
              status: 'connected',
              errorMessage: undefined,
              lastSyncedAt: new Date().toISOString(),
            };
          } catch (accErr) {
            const errMsg =
              accErr instanceof Error ? accErr.message : '계정 동기화 중 오류가 발생했습니다.';
            accountErrors.push(`${nextAccount.displayName}: ${errMsg}`);
            nextAccount = {
              ...nextAccount,
              status:
                errMsg.includes('만료') || errMsg.includes('재인증') || errMsg.includes('비밀번호')
                  ? 'reauth_required'
                  : 'error',
              errorMessage: errMsg,
            };
          }

          updatedAccountsMap.set(nextAccount.id, nextAccount);
        }

        const mergedAccounts = snapshotState.accounts.map(
          (a) => updatedAccountsMap.get(a.id) ?? a
        );

        // Apply inbound changes to local vault with undoable history
        if (totalImported > 0 || totalUpdated > 0 || totalDeleted > 0) {
          applyEventsWithHistory(workingEvents, {
            kind: 'import',
            label: `외부 캘린더 동기화 수신 (+${totalImported} · 수정 ${totalUpdated} · 삭제 ${totalDeleted})`,
            detail: targets.map((t) => t.displayName).join(', '),
          });
        }

        setSyncState((prev) => ({
          ...prev,
          accounts: mergedAccounts,
          conflicts: workingConflicts,
        }));

        // Build Pre-Flight Outbound Mutation Plan for bidirectional_hybrid calendars
        const outboundPlan = buildOutboundMutationPlan({
          events: workingEvents,
          accounts: mergedAccounts,
          pendingDeletions: snapshotState.pendingDeletions,
          conflicts: workingConflicts,
          targetAccountId,
        });

        if (outboundPlan.length > 0) {
          // MANDATORY CONFIRMATION GATE before executing any mutating cloud API calls
          setPendingOutboundPlan(outboundPlan);
        }

        if (accountErrors.length > 0) {
          showToast(accountErrors[0]);
        } else if (outboundPlan.length > 0) {
          showToast(
            `원격 수신 완료 (+${totalImported}/수정 ${totalUpdated}). 클라우드로 반영할 변경사항 ${outboundPlan.length}건을 확인해 주세요.`
          );
        } else {
          showToast(
            totalImported + totalUpdated + totalDeleted > 0
              ? `외부 동기화 완료 · 신규 ${totalImported}건, 업데이트 ${totalUpdated}건, 정리 ${totalDeleted}건`
              : '모든 외부 캘린더가 최신 상태입니다.'
          );
        }
      } finally {
        setIsSyncing(false);
        setSyncingAccountId(null);
      }
    },
    [applyEventsWithHistory, isSyncing, showToast, viewerTimeZone]
  );

  const confirmAndExecuteOutboundPlan = useCallback(async () => {
    if (!pendingOutboundPlan || pendingOutboundPlan.length === 0 || isExecutingOutbound) return;
    setIsExecutingOutbound(true);

    const plan = pendingOutboundPlan;
    const currentAccounts = syncStateRef.current.accounts;

    // Group operations by accountId + calendarId
    const grouped = new Map<string, OutboundMutationPlanItem[]>();
    for (const item of plan) {
      const key = `${item.accountId}::${item.calendarId}`;
      const list = grouped.get(key) || [];
      list.push(item);
      grouped.set(key, list);
    }

    const succeededDeletionIds = new Set<string>();
    const localSyncPatches = new Map<
      string,
      {
        accountId: string;
        calendarId: string;
        calendarName: string;
        provider: ConnectedCalendarAccount['provider'];
        remoteUid: string;
        remoteIcalUid?: string;
        remoteEtag?: string;
        remoteHref?: string;
      }
    >();
    let successCount = 0;
    let failCount = 0;

    try {
      for (const [groupKey, items] of grouped.entries()) {
        const [accountId, calendarId] = groupKey.split('::');
        const account = currentAccounts.find((a) => a.id === accountId);
        const calendar = account?.calendars.find((c) => c.id === calendarId);
        if (!account || !calendar) continue;

        if (account.provider === 'google') {
          const results = await pushGoogleCalendarMutations({
            remoteCalendarId: calendar.remoteCalendarId,
            operations: items.map((it) => ({
              op: it.op,
              localEventId: it.localEventId,
              remoteUid: it.remoteUid,
              remoteEtag: it.remoteEtag,
              event: it.event,
            })),
          });

          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const src = items[i];
            if (r.ok) {
              successCount += 1;
              if (src.op === 'delete' && src.deletionRecordId) {
                succeededDeletionIds.add(src.deletionRecordId);
              } else if (src.localEventId) {
                localSyncPatches.set(src.localEventId, {
                  accountId: account.id,
                  calendarId: calendar.id,
                  calendarName: calendar.name,
                  provider: 'google',
                  remoteUid: r.remoteUid,
                  remoteIcalUid: r.remoteIcalUid,
                  remoteEtag: r.remoteEtag,
                });
              }
            } else {
              failCount += 1;
            }
          }
        } else if (account.provider === 'microsoft' && account.microsoftSessionHandle) {
          const res = await fetch('/api/sync/microsoft/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionHandle: account.microsoftSessionHandle,
              remoteCalendarId: calendar.remoteCalendarId,
              operations: items.map((it) => ({
                op: it.op,
                localEventId: it.localEventId,
                remoteUid: it.remoteUid,
                remoteEtag: it.remoteEtag,
                event: it.event,
              })),
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            results?: Array<{
              op: string;
              localEventId?: string;
              remoteUid: string;
              remoteIcalUid?: string;
              remoteEtag?: string;
              ok: boolean;
            }>;
          };
          const results = data.results || [];
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const src = items[i];
            if (r.ok) {
              successCount += 1;
              if (src.op === 'delete' && src.deletionRecordId) {
                succeededDeletionIds.add(src.deletionRecordId);
              } else if (src.localEventId) {
                localSyncPatches.set(src.localEventId, {
                  accountId: account.id,
                  calendarId: calendar.id,
                  calendarName: calendar.name,
                  provider: 'microsoft',
                  remoteUid: r.remoteUid,
                  remoteIcalUid: r.remoteIcalUid,
                  remoteEtag: r.remoteEtag,
                });
              }
            } else {
              failCount += 1;
            }
          }
        } else if (account.provider === 'caldav' && account.caldavConfig) {
          const appPassword =
            account.caldavConfig.appPassword || sessionCalDavPasswordsRef.current.get(account.id);
          if (!appPassword) {
            failCount += items.length;
            continue;
          }
          const res = await fetch('/api/sync/caldav/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serverUrl: account.caldavConfig.serverUrl,
              username: account.caldavConfig.username,
              appPassword,
              calendarUrl: calendar.remoteCalendarId,
              operations: items.map((it) => ({
                op: it.op,
                localEventId: it.localEventId,
                remoteUid: it.remoteUid || `vibe-${it.localEventId}@vibecalendar.local`,
                remoteHref: it.remoteHref,
                remoteEtag: it.remoteEtag,
                event: it.event,
              })),
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            results?: Array<{
              op: string;
              localEventId?: string;
              remoteUid: string;
              remoteHref: string;
              remoteEtag?: string;
              ok: boolean;
            }>;
          };
          const results = data.results || [];
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const src = items[i];
            if (r.ok) {
              successCount += 1;
              if (src.op === 'delete' && src.deletionRecordId) {
                succeededDeletionIds.add(src.deletionRecordId);
              } else if (src.localEventId) {
                localSyncPatches.set(src.localEventId, {
                  accountId: account.id,
                  calendarId: calendar.id,
                  calendarName: calendar.name,
                  provider: 'caldav',
                  remoteUid: r.remoteUid,
                  remoteIcalUid: r.remoteUid,
                  remoteHref: r.remoteHref,
                  remoteEtag: r.remoteEtag,
                });
              }
            } else {
              failCount += 1;
            }
          }
        }
      }

      if (localSyncPatches.size > 0) {
        const nowIso = new Date().toISOString();
        applyEventsWithHistory(
          (curr) =>
            curr.map((ev) => {
              const patch = localSyncPatches.get(ev.id);
              if (!patch) return ev;
              return {
                ...ev,
                externalSync: {
                  accountId: patch.accountId,
                  calendarId: patch.calendarId,
                  calendarName: patch.calendarName,
                  provider: patch.provider,
                  remoteUid: patch.remoteUid,
                  remoteIcalUid: patch.remoteIcalUid ?? ev.externalSync?.remoteIcalUid,
                  remoteEtag: patch.remoteEtag ?? ev.externalSync?.remoteEtag,
                  remoteHref: patch.remoteHref ?? ev.externalSync?.remoteHref,
                  syncMode: 'bidirectional_hybrid',
                  isMasked: false,
                  readOnly: false,
                  lastSyncedAt: nowIso,
                  baseSnapshotHash: computeSyncableEventHash(ev),
                },
              };
            }),
          {
            kind: 'update',
            label: `외부 클라우드 변경사항 반영 완료 (${localSyncPatches.size}건)`,
          }
        );
      }

      if (succeededDeletionIds.size > 0) {
        setSyncState((prev) => ({
          ...prev,
          pendingDeletions: prev.pendingDeletions.filter((d) => !succeededDeletionIds.has(d.id)),
        }));
      }

      setPendingOutboundPlan(null);
      showToast(
        failCount > 0
          ? `원격 반영 완료 ${successCount}건 · 실패/충돌 ${failCount}건`
          : `외부 클라우드 캘린더에 변경사항 ${successCount}건을 안전하게 반영했습니다.`
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : '원격 클라우드 반영 중 오류가 발생했습니다.'
      );
    } finally {
      setIsExecutingOutbound(false);
    }
  }, [applyEventsWithHistory, isExecutingOutbound, pendingOutboundPlan, showToast]);

  const cancelOutboundPlan = useCallback(() => {
    setPendingOutboundPlan(null);
    showToast('원격 클라우드 반영을 보류했습니다. 로컬 볼트 데이터는 그대로 유지됩니다.');
  }, [showToast]);

  const resolveSyncConflict = useCallback(
    (conflictId: string, resolution: 'keep_local' | 'accept_remote') => {
      const target = syncStateRef.current.conflicts.find((c) => c.id === conflictId);
      if (!target) return;

      if (resolution === 'accept_remote') {
        applyEventsWithHistory(
          (curr) =>
            curr.map((ev) => (ev.id === target.localEventId ? target.remoteSnapshot : ev)),
          {
            kind: 'update',
            label: `'${target.remoteSnapshot.title}' 충돌 해결 (원격 수용)`,
          }
        );
      } else {
        // Keep local snapshot & update remoteEtag so next sync pushes local version cleanly
        applyEventsWithHistory(
          (curr) =>
            curr.map((ev) => {
              if (ev.id !== target.localEventId || !ev.externalSync) return ev;
              return {
                ...ev,
                externalSync: {
                  ...ev.externalSync,
                  remoteEtag: target.remoteEtag ?? ev.externalSync.remoteEtag,
                  remoteHref: target.remoteHref ?? ev.externalSync.remoteHref,
                },
              };
            }),
          {
            kind: 'update',
            label: `'${target.localSnapshot.title}' 충돌 해결 (로컬 유지)`,
          }
        );
      }

      setSyncState((prev) => ({
        ...prev,
        conflicts: prev.conflicts.filter((c) => c.id !== conflictId),
      }));

      showToast(
        resolution === 'accept_remote'
          ? '원격 캘린더 변경본을 수용했습니다.'
          : '로컬 볼트 변경본을 유지했습니다. 다음 동기화 시 원격에 반영할 수 있습니다.'
      );
    },
    [applyEventsWithHistory, showToast]
  );

  const stats = useMemo(() => {
    let enabledCalendarCount = 0;
    let maskedCalendarCount = 0;
    let bidirectionalCalendarCount = 0;
    for (const acc of syncState.accounts) {
      for (const cal of acc.calendars) {
        if (!cal.enabled) continue;
        enabledCalendarCount += 1;
        if (cal.syncMode === 'read_only_masking') maskedCalendarCount += 1;
        else bidirectionalCalendarCount += 1;
      }
    }
    return {
      accountCount: syncState.accounts.length,
      enabledCalendarCount,
      maskedCalendarCount,
      bidirectionalCalendarCount,
      conflictCount: syncState.conflicts.length,
      pendingDeletionCount: syncState.pendingDeletions.length,
      googleConfigured: isGoogleClientConfigured(),
      hasGoogleSessionToken: Boolean(getCachedGoogleAccessToken()),
    };
  }, [syncState]);

  return {
    syncState,
    stats,
    microsoftStatus,
    isSyncing,
    syncingAccountId,
    pendingOutboundPlan,
    isExecutingOutbound,
    connectGoogleAccount,
    connectMicrosoftAccount,
    connectCalDavAccount,
    disconnectAccount,
    updateSubscribedCalendar,
    setSessionCalDavPassword,
    recordLocalSyncedDeletion,
    syncAccounts,
    confirmAndExecuteOutboundPlan,
    cancelOutboundPlan,
    resolveSyncConflict,
    hasCalDavPasswordInMemory: (accountId: string) =>
      sessionCalDavPasswordsRef.current.has(accountId),
  };
}
