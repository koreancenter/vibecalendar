import {
  BG_SYNC_TAG_EXTERNAL,
  BG_SYNC_TAG_REMINDERS,
  OpaqueServerWakeSlot,
  PERIODIC_SYNC_TAG,
  ScheduledAlertRecord,
} from '../../shared/notificationSchema';

const CLIENT_ID_STORAGE_KEY = 'vibe_push_client_id_v1';

export interface NotificationPlatformCapabilities {
  serviceWorker: boolean;
  notification: boolean;
  pushManager: boolean;
  backgroundSync: boolean;
  periodicBackgroundSync: boolean;
  osTimestampTrigger: boolean;
}

export interface SerializedPushSubscriptionPayload {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface SyncManagerLike {
  register: (tag: string) => Promise<void>;
}

interface PeriodicSyncManagerLike {
  register: (tag: string, options?: { minInterval: number }) => Promise<void>;
}

type ExtendedServiceWorkerRegistration = ServiceWorkerRegistration & {
  sync?: SyncManagerLike;
  periodicSync?: PeriodicSyncManagerLike;
};

export function getOrCreatePushClientId(): string {
  if (typeof window === 'undefined') return 'vc-server-placeholder';
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing && existing.length >= 8) {
      return existing;
    }
    const randomPart =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        : `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const created = `vc-${randomPart}`;
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return `vc-ephemeral-${Date.now().toString(36)}`;
  }
}

export function detectNotificationCapabilities(): NotificationPlatformCapabilities {
  if (typeof window === 'undefined') {
    return {
      serviceWorker: false,
      notification: false,
      pushManager: false,
      backgroundSync: false,
      periodicBackgroundSync: false,
      osTimestampTrigger: false,
    };
  }

  return {
    serviceWorker: 'serviceWorker' in navigator,
    notification: typeof Notification !== 'undefined',
    pushManager: 'PushManager' in window,
    backgroundSync: 'SyncManager' in window,
    periodicBackgroundSync: 'PeriodicSyncManager' in window,
    osTimestampTrigger:
      typeof Notification !== 'undefined' && 'showTrigger' in Notification.prototype,
  };
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getActiveServiceWorkerRegistration(
  timeoutMs = 3500
): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const direct = await navigator.serviceWorker.getRegistration();
    if (direct && (direct.active || direct.waiting || direct.installing)) {
      if (direct.active) return direct;
    }

    const readyOrTimeout = await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration | null>((resolve) => {
        window.setTimeout(() => resolve(direct ?? null), timeoutMs);
      }),
    ]);

    return readyOrTimeout;
  } catch {
    return null;
  }
}

export function serializePushSubscription(
  sub: PushSubscription
): SerializedPushSubscriptionPayload | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!sub.endpoint || !p256dh || !auth) {
    return null;
  }
  return {
    endpoint: sub.endpoint,
    expirationTime: sub.expirationTime ?? null,
    keys: {
      p256dh,
      auth,
    },
  };
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  const reg = await getActiveServiceWorkerRegistration(2500);
  if (!reg || !reg.pushManager) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function subscribeBrowserWebPush(): Promise<PushSubscription> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    throw new Error('이 브라우저는 시스템 알림 API를 지원하지 않습니다.');
  }

  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      throw new Error('브라우저 알림 권한이 허용되어야 백그라운드 푸시를 활성화할 수 있습니다.');
    }
  } else if (Notification.permission === 'denied') {
    throw new Error(
      '브라우저 주소창의 사이트 권한 설정에서 알림(Notifications) 차단을 해제해 주세요.'
    );
  }

  const reg = await getActiveServiceWorkerRegistration(4500);
  if (!reg || !reg.pushManager) {
    throw new Error(
      '활성화된 PWA Service Worker 또는 PushManager를 찾을 수 없습니다. 새 탭 또는 설치된 앱에서 다시 시도해 주세요.'
    );
  }

  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    return existing;
  }

  const keyRes = await fetch('/api/push/vapid-public-key');
  const keyData = (await keyRes.json().catch(() => ({}))) as {
    publicKey?: string;
    error?: string;
  };
  if (!keyRes.ok || !keyData.publicKey) {
    throw new Error(keyData.error || '서버 VAPID 공개키를 불러오지 못했습니다.');
  }

  const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);
  try {
    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as BufferSource,
    });
  } catch (err) {
    throw new Error(
      err instanceof Error && err.message
        ? `Web Push 구독 등록 실패: ${err.message}`
        : '브라우저 푸시 서비스 구독에 실패했습니다 (독립 탭이나 설치된 PWA에서 지원됩니다).'
    );
  }
}

export async function unsubscribeBrowserWebPush(clientId: string): Promise<void> {
  const existing = await getExistingPushSubscription();
  const endpoint = existing?.endpoint;
  if (existing) {
    try {
      await existing.unsubscribe();
    } catch {
      // ignore browser unsubscribe errors
    }
  }

  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        ...(endpoint ? { endpoint } : {}),
      }),
    });
  } catch {
    // ignore network error while offline
  }
}

/**
 * 제로 지식(Zero-Knowledge) 타임스탬프 웨이크업 슬롯 동기화:
 * 일정 제목·장소·메모 등 평문 정보는 일절 서버로 전송하지 않고
 * 오직 { triggerId, triggerAtMs, leadMinutes }만 전달합니다.
 */
export async function syncWakeSlotsWithServer(
  clientId: string,
  subscription: PushSubscription,
  alerts: ScheduledAlertRecord[]
): Promise<number> {
  const serialized = serializePushSubscription(subscription);
  if (!serialized) return 0;

  const opaqueTriggers: OpaqueServerWakeSlot[] = alerts.map((a) => ({
    triggerId: a.triggerId,
    triggerAtMs: a.triggerAtMs,
    leadMinutes: a.leadMinutes,
  }));

  try {
    const res = await fetch('/api/push/sync-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        subscription: serialized,
        triggers: opaqueTriggers,
      }),
    });
    if (!res.ok) return 0;
    const data = (await res.json().catch(() => ({}))) as { scheduledCount?: number };
    return typeof data.scheduledCount === 'number' ? data.scheduledCount : 0;
  } catch {
    return 0;
  }
}

export async function scheduleServerSnoozeWake(
  clientId: string,
  triggerId: string,
  delayMinutes = 10
): Promise<void> {
  try {
    await fetch('/api/push/snooze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        triggerId,
        delayMinutes,
      }),
    });
  } catch {
    // ignore offline error
  }
}

export async function registerBackgroundSyncTags(enablePeriodic = false): Promise<{
  bgSyncRegistered: boolean;
  periodicRegistered: boolean;
}> {
  const reg = (await getActiveServiceWorkerRegistration(
    3000
  )) as ExtendedServiceWorkerRegistration | null;
  if (!reg) {
    return { bgSyncRegistered: false, periodicRegistered: false };
  }

  let bgSyncRegistered = false;
  let periodicRegistered = false;

  if (reg.sync && typeof reg.sync.register === 'function') {
    try {
      await Promise.all([
        reg.sync.register(BG_SYNC_TAG_REMINDERS),
        reg.sync.register(BG_SYNC_TAG_EXTERNAL),
      ]);
      bgSyncRegistered = true;
    } catch {
      bgSyncRegistered = false;
    }
  }

  if (enablePeriodic && reg.periodicSync && typeof reg.periodicSync.register === 'function') {
    try {
      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        const status = await navigator.permissions
          .query({ name: 'periodic-background-sync' as PermissionName })
          .catch(() => null);
        if (!status || status.state === 'granted') {
          await reg.periodicSync.register(PERIODIC_SYNC_TAG, {
            minInterval: 15 * 60 * 1000,
          });
          periodicRegistered = true;
        }
      } else {
        await reg.periodicSync.register(PERIODIC_SYNC_TAG, {
          minInterval: 15 * 60 * 1000,
        });
        periodicRegistered = true;
      }
    } catch {
      periodicRegistered = false;
    }
  }

  return { bgSyncRegistered, periodicRegistered };
}

export async function postReconcileToServiceWorker(): Promise<void> {
  const reg = await getActiveServiceWorkerRegistration(2500);
  const targetWorker = reg?.active || navigator.serviceWorker?.controller;
  if (!targetWorker) return;
  try {
    targetWorker.postMessage({ type: 'SW_RECONCILE_REMINDERS' });
  } catch {
    // ignore postMessage errors
  }
}

export async function triggerBackgroundTestAlert(options: {
  useWebPush: boolean;
  delayMs?: number;
  clientId: string;
}): Promise<'web-push' | 'sw-local' | 'dom-fallback'> {
  const delayMs = options.delayMs ?? 3000;

  if (typeof window !== 'undefined' && typeof Notification !== 'undefined') {
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        throw new Error('테스트 알림을 받으려면 브라우저 알림 권한을 허용해 주세요.');
      }
    } else if (Notification.permission === 'denied') {
      throw new Error(
        '브라우저 알림 권한이 차단되어 있습니다. 주소창 좌측 권한 아이콘에서 알림을 허용해 주세요.'
      );
    }
  }

  if (options.useWebPush) {
    const sub = await getExistingPushSubscription();
    const serialized = sub ? serializePushSubscription(sub) : null;
    if (serialized) {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: serialized,
          delayMs,
        }),
      });
      if (res.ok) {
        return 'web-push';
      }
    }
  }

  const reg = await getActiveServiceWorkerRegistration(2500);
  const worker = reg?.active || navigator.serviceWorker?.controller;
  if (worker) {
    worker.postMessage({
      type: 'SW_DELAYED_LOCAL_TEST',
      delayMs,
      clientId: options.clientId,
      title: '바이브 행사 · 로컬 백그라운드 알림 검증',
      body: 'Service Worker 알림 엔진이 정상 작동 중입니다. 10분 스누즈 및 딥링크 열기를 지원합니다.',
    });
    return 'sw-local';
  }

  window.setTimeout(() => {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('바이브 행사 · 로컬 알림 검증', {
          body: '지정된 리드타임에 맞춰 로컬 알림이 정상적으로 표시됩니다.',
          icon: '/pwa-192x192.png',
        });
      }
    } catch {
      // ignore restricted iframe errors
    }
  }, delayMs);

  return 'dom-fallback';
}
