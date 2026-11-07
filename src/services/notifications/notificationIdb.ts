import {
  IDB_NOTIFICATION_DB_NAME,
  IDB_NOTIFICATION_DB_VERSION,
  IDB_STORE_FIRED_LEDGER,
  IDB_STORE_OFFLINE_OUTBOX,
  IDB_STORE_SCHEDULED_ALERTS,
  IDB_STORE_SW_ACTION_INBOX,
  OfflineSyncTaskRecord,
  ScheduledAlertRecord,
  SwActionInboxRecord,
} from '../../shared/notificationSchema';

function isIndexedDbSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openNotificationDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbSupported()) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NOTIFICATION_DB_NAME, IDB_NOTIFICATION_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_SCHEDULED_ALERTS)) {
          const alertStore = db.createObjectStore(IDB_STORE_SCHEDULED_ALERTS, {
            keyPath: 'triggerId',
          });
          alertStore.createIndex('byTriggerAt', 'triggerAtMs', { unique: false });
        }
        if (!db.objectStoreNames.contains(IDB_STORE_FIRED_LEDGER)) {
          db.createObjectStore(IDB_STORE_FIRED_LEDGER, { keyPath: 'triggerId' });
        }
        if (!db.objectStoreNames.contains(IDB_STORE_OFFLINE_OUTBOX)) {
          db.createObjectStore(IDB_STORE_OFFLINE_OUTBOX, { keyPath: 'taskId' });
        }
        if (!db.objectStoreNames.contains(IDB_STORE_SW_ACTION_INBOX)) {
          db.createObjectStore(IDB_STORE_SW_ACTION_INBOX, { keyPath: 'actionId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * 계산된 향후 알림 스케줄을 IndexedDB에 원자적으로 갱신합니다.
 * 이때 사용자가 알림에서 직접 누른 활성 스누즈(isSnoozed) 레코드는 보존합니다.
 */
export async function replaceScheduledAlertsInIdb(
  nextAlerts: ScheduledAlertRecord[]
): Promise<ScheduledAlertRecord[]> {
  const db = await openNotificationDb();
  if (!db) return nextAlerts;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([IDB_STORE_SCHEDULED_ALERTS, IDB_STORE_FIRED_LEDGER], 'readwrite');
      const alertStore = tx.objectStore(IDB_STORE_SCHEDULED_ALERTS);
      const firedStore = tx.objectStore(IDB_STORE_FIRED_LEDGER);

      const getAllReq = alertStore.getAll();
      getAllReq.onsuccess = () => {
        const existing = Array.isArray(getAllReq.result)
          ? (getAllReq.result as ScheduledAlertRecord[])
          : [];
        const now = Date.now();
        const activeSnoozes = existing.filter(
          (item) => Boolean(item.isSnoozed) && item.triggerAtMs > now - 60_000
        );

        alertStore.clear();
        const mergedMap = new Map<string, ScheduledAlertRecord>();
        for (const alert of nextAlerts) {
          mergedMap.set(alert.triggerId, alert);
        }
        for (const snooze of activeSnoozes) {
          mergedMap.set(snooze.triggerId, snooze);
        }

        const mergedList = Array.from(mergedMap.values()).sort(
          (a, b) => a.triggerAtMs - b.triggerAtMs
        );
        for (const item of mergedList) {
          alertStore.put(item);
        }

        // 오래된 발송 이력(7일 경과) 정리
        const firedAllReq = firedStore.getAll();
        firedAllReq.onsuccess = () => {
          const firedItems = Array.isArray(firedAllReq.result)
            ? (firedAllReq.result as Array<{ triggerId: string; firedAtMs: number }>)
            : [];
          const cutoff = now - 7 * 86_400_000;
          for (const rec of firedItems) {
            if (rec.firedAtMs < cutoff) {
              firedStore.delete(rec.triggerId);
            }
          }
        };

        tx.oncomplete = () => {
          db.close();
          resolve(mergedList);
        };
      };
      tx.onerror = () => {
        db.close();
        resolve(nextAlerts);
      };
    } catch {
      db.close();
      resolve(nextAlerts);
    }
  });
}

export async function putSnoozedAlertInIdb(alert: ScheduledAlertRecord): Promise<void> {
  const db = await openNotificationDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_SCHEDULED_ALERTS, 'readwrite');
      tx.objectStore(IDB_STORE_SCHEDULED_ALERTS).put({ ...alert, isSnoozed: true });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function removeScheduledAlertFromIdb(triggerId: string): Promise<void> {
  const db = await openNotificationDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_SCHEDULED_ALERTS, 'readwrite');
      tx.objectStore(IDB_STORE_SCHEDULED_ALERTS).delete(triggerId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function listUpcomingAlertsFromIdb(): Promise<ScheduledAlertRecord[]> {
  const db = await openNotificationDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([IDB_STORE_SCHEDULED_ALERTS, IDB_STORE_FIRED_LEDGER], 'readonly');
      const alertsReq = tx.objectStore(IDB_STORE_SCHEDULED_ALERTS).getAll();
      const firedReq = tx.objectStore(IDB_STORE_FIRED_LEDGER).getAll();

      tx.oncomplete = () => {
        const rawAlerts = Array.isArray(alertsReq.result)
          ? (alertsReq.result as ScheduledAlertRecord[])
          : [];
        const firedSet = new Set(
          (Array.isArray(firedReq.result)
            ? (firedReq.result as Array<{ triggerId: string }>)
            : []
          ).map((f) => f.triggerId)
        );
        const now = Date.now();
        const active = rawAlerts
          .filter((a) => !firedSet.has(a.triggerId) && a.triggerAtMs >= now - 90_000)
          .sort((a, b) => a.triggerAtMs - b.triggerAtMs);
        db.close();
        resolve(active);
      };
      tx.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}

/**
 * 다중 탭 · Service Worker 간 중복 발송 원천 차단을 위해
 * fired_ledger에 아직 기록되지 않은 경우에만 원자적으로 선점(claim)합니다.
 */
export async function claimAlertFireInIdb(
  triggerId: string,
  firedAtMs = Date.now()
): Promise<boolean> {
  const db = await openNotificationDb();
  if (!db) return true;

  return new Promise((resolve) => {
    let claimed = false;
    try {
      const tx = db.transaction([IDB_STORE_FIRED_LEDGER, IDB_STORE_SCHEDULED_ALERTS], 'readwrite');
      const firedStore = tx.objectStore(IDB_STORE_FIRED_LEDGER);
      const alertStore = tx.objectStore(IDB_STORE_SCHEDULED_ALERTS);
      const checkReq = firedStore.get(triggerId);

      checkReq.onsuccess = () => {
        if (!checkReq.result) {
          claimed = true;
          firedStore.put({ triggerId, firedAtMs });
          alertStore.delete(triggerId);
        }
      };

      tx.oncomplete = () => {
        db.close();
        resolve(claimed);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(true);
    }
  });
}

export async function enqueueOfflineSyncTask(
  reason: string,
  accountId?: string
): Promise<OfflineSyncTaskRecord> {
  const record: OfflineSyncTaskRecord = {
    taskId: accountId ? `sync-acc-${accountId}` : 'sync-all',
    reason,
    accountId,
    queuedAtMs: Date.now(),
  };

  const db = await openNotificationDb();
  if (!db) return record;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_OFFLINE_OUTBOX, 'readwrite');
      tx.objectStore(IDB_STORE_OFFLINE_OUTBOX).put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });

  return record;
}

export async function countOfflineSyncTasks(): Promise<number> {
  const db = await openNotificationDb();
  if (!db) return 0;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_OFFLINE_OUTBOX, 'readonly');
      const req = tx.objectStore(IDB_STORE_OFFLINE_OUTBOX).count();
      req.onsuccess = () => {
        db.close();
        resolve(req.result || 0);
      };
      req.onerror = () => {
        db.close();
        resolve(0);
      };
    } catch {
      db.close();
      resolve(0);
    }
  });
}

export async function drainOfflineSyncTasks(): Promise<OfflineSyncTaskRecord[]> {
  const db = await openNotificationDb();
  if (!db) return [];

  return new Promise((resolve) => {
    let tasks: OfflineSyncTaskRecord[] = [];
    try {
      const tx = db.transaction(IDB_STORE_OFFLINE_OUTBOX, 'readwrite');
      const store = tx.objectStore(IDB_STORE_OFFLINE_OUTBOX);
      const req = store.getAll();
      req.onsuccess = () => {
        tasks = Array.isArray(req.result) ? (req.result as OfflineSyncTaskRecord[]) : [];
        store.clear();
      };
      tx.oncomplete = () => {
        db.close();
        resolve(tasks);
      };
      tx.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}

export async function drainSwActionInbox(): Promise<SwActionInboxRecord[]> {
  const db = await openNotificationDb();
  if (!db) return [];

  return new Promise((resolve) => {
    let actions: SwActionInboxRecord[] = [];
    try {
      const tx = db.transaction(IDB_STORE_SW_ACTION_INBOX, 'readwrite');
      const store = tx.objectStore(IDB_STORE_SW_ACTION_INBOX);
      const req = store.getAll();
      req.onsuccess = () => {
        actions = Array.isArray(req.result) ? (req.result as SwActionInboxRecord[]) : [];
        store.clear();
      };
      tx.oncomplete = () => {
        db.close();
        resolve(actions);
      };
      tx.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}

export async function purgeAllNotificationIdbData(): Promise<void> {
  const db = await openNotificationDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(
        [
          IDB_STORE_SCHEDULED_ALERTS,
          IDB_STORE_FIRED_LEDGER,
          IDB_STORE_OFFLINE_OUTBOX,
          IDB_STORE_SW_ACTION_INBOX,
        ],
        'readwrite'
      );
      tx.objectStore(IDB_STORE_SCHEDULED_ALERTS).clear();
      tx.objectStore(IDB_STORE_FIRED_LEDGER).clear();
      tx.objectStore(IDB_STORE_OFFLINE_OUTBOX).clear();
      tx.objectStore(IDB_STORE_SW_ACTION_INBOX).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
