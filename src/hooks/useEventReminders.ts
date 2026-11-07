import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CalendarEventItem, NotificationEnginePreferences } from '../types';
import {
  computeUpcomingAlertSchedule,
  DEFAULT_NOTIFICATION_PREFERENCES,
  formatLeadMinutesLabel,
  MAX_CUSTOM_LEAD_MINUTES,
  MAX_LEAD_TIMES_PER_ITEM,
  NOTIFICATION_BROADCAST_CHANNEL,
  NotificationBusMessage,
  normalizeLeadMinutesList,
  ScheduledAlertRecord,
  summarizeLeadMinutesList,
} from '../shared/notificationSchema';
import {
  claimAlertFireInIdb,
  countOfflineSyncTasks,
  drainOfflineSyncTasks,
  drainSwActionInbox,
  putSnoozedAlertInIdb,
  removeScheduledAlertFromIdb,
  replaceScheduledAlertsInIdb,
} from '../services/notifications/notificationIdb';
import {
  detectNotificationCapabilities,
  getActiveServiceWorkerRegistration,
  getExistingPushSubscription,
  getOrCreatePushClientId,
  NotificationPlatformCapabilities,
  postReconcileToServiceWorker,
  registerBackgroundSyncTags,
  scheduleServerSnoozeWake,
  subscribeBrowserWebPush,
  syncWakeSlotsWithServer,
  triggerBackgroundTestAlert,
  unsubscribeBrowserWebPush,
} from '../services/notifications/pushClient';

export type ReminderLeadMinutes = 0 | 10 | 15 | 30;

const STORAGE_PREFS_V2_KEY = 'vibe_notification_prefs_v2';
const LEGACY_REMINDER_LEAD_KEY = 'vibe_event_reminder_lead_v1';

export interface VaultNotificationPrefsConfig {
  isEncrypted: boolean;
  initialPrefs?: NotificationEnginePreferences;
  onEncryptedPrefsChange: (prefs: NotificationEnginePreferences) => void;
}

function sanitizeNotificationPrefs(
  raw: Partial<NotificationEnginePreferences> | null | undefined
): NotificationEnginePreferences {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  const normalizedLeads = normalizeLeadMinutesList(raw.defaultLeadMinutes);
  const allDayHour =
    raw.allDayNotifyHour === null
      ? null
      : typeof raw.allDayNotifyHour === 'number' &&
        Number.isFinite(raw.allDayNotifyHour) &&
        raw.allDayNotifyHour >= 0 &&
        raw.allDayNotifyHour <= 23
      ? Math.round(raw.allDayNotifyHour)
      : DEFAULT_NOTIFICATION_PREFERENCES.allDayNotifyHour;

  return {
    enabled: Boolean(raw.enabled),
    defaultLeadMinutes: normalizedLeads.length > 0 ? normalizedLeads : [10],
    allDayNotifyHour: allDayHour,
    webPushEnabled: Boolean(raw.webPushEnabled),
    backgroundSyncEnabled:
      typeof raw.backgroundSyncEnabled === 'boolean' ? raw.backgroundSyncEnabled : true,
    privacyMaskWhenEncrypted:
      typeof raw.privacyMaskWhenEncrypted === 'boolean' ? raw.privacyMaskWhenEncrypted : true,
  };
}

function readInitialPlaintextPrefs(): NotificationEnginePreferences {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  try {
    const rawV2 = window.localStorage.getItem(STORAGE_PREFS_V2_KEY);
    if (rawV2) {
      return sanitizeNotificationPrefs(JSON.parse(rawV2) as Partial<NotificationEnginePreferences>);
    }

    // Legacy v1 단일 리드타임(10/15/30분) 무손실 자동 마이그레이션
    const legacyVal = Number(window.localStorage.getItem(LEGACY_REMINDER_LEAD_KEY) || '0');
    if (legacyVal === 10 || legacyVal === 15 || legacyVal === 30) {
      const migrated: NotificationEnginePreferences = {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        enabled: true,
        defaultLeadMinutes: [legacyVal],
      };
      window.localStorage.setItem(STORAGE_PREFS_V2_KEY, JSON.stringify(migrated));
      window.localStorage.removeItem(LEGACY_REMINDER_LEAD_KEY);
      return migrated;
    }
  } catch {
    // ignore storage errors
  }

  return { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

interface UseEventRemindersParams {
  events: CalendarEventItem[];
  viewerTimeZone: string;
  enabled?: boolean;
  vaultPrefsConfig?: VaultNotificationPrefsConfig;
  onInAppReminder?: (message: string, event?: CalendarEventItem) => void;
  onFocusEvent?: (eventId: string, eventDate?: string) => void;
  onCompleteEvent?: (eventId: string) => void;
  onExecuteBackgroundSync?: () => Promise<void> | void;
}

/**
 * 고정밀 로컬 알림 엔진 + PWA Service Worker Background Sync + 제로 지식 VAPID Web Push 오케스트레이터
 */
export function useEventReminders({
  events,
  viewerTimeZone,
  enabled = true,
  vaultPrefsConfig,
  onInAppReminder,
  onFocusEvent,
  onCompleteEvent,
  onExecuteBackgroundSync,
}: UseEventRemindersParams) {
  const clientId = useMemo(() => getOrCreatePushClientId(), []);
  const capabilities = useMemo<NotificationPlatformCapabilities>(
    () => detectNotificationCapabilities(),
    []
  );

  const [prefs, setPrefs] = useState<NotificationEnginePreferences>(() => {
    if (vaultPrefsConfig?.isEncrypted) {
      return sanitizeNotificationPrefs(vaultPrefsConfig.initialPrefs);
    }
    return readInitialPlaintextPrefs();
  });

  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return 'unsupported';
    }
    return Notification.permission;
  });

  const [upcomingAlerts, setUpcomingAlerts] = useState<ScheduledAlertRecord[]>([]);
  const [isWebPushSubscribed, setIsWebPushSubscribed] = useState<boolean>(false);
  const [isPushBusy, setIsPushBusy] = useState<boolean>(false);
  const [pendingOfflineSyncCount, setPendingOfflineSyncCount] = useState<number>(0);
  const [recomputeTick, setRecomputeTick] = useState<number>(0);

  const eventsRef = useRef(events);
  eventsRef.current = events;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const onInAppReminderRef = useRef(onInAppReminder);
  onInAppReminderRef.current = onInAppReminder;
  const onFocusEventRef = useRef(onFocusEvent);
  onFocusEventRef.current = onFocusEvent;
  const onCompleteEventRef = useRef(onCompleteEvent);
  onCompleteEventRef.current = onCompleteEvent;
  const onExecuteBackgroundSyncRef = useRef(onExecuteBackgroundSync);
  onExecuteBackgroundSyncRef.current = onExecuteBackgroundSync;

  // 설정 변경 영속화 (암호화 볼트 활성 시 AES-256-GCM 번들에 저장, 일반 모드 시 localStorage 저장)
  useEffect(() => {
    if (vaultPrefsConfig?.isEncrypted) {
      vaultPrefsConfig.onEncryptedPrefsChange(prefs);
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_PREFS_V2_KEY, JSON.stringify(prefs));
    } catch {
      // ignore storage quota errors
    }
  }, [prefs, vaultPrefsConfig]);

  // 초기 푸시 구독 상태 및 오프라인 동기화 대기열 점검
  const refreshOfflineSyncCount = useCallback(async () => {
    const cnt = await countOfflineSyncTasks();
    setPendingOfflineSyncCount(cnt);
    return cnt;
  }, []);

  useEffect(() => {
    let active = true;
    void getExistingPushSubscription().then((sub) => {
      if (active) {
        setIsWebPushSubscribed(Boolean(sub));
      }
    });
    void refreshOfflineSyncCount();
    return () => {
      active = false;
    };
  }, [refreshOfflineSyncCount]);

  // 60초 주기로 알림 스케줄 호라이즌 갱신
  useEffect(() => {
    if (!enabled || !prefs.enabled) return;
    const id = window.setInterval(() => {
      setRecomputeTick((t) => t + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [enabled, prefs.enabled]);

  const requestBrowserNotificationPermission = useCallback(async (): Promise<
    NotificationPermission | 'unsupported'
  > => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      setNotificationPermission('unsupported');
      return 'unsupported';
    }
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      setNotificationPermission(Notification.permission);
      return Notification.permission;
    }
    try {
      const result = await Notification.requestPermission();
      setNotificationPermission(result);
      return result;
    } catch {
      return Notification.permission;
    }
  }, []);

  const updateNotificationPrefs = useCallback(
    async (
      patch:
        | Partial<NotificationEnginePreferences>
        | ((prev: NotificationEnginePreferences) => NotificationEnginePreferences)
    ) => {
      let nextSnapshot: NotificationEnginePreferences | null = null;
      setPrefs((prev) => {
        const rawNext = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
        const sanitized = sanitizeNotificationPrefs(rawNext);
        nextSnapshot = sanitized;
        return sanitized;
      });

      if (nextSnapshot && (nextSnapshot as NotificationEnginePreferences).enabled) {
        await requestBrowserNotificationPermission();
      }
    },
    [requestBrowserNotificationPermission]
  );

  const toggleDefaultLeadMinute = useCallback(
    async (minute: number) => {
      const safeMin = Math.max(0, Math.min(MAX_CUSTOM_LEAD_MINUTES, Math.round(minute)));
      await updateNotificationPrefs((prev) => {
        const exists = prev.defaultLeadMinutes.includes(safeMin);
        if (exists) {
          const remaining = prev.defaultLeadMinutes.filter((m) => m !== safeMin);
          if (remaining.length === 0) {
            return { ...prev, enabled: false, defaultLeadMinutes: [10] };
          }
          return { ...prev, enabled: true, defaultLeadMinutes: remaining };
        }
        const combined = normalizeLeadMinutesList([...prev.defaultLeadMinutes, safeMin]).slice(
          0,
          MAX_LEAD_TIMES_PER_ITEM
        );
        return { ...prev, enabled: true, defaultLeadMinutes: combined };
      });
    },
    [updateNotificationPrefs]
  );

  const addCustomDefaultLeadMinute = useCallback(
    async (minute: number): Promise<boolean> => {
      if (!Number.isFinite(minute) || minute < 0 || minute > MAX_CUSTOM_LEAD_MINUTES) {
        return false;
      }
      const rounded = Math.round(minute);
      await updateNotificationPrefs((prev) => {
        const merged = normalizeLeadMinutesList([...prev.defaultLeadMinutes, rounded]).slice(
          0,
          MAX_LEAD_TIMES_PER_ITEM
        );
        return {
          ...prev,
          enabled: true,
          defaultLeadMinutes: merged,
        };
      });
      return true;
    },
    [updateNotificationPrefs]
  );

  const enableWebPushSubscription = useCallback(async (): Promise<boolean> => {
    setIsPushBusy(true);
    try {
      const sub = await subscribeBrowserWebPush();
      setIsWebPushSubscribed(true);
      setNotificationPermission(
        typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
      );
      setPrefs((prev) =>
        sanitizeNotificationPrefs({
          ...prev,
          enabled: true,
          webPushEnabled: true,
        })
      );

      // 즉시 현재 예약된 타임스탬프 슬롯을 서버와 제로 지식으로 동기화
      const computed = computeUpcomingAlertSchedule({
        events: eventsRef.current,
        viewerTimeZone,
        prefs: { ...prefsRef.current, enabled: true, webPushEnabled: true },
        isVaultEncrypted: Boolean(vaultPrefsConfig?.isEncrypted),
        clientId,
      });
      await syncWakeSlotsWithServer(clientId, sub, computed);
      return true;
    } finally {
      setIsPushBusy(false);
    }
  }, [clientId, vaultPrefsConfig?.isEncrypted, viewerTimeZone]);

  const disableWebPushSubscription = useCallback(async (): Promise<void> => {
    setIsPushBusy(true);
    try {
      await unsubscribeBrowserWebPush(clientId);
      setIsWebPushSubscribed(false);
      setPrefs((prev) =>
        sanitizeNotificationPrefs({
          ...prev,
          webPushEnabled: false,
        })
      );
    } finally {
      setIsPushBusy(false);
    }
  }, [clientId]);

  const sendTestBackgroundNotification = useCallback(async () => {
    return await triggerBackgroundTestAlert({
      useWebPush: Boolean(prefsRef.current.webPushEnabled && isWebPushSubscribed),
      delayMs: 3000,
      clientId,
    });
  }, [clientId, isWebPushSubscribed]);

  // 일정 · 타임존 · 리드타임 변경 시 향후 14일 알림 스케줄 계산 -> IndexedDB + SW + Web Push 동기화
  useEffect(() => {
    let cancelled = false;

    const syncSchedulePipeline = async () => {
      if (!enabled || !prefs.enabled) {
        const cleared = await replaceScheduledAlertsInIdb([]);
        if (!cancelled) {
          setUpcomingAlerts(cleared.filter((a) => a.triggerAtMs > Date.now() - 60_000));
        }
        const existingSub = await getExistingPushSubscription();
        if (existingSub) {
          await syncWakeSlotsWithServer(clientId, existingSub, []);
        }
        return;
      }

      const rawSchedule = computeUpcomingAlertSchedule({
        events,
        viewerTimeZone,
        prefs,
        isVaultEncrypted: Boolean(vaultPrefsConfig?.isEncrypted),
        clientId,
      });

      const mergedInIdb = await replaceScheduledAlertsInIdb(rawSchedule);
      if (cancelled) return;

      setUpcomingAlerts(mergedInIdb);

      if (prefs.backgroundSyncEnabled) {
        void registerBackgroundSyncTags(true);
      }

      void postReconcileToServiceWorker();

      if (prefs.webPushEnabled) {
        const sub = await getExistingPushSubscription();
        if (sub && !cancelled) {
          setIsWebPushSubscribed(true);
          await syncWakeSlotsWithServer(clientId, sub, mergedInIdb);
        }
      }
    };

    void syncSchedulePipeline();

    return () => {
      cancelled = true;
    };
  }, [
    clientId,
    enabled,
    events,
    prefs,
    recomputeTick,
    vaultPrefsConfig?.isEncrypted,
    viewerTimeZone,
  ]);

  // 알림 표시 헬퍼 (원자적 중복 방지 claim 통과 시 실행)
  const fireClaimedAlertOnClient = useCallback(async (alert: ScheduledAlertRecord) => {
    const matchedEvent = eventsRef.current.find(
      (ev) => ev.id === alert.masterEventId || ev.id === alert.eventId
    );
    const inAppText = alert.isMasked
      ? `${alert.localStartTime} 예정된 보안 일정이 곧 시작됩니다.`
      : `${alert.notificationTitle.replace('바이브 행사 · ', '')}: ${alert.notificationBody}`;

    onInAppReminderRef.current?.(inAppText, matchedEvent);

    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return;
    }

    const reg = await getActiveServiceWorkerRegistration(1800);
    if (reg && typeof reg.showNotification === 'function') {
      try {
        const notificationOptions: NotificationOptions & {
          renotify?: boolean;
          actions?: Array<{ action: string; title: string }>;
          timestamp?: number;
        } = {
          body: alert.notificationBody,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag: alert.triggerId,
          renotify: true,
          requireInteraction: alert.leadMinutes <= 15,
          timestamp: alert.eventStartEpochMs,
          data: {
            triggerId: alert.triggerId,
            eventId: alert.eventId,
            masterEventId: alert.masterEventId,
            eventDate: alert.eventDate,
            localStartTime: alert.localStartTime,
            notificationTitle: alert.notificationTitle,
            notificationBody: alert.notificationBody,
            eventStartEpochMs: alert.eventStartEpochMs,
            isMasked: alert.isMasked,
            clientId: alert.clientId,
          },
          actions: [
            { action: 'snooze-10', title: '10분 후 다시 알림' },
            { action: 'complete-event', title: '완료 처리' },
          ],
        };
        await reg.showNotification(alert.notificationTitle, notificationOptions);
        return;
      } catch {
        // fallback to DOM Notification constructor below
      }
    }

    try {
      new Notification(alert.notificationTitle, {
        body: alert.notificationBody,
        icon: '/pwa-192x192.png',
        tag: alert.triggerId,
      });
    } catch {
      // ignore embedded iframe notification restrictions
    }
  }, []);

  // 드리프트 보정(Drift-Compensating) 정밀 타이머 + 탭 복귀 스윕
  useEffect(() => {
    if (!enabled || !prefs.enabled || upcomingAlerts.length === 0) return;

    let cancelled = false;
    let precisionTimerId: number | null = null;

    const evaluateDueAlerts = async () => {
      if (cancelled) return;
      const now = Date.now();
      const gracePastMs = now - 15 * 60_000;
      const dueItems = upcomingAlerts.filter(
        (item) => item.triggerAtMs <= now + 800 && item.triggerAtMs >= gracePastMs
      );

      if (dueItems.length > 0) {
        const firedIds = new Set<string>();
        for (const item of dueItems) {
          const wonClaim = await claimAlertFireInIdb(item.triggerId, now);
          if (wonClaim && !cancelled) {
            firedIds.add(item.triggerId);
            await fireClaimedAlertOnClient(item);
          } else {
            firedIds.add(item.triggerId);
          }
        }
        if (!cancelled && firedIds.size > 0) {
          setUpcomingAlerts((curr) => curr.filter((a) => !firedIds.has(a.triggerId)));
        }
      }

      if (cancelled) return;

      const nextFuture = upcomingAlerts.find((item) => item.triggerAtMs > Date.now() + 500);
      if (nextFuture) {
        const waitMs = Math.max(350, Math.min(nextFuture.triggerAtMs - Date.now(), 30_000));
        precisionTimerId = window.setTimeout(() => {
          void evaluateDueAlerts();
        }, waitMs);
      }
    };

    void evaluateDueAlerts();

    const safetyInterval = window.setInterval(() => {
      void evaluateDueAlerts();
    }, 15_000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (typeof Notification !== 'undefined') {
          setNotificationPermission(Notification.permission);
        }
        void evaluateDueAlerts();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      if (precisionTimerId !== null) {
        window.clearTimeout(precisionTimerId);
      }
      window.clearInterval(safetyInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, fireClaimedAlertOnClient, prefs.enabled, upcomingAlerts]);

  // 수동 스누즈(+10분) 및 예약 제외 제어
  const snoozeScheduledAlert = useCallback(
    async (alert: ScheduledAlertRecord, delayMinutes = 10) => {
      const snoozeAtMs = Date.now() + delayMinutes * 60_000;
      const snoozedRecord: ScheduledAlertRecord = {
        ...alert,
        triggerId: `snooze:${alert.eventId}:${Math.floor(snoozeAtMs / 1000)}`,
        leadMinutes: delayMinutes,
        triggerAtMs: snoozeAtMs,
        notificationTitle: `바이브 행사 · 다시 알림 (${delayMinutes}분 연장)`,
        isSnoozed: true,
        updatedAtMs: Date.now(),
      };

      await removeScheduledAlertFromIdb(alert.triggerId);
      await putSnoozedAlertInIdb(snoozedRecord);

      setUpcomingAlerts((curr) =>
        [...curr.filter((a) => a.triggerId !== alert.triggerId), snoozedRecord].sort(
          (a, b) => a.triggerAtMs - b.triggerAtMs
        )
      );

      if (prefsRef.current.webPushEnabled) {
        await scheduleServerSnoozeWake(clientId, snoozedRecord.triggerId, delayMinutes);
      }
    },
    [clientId]
  );

  const dismissScheduledAlert = useCallback(async (triggerId: string) => {
    await claimAlertFireInIdb(triggerId, Date.now());
    setUpcomingAlerts((curr) => curr.filter((a) => a.triggerId !== triggerId));
  }, []);

  // Service Worker 알림 액션 인박스(완료 처리 · 딥링크 포커스 · 오프라인 백그라운드 동기화) 브리지
  useEffect(() => {
    let disposed = false;

    const flushQueuedOfflineSync = async () => {
      if (disposed || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
      const tasks = await drainOfflineSyncTasks();
      setPendingOfflineSyncCount(0);
      if (tasks.length > 0) {
        await onExecuteBackgroundSyncRef.current?.();
      }
    };

    const flushSwInbox = async () => {
      const actions = await drainSwActionInbox();
      if (disposed || actions.length === 0) return;

      let shouldRunExternalSync = false;
      for (const act of actions) {
        if (act.actionType === 'COMPLETE_EVENT' && act.eventId) {
          onCompleteEventRef.current?.(act.eventId);
        } else if (act.actionType === 'PENDING_EXTERNAL_SYNC') {
          shouldRunExternalSync = true;
        }
      }
      if (shouldRunExternalSync) {
        await flushQueuedOfflineSync();
      }
    };

    const handleBusPayload = (msg: NotificationBusMessage | Record<string, unknown>) => {
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

      if (msg.type === 'ALERT_FIRED' && typeof msg.triggerId === 'string') {
        setUpcomingAlerts((curr) => curr.filter((a) => a.triggerId !== msg.triggerId));
        return;
      }

      if (msg.type === 'SW_SNOOZED_ALERT') {
        setRecomputeTick((t) => t + 1);
        return;
      }

      if (msg.type === 'SW_FOCUS_EVENT' && typeof msg.eventId === 'string' && msg.eventId) {
        onFocusEventRef.current?.(
          msg.eventId,
          typeof msg.eventDate === 'string' ? msg.eventDate : undefined
        );
        return;
      }

      if (msg.type === 'SW_COMPLETE_EVENT' && typeof msg.eventId === 'string' && msg.eventId) {
        void drainSwActionInbox();
        onCompleteEventRef.current?.(msg.eventId);
        return;
      }

      if (msg.type === 'SW_EXECUTE_BACKGROUND_SYNC') {
        void flushQueuedOfflineSync();
      }
    };

    void flushSwInbox();

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(NOTIFICATION_BROADCAST_CHANNEL);
        channel.onmessage = (ev) => handleBusPayload(ev.data as NotificationBusMessage);
      } catch {
        channel = null;
      }
    }

    const handleSwMessage = (ev: MessageEvent) => {
      handleBusPayload(ev.data as NotificationBusMessage);
    };

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    const handleOnline = () => {
      void flushQueuedOfflineSync();
      if (prefsRef.current.backgroundSyncEnabled) {
        void registerBackgroundSyncTags(false);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void flushSwInbox();
        void refreshOfflineSyncCount();
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      if (channel) {
        channel.close();
      }
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshOfflineSyncCount]);

  // 기존 메뉴·커맨드 팔레트 하위 호환 단일 리드타임 어댑터
  const reminderLeadMinutes = useMemo<ReminderLeadMinutes>(() => {
    if (!prefs.enabled || prefs.defaultLeadMinutes.length === 0) return 0;
    const first = prefs.defaultLeadMinutes[0];
    if (first === 10 || first === 15 || first === 30) return first;
    return 10;
  }, [prefs.defaultLeadMinutes, prefs.enabled]);

  const setReminderLeadMinutes = useCallback(
    async (lead: ReminderLeadMinutes) => {
      if (lead === 0) {
        await updateNotificationPrefs((prev) => ({
          ...prev,
          enabled: false,
        }));
        return;
      }
      await updateNotificationPrefs((prev) => ({
        ...prev,
        enabled: true,
        defaultLeadMinutes: [lead],
      }));
    },
    [updateNotificationPrefs]
  );

  const summaryLabel = useMemo(() => {
    if (!prefs.enabled) return '꺼짐';
    const base = summarizeLeadMinutesList(prefs.defaultLeadMinutes);
    return prefs.webPushEnabled && isWebPushSubscribed ? `${base} · 푸시` : base;
  }, [isWebPushSubscribed, prefs.defaultLeadMinutes, prefs.enabled, prefs.webPushEnabled]);

  return {
    prefs,
    updateNotificationPrefs,
    toggleDefaultLeadMinute,
    addCustomDefaultLeadMinute,
    requestBrowserNotificationPermission,
    notificationPermission,
    capabilities,
    upcomingAlerts,
    isWebPushSubscribed,
    isPushBusy,
    enableWebPushSubscription,
    disableWebPushSubscription,
    sendTestBackgroundNotification,
    snoozeScheduledAlert,
    dismissScheduledAlert,
    pendingOfflineSyncCount,
    refreshOfflineSyncCount,
    summaryLabel,
    formatLeadMinutesLabel,
    // Legacy compatibility exports
    reminderLeadMinutes,
    setReminderLeadMinutes,
  };
}
