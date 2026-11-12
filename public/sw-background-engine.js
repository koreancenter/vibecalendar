/* eslint-disable no-restricted-globals */
/**
 * 바이브 캘린더 — PWA Service Worker Background Sync & Local/Push Notification Engine
 * Loaded via Workbox importScripts('/sw-background-engine.js')
 *
 * Zero-Knowledge Privacy Guarantee:
 * - Server Web Push payloads contain ONLY opaque wake signals ({ type, triggerId, triggerAtMs, leadMinutes }).
 * - Event titles/times (or masked Vault strings) are hydrated strictly on-device from IndexedDB.
 */
(function initVibeBackgroundEngine() {
  var DB_NAME = 'vibe_notification_engine_db_v1';
  var DB_VERSION = 1;
  var STORE_ALERTS = 'scheduled_alerts';
  var STORE_FIRED = 'fired_ledger';
  var STORE_OUTBOX = 'offline_sync_outbox';
  var STORE_INBOX = 'sw_action_inbox';
  var BUS_CHANNEL = 'vibe_notification_engine_bus_v1';

  var BG_SYNC_TAG_EXTERNAL = 'vibe-calendar-bg-sync';
  var BG_SYNC_TAG_REMINDERS = 'vibe-reminder-reconcile';
  var PERIODIC_SYNC_TAG = 'vibe-calendar-periodic-sync';

  function broadcastBus(payload) {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        var ch = new BroadcastChannel(BUS_CHANNEL);
        ch.postMessage(payload);
        ch.close();
      }
    } catch (_err) {
      // ignore BroadcastChannel restrictions
    }
  }

  function openDb() {
    return new Promise(function (resolve) {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      try {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE_ALERTS)) {
            var alertStore = db.createObjectStore(STORE_ALERTS, { keyPath: 'triggerId' });
            alertStore.createIndex('byTriggerAt', 'triggerAtMs', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_FIRED)) {
            db.createObjectStore(STORE_FIRED, { keyPath: 'triggerId' });
          }
          if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
            db.createObjectStore(STORE_OUTBOX, { keyPath: 'taskId' });
          }
          if (!db.objectStoreNames.contains(STORE_INBOX)) {
            db.createObjectStore(STORE_INBOX, { keyPath: 'actionId' });
          }
        };
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          resolve(null);
        };
      } catch (_e) {
        resolve(null);
      }
    });
  }

  function claimDueAlerts(specificTriggerId) {
    return openDb().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve) {
        var dueToFire = [];
        var now = Date.now();
        var gracePastMs = now - 20 * 60 * 1000; // 최대 20분 지연 도달까지 복구 발송
        var lookaheadMs = now + 20 * 1000; // 20초 이내 임박 트리거 병합 처리

        try {
          var tx = db.transaction([STORE_ALERTS, STORE_FIRED], 'readwrite');
          var alertStore = tx.objectStore(STORE_ALERTS);
          var firedStore = tx.objectStore(STORE_FIRED);

          var alertsReq = alertStore.getAll();
          var firedReq = firedStore.getAll();

          tx.oncomplete = function () {
            db.close();
            resolve(dueToFire);
          };
          tx.onerror = function () {
            db.close();
            resolve([]);
          };

          alertsReq.onsuccess = function () {
            firedReq.onsuccess = function () {
              var allAlerts = Array.isArray(alertsReq.result) ? alertsReq.result : [];
              var allFired = Array.isArray(firedReq.result) ? firedReq.result : [];
              var firedSet = new Set(
                allFired.map(function (f) {
                  return f.triggerId;
                })
              );

              for (var i = 0; i < allAlerts.length; i++) {
                var item = allAlerts[i];
                if (!item || !item.triggerId || firedSet.has(item.triggerId)) continue;

                var isTarget = specificTriggerId && item.triggerId === specificTriggerId;
                var isTimeDue =
                  typeof item.triggerAtMs === 'number' &&
                  item.triggerAtMs >= gracePastMs &&
                  item.triggerAtMs <= lookaheadMs;

                if (isTarget || isTimeDue) {
                  firedSet.add(item.triggerId);
                  firedStore.put({ triggerId: item.triggerId, firedAtMs: now });
                  alertStore.delete(item.triggerId);
                  dueToFire.push(item);
                }
              }
            };
          };
        } catch (_err) {
          db.close();
          resolve([]);
        }
      });
    });
  }

  function listFutureAlertsForTriggers() {
    return openDb().then(function (db) {
      if (!db) return [];
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction([STORE_ALERTS, STORE_FIRED], 'readonly');
          var alertsReq = tx.objectStore(STORE_ALERTS).getAll();
          var firedReq = tx.objectStore(STORE_FIRED).getAll();
          tx.oncomplete = function () {
            var allAlerts = Array.isArray(alertsReq.result) ? alertsReq.result : [];
            var allFired = Array.isArray(firedReq.result) ? firedReq.result : [];
            var firedSet = new Set(
              allFired.map(function (f) {
                return f.triggerId;
              })
            );
            var now = Date.now();
            var upcoming = allAlerts
              .filter(function (a) {
                return a && !firedSet.has(a.triggerId) && a.triggerAtMs > now + 5000;
              })
              .sort(function (a, b) {
                return a.triggerAtMs - b.triggerAtMs;
              })
              .slice(0, 25);
            db.close();
            resolve(upcoming);
          };
          tx.onerror = function () {
            db.close();
            resolve([]);
          };
        } catch (_e) {
          db.close();
          resolve([]);
        }
      });
    });
  }

  function buildNotificationOptions(alertRecord) {
    var urgent = typeof alertRecord.leadMinutes === 'number' && alertRecord.leadMinutes <= 15;
    return {
      body: alertRecord.notificationBody || '예정된 일정을 확인해 주세요.',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: alertRecord.triggerId,
      renotify: true,
      requireInteraction: urgent,
      timestamp: alertRecord.eventStartEpochMs || Date.now(),
      data: {
        triggerId: alertRecord.triggerId,
        eventId: alertRecord.eventId,
        masterEventId: alertRecord.masterEventId || alertRecord.eventId,
        eventDate: alertRecord.eventDate,
        localStartTime: alertRecord.localStartTime,
        notificationTitle: alertRecord.notificationTitle,
        notificationBody: alertRecord.notificationBody,
        eventStartEpochMs: alertRecord.eventStartEpochMs,
        isMasked: Boolean(alertRecord.isMasked),
        clientId: alertRecord.clientId || '',
      },
      actions: [
        { action: 'snooze-10', title: '10분 후 다시 알림' },
        { action: 'complete-event', title: '완료 처리' },
      ],
    };
  }

  function showAlertNotifications(alerts) {
    if (!alerts || alerts.length === 0) return Promise.resolve();
    var tasks = alerts.map(function (alertItem) {
      broadcastBus({
        type: 'ALERT_FIRED',
        triggerId: alertItem.triggerId,
        firedAtMs: Date.now(),
      });
      var title = alertItem.notificationTitle || '바이브 캘린더 · 일정 알림';
      var options = buildNotificationOptions(alertItem);
      return self.registration.showNotification(title, options).catch(function () {});
    });
    return Promise.all(tasks);
  }

  /**
   * Chromium OS-level Notification Triggers (TimestampTrigger) 점진적 향상 지원
   * 지원되는 플랫폼에서는 브라우저 프로세스 종료 상태에서도 OS 커널 타이머가 직접 알림을 표시합니다.
   */
  function syncOsTimestampTriggers() {
    var supportsShowTrigger =
      typeof Notification !== 'undefined' &&
      'showTrigger' in Notification.prototype &&
      typeof self.TimestampTrigger === 'function';

    if (!supportsShowTrigger) return Promise.resolve();

    return listFutureAlertsForTriggers().then(function (upcoming) {
      var tasks = upcoming.map(function (alertItem) {
        try {
          var opts = buildNotificationOptions(alertItem);
          opts.showTrigger = new self.TimestampTrigger(alertItem.triggerAtMs);
          return self.registration
            .showNotification(alertItem.notificationTitle || '바이브 캘린더 · 일정 알림', opts)
            .catch(function () {});
        } catch (_e) {
          return Promise.resolve();
        }
      });
      return Promise.all(tasks);
    });
  }

  function saveSwInboxAction(record) {
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE_INBOX, 'readwrite');
          tx.objectStore(STORE_INBOX).put(record);
          tx.oncomplete = function () {
            db.close();
            resolve();
          };
          tx.onerror = function () {
            db.close();
            resolve();
          };
        } catch (_e) {
          db.close();
          resolve();
        }
      });
    });
  }

  function insertSnoozeAlertInDb(snoozeAlert) {
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE_ALERTS, 'readwrite');
          tx.objectStore(STORE_ALERTS).put(snoozeAlert);
          tx.oncomplete = function () {
            db.close();
            resolve();
          };
          tx.onerror = function () {
            db.close();
            resolve();
          };
        } catch (_e) {
          db.close();
          resolve();
        }
      });
    });
  }

  function processOfflineOutboxInBackground() {
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE_OUTBOX, 'readonly');
          var req = tx.objectStore(STORE_OUTBOX).getAll();
          req.onsuccess = function () {
            var tasks = Array.isArray(req.result) ? req.result : [];
            db.close();
            if (tasks.length === 0) {
              resolve();
              return;
            }
            self.clients
              .matchAll({ type: 'window', includeUncontrolled: true })
              .then(function (windowClients) {
                if (windowClients && windowClients.length > 0) {
                  windowClients.forEach(function (client) {
                    client.postMessage({
                      type: 'SW_EXECUTE_BACKGROUND_SYNC',
                      reason: 'background-sync',
                    });
                  });
                  broadcastBus({
                    type: 'SW_EXECUTE_BACKGROUND_SYNC',
                    reason: 'background-sync',
                  });
                  resolve();
                  return;
                }
                // 열린 창이 없으면 다음 앱 실행 즉시 델타 동기화가 수행되도록 인박스 마커 기록
                saveSwInboxAction({
                  actionId: 'pending-external-sync',
                  actionType: 'PENDING_EXTERNAL_SYNC',
                  createdAtMs: Date.now(),
                }).then(resolve);
              })
              .catch(function () {
                resolve();
              });
          };
          req.onerror = function () {
            db.close();
            resolve();
          };
        } catch (_e) {
          db.close();
          resolve();
        }
      });
    });
  }

  // 1. Web Push 수신 (브라우저·앱 완전 종료 시 VAPID 서버가 정밀 시각에 깨움)
  self.addEventListener('push', function (event) {
    var payload = {};
    if (event.data) {
      try {
        payload = event.data.json() || {};
      } catch (_e) {
        payload = { type: 'WAKE_REMINDER' };
      }
    }

    var workPromise = (function () {
      if (payload.type === 'TEST_PUSH') {
        return self.registration.showNotification(
          payload.title || '바이브 캘린더 · 백그라운드 푸시 검증 완료',
          {
            body:
              payload.body ||
              '앱이나 탭이 닫혀 있어도 지정된 리드타임에 이 경로로 정확한 알림이 도착합니다.',
            icon: '/pwa-192x192.png',
            badge: '/pwa-192x192.png',
            tag: 'vibe-test-push-' + Date.now(),
            renotify: true,
            data: {
              triggerId: 'test-push',
              eventId: '',
              eventDate: '',
            },
          }
        );
      }

      if (payload.type === 'BG_SYNC_POKE') {
        return processOfflineOutboxInBackground();
      }

      var targetTriggerId =
        typeof payload.triggerId === 'string' && payload.triggerId ? payload.triggerId : null;

      return claimDueAlerts(targetTriggerId).then(function (matchedAlerts) {
        if (matchedAlerts.length > 0) {
          return showAlertNotifications(matchedAlerts);
        }
        // IndexedDB가 비워진 특수 상황에서도 Web Push 필수 사용자 알림 정책(userVisibleOnly) 준수
        var leadLabel =
          typeof payload.leadMinutes === 'number' && payload.leadMinutes > 0
            ? payload.leadMinutes + '분 후 일정 시작'
            : '예정된 일정 시작';
        return self.registration.showNotification('바이브 캘린더 · ' + leadLabel, {
          body: '예정된 캘린더 일정을 확인하려면 탭하세요.',
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag: targetTriggerId || 'vibe-wake-fallback',
          data: {
            triggerId: targetTriggerId || '',
            eventId: '',
            eventDate: '',
          },
        });
      });
    })();

    event.waitUntil(workPromise);
  });

  // 2. One-Shot Background Sync (오프라인 복구 시 밀린 알림 점검 및 외부 캘린더 동기화 재개)
  self.addEventListener('sync', function (event) {
    if (event.tag === BG_SYNC_TAG_REMINDERS) {
      event.waitUntil(
        claimDueAlerts(null)
          .then(showAlertNotifications)
          .then(syncOsTimestampTriggers)
      );
      return;
    }

    if (event.tag === BG_SYNC_TAG_EXTERNAL) {
      event.waitUntil(
        Promise.all([
          claimDueAlerts(null).then(showAlertNotifications),
          processOfflineOutboxInBackground(),
        ])
      );
    }
  });

  // 3. Periodic Background Sync (백그라운드 주기적 리마인더 스윕)
  self.addEventListener('periodicsync', function (event) {
    if (event.tag === PERIODIC_SYNC_TAG) {
      event.waitUntil(
        claimDueAlerts(null)
          .then(showAlertNotifications)
          .then(syncOsTimestampTriggers)
      );
    }
  });

  // 4. 시스템 알림 클릭 & 인터랙티브 액션 처리 (10분 스누즈 / 완료 처리 / 딥링크 포커스)
  self.addEventListener('notificationclick', function (event) {
    var notif = event.notification;
    var data = (notif && notif.data) || {};
    var action = event.action || '';
    notif.close();

    if (action === 'snooze-10') {
      var snoozeDelayMin = 10;
      var snoozeAtMs = Date.now() + snoozeDelayMin * 60 * 1000;
      var snoozeId =
        'snooze:' + (data.eventId || 'evt') + ':' + Math.floor(snoozeAtMs / 1000);

      var snoozeRecord = {
        triggerId: snoozeId,
        eventId: data.eventId || '',
        masterEventId: data.masterEventId || data.eventId || '',
        eventDate: data.eventDate || '',
        localStartTime: data.localStartTime || '',
        leadMinutes: snoozeDelayMin,
        triggerAtMs: snoozeAtMs,
        eventStartEpochMs: data.eventStartEpochMs || snoozeAtMs,
        notificationTitle: '바이브 캘린더 · 다시 알림 (10분 연장)',
        notificationBody: data.notificationBody || '예정된 일정을 다시 확인해 주세요.',
        isAllDay: false,
        isMasked: Boolean(data.isMasked),
        isSnoozed: true,
        clientId: data.clientId || '',
        updatedAtMs: Date.now(),
      };

      var snoozeWork = insertSnoozeAlertInDb(snoozeRecord)
        .then(function () {
          broadcastBus({
            type: 'SW_SNOOZED_ALERT',
            triggerId: snoozeId,
            snoozedUntilMs: snoozeAtMs,
          });
          if (data.clientId) {
            return fetch('/api/push/snooze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId: data.clientId,
                triggerId: snoozeId,
                delayMinutes: snoozeDelayMin,
              }),
            }).catch(function () {});
          }
          return Promise.resolve();
        })
        .then(syncOsTimestampTriggers);

      event.waitUntil(snoozeWork);
      return;
    }

    if (action === 'complete-event' && data.eventId) {
      var completeWork = saveSwInboxAction({
        actionId: 'complete:' + data.eventId + ':' + Date.now(),
        actionType: 'COMPLETE_EVENT',
        eventId: data.eventId,
        eventDate: data.eventDate || '',
        createdAtMs: Date.now(),
      }).then(function () {
        broadcastBus({
          type: 'SW_COMPLETE_EVENT',
          eventId: data.eventId,
          eventDate: data.eventDate || '',
        });
        return self.clients
          .matchAll({ type: 'window', includeUncontrolled: true })
          .then(function (clients) {
            clients.forEach(function (client) {
              client.postMessage({
                type: 'SW_COMPLETE_EVENT',
                eventId: data.eventId,
                eventDate: data.eventDate || '',
              });
            });
          });
      });

      event.waitUntil(completeWork);
      return;
    }

    // 기본 클릭: 열려 있는 워크스페이스 탭 포커스 또는 새 독립 PWA 창 열기 + 해당 일정 딥링크
    var targetParams = [];
    if (data.eventId) {
      targetParams.push('focusEvent=' + encodeURIComponent(data.eventId));
    }
    if (data.eventDate) {
      targetParams.push('date=' + encodeURIComponent(data.eventDate));
    }
    var targetUrl = '/' + (targetParams.length > 0 ? '?' + targetParams.join('&') : '');

    var openOrFocusWork = self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (windowClients) {
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if ('focus' in client) {
            if (data.eventId) {
              client.postMessage({
                type: 'SW_FOCUS_EVENT',
                eventId: data.eventId,
                eventDate: data.eventDate || '',
              });
              broadcastBus({
                type: 'SW_FOCUS_EVENT',
                eventId: data.eventId,
                eventDate: data.eventDate || '',
              });
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return null;
      });

    event.waitUntil(openOrFocusWork);
  });

  // 5. 클라이언트 -> Service Worker 메시지 브리지 (즉시 재조정 및 지연 로컬 백그라운드 테스트)
  self.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'SW_RECONCILE_REMINDERS') {
      event.waitUntil(
        claimDueAlerts(null)
          .then(showAlertNotifications)
          .then(syncOsTimestampTriggers)
      );
      return;
    }

    if (msg.type === 'SW_DELAYED_LOCAL_TEST') {
      var delayMs =
        typeof msg.delayMs === 'number' && msg.delayMs >= 0 && msg.delayMs <= 15000
          ? msg.delayMs
          : 3000;
      var testWork = new Promise(function (resolve) {
        setTimeout(resolve, delayMs);
      }).then(function () {
        return self.registration.showNotification(
          msg.title || '바이브 캘린더 · 로컬 백그라운드 알림 검증',
          {
            body:
              msg.body ||
              'Service Worker 알림 엔진이 정상 작동 중입니다. 스누즈 및 일정 열기 액션을 지원합니다.',
            icon: '/pwa-192x192.png',
            badge: '/pwa-192x192.png',
            tag: 'vibe-local-sw-test-' + Date.now(),
            renotify: true,
            data: {
              triggerId: 'local-sw-test',
              eventId: msg.eventId || '',
              eventDate: msg.eventDate || '',
              clientId: msg.clientId || '',
            },
            actions: [{ action: 'snooze-10', title: '10분 후 다시 알림' }],
          }
        );
      });
      event.waitUntil(testWork);
    }
  });
})();
