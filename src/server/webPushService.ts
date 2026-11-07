import fs from 'fs';
import os from 'os';
import path from 'path';
import webpush, { PushSubscription } from 'web-push';
import { OpaqueServerWakeSlot } from '../shared/notificationSchema';

interface VapidKeyBundle {
  publicKey: string;
  privateKey: string;
  subject: string;
  source: 'env' | 'auto';
}

interface ClientPushRegistration {
  clientId: string;
  subscription: PushSubscription;
  triggers: Map<string, OpaqueServerWakeSlot>;
  updatedAtMs: number;
}

const MAX_CLIENTS_IN_MEMORY = 1_500;
const MAX_TRIGGERS_PER_CLIENT = 100;
const MAX_SET_TIMEOUT_MS = 2_147_483_000; // 32-bit signed int 안전 상한 (~24.8일)
const TMP_VAPID_CACHE_PATH = path.join(os.tmpdir(), 'vibe-calendar-vapid-keys-v1.json');

let cachedVapidBundle: VapidKeyBundle | null = null;
const clientRegistry = new Map<string, ClientPushRegistration>();
let nextWakeTimer: ReturnType<typeof setTimeout> | null = null;
let isDispatching = false;

function resolveOrGenerateVapidKeys(): VapidKeyBundle {
  if (cachedVapidBundle) return cachedVapidBundle;

  const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const envSub = (process.env.VAPID_SUBJECT || 'mailto:concierge@vibecalendar.app').trim();
  const safeSubject =
    envSub.startsWith('mailto:') || envSub.startsWith('https://')
      ? envSub
      : 'mailto:concierge@vibecalendar.app';

  if (envPub && envPriv) {
    webpush.setVapidDetails(safeSubject, envPub, envPriv);
    cachedVapidBundle = {
      publicKey: envPub,
      privateKey: envPriv,
      subject: safeSubject,
      source: 'env',
    };
    return cachedVapidBundle;
  }

  // 개발·프리뷰 환경 무설정 즉시 동작을 위해 OS 임시 경로에 로컬 VAPID 키쌍 안전 캐시
  try {
    if (fs.existsSync(TMP_VAPID_CACHE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(TMP_VAPID_CACHE_PATH, 'utf8')) as {
        publicKey?: string;
        privateKey?: string;
      };
      if (raw.publicKey && raw.privateKey) {
        webpush.setVapidDetails(safeSubject, raw.publicKey, raw.privateKey);
        cachedVapidBundle = {
          publicKey: raw.publicKey,
          privateKey: raw.privateKey,
          subject: safeSubject,
          source: 'auto',
        };
        return cachedVapidBundle;
      }
    }
  } catch {
    // ignore corrupt cache and regenerate
  }

  const generated = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(
      TMP_VAPID_CACHE_PATH,
      JSON.stringify(
        {
          publicKey: generated.publicKey,
          privateKey: generated.privateKey,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  } catch {
    // read-only fs fallback: keep in memory
  }

  webpush.setVapidDetails(safeSubject, generated.publicKey, generated.privateKey);
  cachedVapidBundle = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: safeSubject,
    source: 'auto',
  };
  return cachedVapidBundle;
}

export function getVapidPublicKeyInfo(): {
  enabled: true;
  publicKey: string;
  source: 'env' | 'auto';
} {
  const bundle = resolveOrGenerateVapidKeys();
  return {
    enabled: true,
    publicKey: bundle.publicKey,
    source: bundle.source,
  };
}

function isSubscriptionExpiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const statusCode = (err as { statusCode?: number }).statusCode;
  return statusCode === 404 || statusCode === 410;
}

async function sendEncryptedPushPayload(
  subscription: PushSubscription,
  payload: Record<string, unknown>,
  ttlSeconds = 3600
): Promise<'sent' | 'expired' | 'failed'> {
  resolveOrGenerateVapidKeys();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: ttlSeconds,
      urgency: 'high',
    });
    return 'sent';
  } catch (err: unknown) {
    if (isSubscriptionExpiredError(err)) {
      return 'expired';
    }
    return 'failed';
  }
}

function scheduleNextWakeTick(): void {
  if (nextWakeTimer) {
    clearTimeout(nextWakeTimer);
    nextWakeTimer = null;
  }

  const now = Date.now();
  let earliestMs = Number.POSITIVE_INFINITY;

  for (const reg of clientRegistry.values()) {
    for (const slot of reg.triggers.values()) {
      if (slot.triggerAtMs < earliestMs) {
        earliestMs = slot.triggerAtMs;
      }
    }
  }

  if (!Number.isFinite(earliestMs)) return;

  const delayMs = Math.min(MAX_SET_TIMEOUT_MS, Math.max(50, earliestMs - now));
  nextWakeTimer = setTimeout(() => {
    void dispatchDueWakeSlots();
  }, delayMs);
  nextWakeTimer.unref?.();
}

async function dispatchDueWakeSlots(): Promise<void> {
  if (isDispatching) return;
  isDispatching = true;

  try {
    const now = Date.now();
    const expiredClients: string[] = [];

    for (const [clientId, reg] of clientRegistry.entries()) {
      const dueSlots: OpaqueServerWakeSlot[] = [];
      for (const [triggerId, slot] of reg.triggers.entries()) {
        if (slot.triggerAtMs < now - 30 * 60_000) {
          // 30분 이상 지난 만료 슬롯 정리
          reg.triggers.delete(triggerId);
          continue;
        }
        if (slot.triggerAtMs <= now + 750) {
          dueSlots.push(slot);
          reg.triggers.delete(triggerId);
        }
      }

      if (dueSlots.length === 0) continue;

      // 동시에 여러 슬롯이 도달한 경우 대표 트리거로 깨우면 Service Worker가 IDB 내 모든 도달 알림을 일괄 하이드레이션
      const primary = dueSlots[0];
      const status = await sendEncryptedPushPayload(reg.subscription, {
        type: 'WAKE_REMINDER',
        triggerId: primary.triggerId,
        triggerAtMs: primary.triggerAtMs,
        leadMinutes: primary.leadMinutes,
        batchCount: dueSlots.length,
        sentAtMs: Date.now(),
      });

      if (status === 'expired') {
        expiredClients.push(clientId);
      }
    }

    for (const cid of expiredClients) {
      clientRegistry.delete(cid);
    }
  } finally {
    isDispatching = false;
    scheduleNextWakeTick();
  }
}

export function upsertClientWakeSchedule(
  clientId: string,
  subscription: PushSubscription,
  rawSlots: OpaqueServerWakeSlot[]
): { scheduledCount: number } {
  resolveOrGenerateVapidKeys();

  if (!clientRegistry.has(clientId) && clientRegistry.size >= MAX_CLIENTS_IN_MEMORY) {
    const oldestKey = clientRegistry.keys().next().value;
    if (oldestKey !== undefined) {
      clientRegistry.delete(oldestKey);
    }
  }

  const now = Date.now();
  const existing = clientRegistry.get(clientId);
  const triggerMap = new Map<string, OpaqueServerWakeSlot>();

  // 기존 스누즈 슬롯(snooze: 접두어)이 아직 유효하면 보존
  if (existing) {
    for (const [tid, slot] of existing.triggers.entries()) {
      if (tid.startsWith('snooze:') && slot.triggerAtMs > now) {
        triggerMap.set(tid, slot);
      }
    }
  }

  const sortedValid = rawSlots
    .filter((s) => s.triggerAtMs > now - 30_000 && s.triggerAtMs <= now + 15 * 86_400_000)
    .sort((a, b) => a.triggerAtMs - b.triggerAtMs)
    .slice(0, MAX_TRIGGERS_PER_CLIENT);

  for (const slot of sortedValid) {
    triggerMap.set(slot.triggerId, slot);
  }

  clientRegistry.set(clientId, {
    clientId,
    subscription,
    triggers: triggerMap,
    updatedAtMs: now,
  });

  scheduleNextWakeTick();
  return { scheduledCount: triggerMap.size };
}

export function scheduleClientSnoozeWake(
  clientId: string,
  triggerId: string,
  delayMinutes: number
): boolean {
  const reg = clientRegistry.get(clientId);
  if (!reg) return false;

  const safeDelay = Math.min(1440, Math.max(1, Math.round(delayMinutes)));
  const triggerAtMs = Date.now() + safeDelay * 60_000;
  reg.triggers.set(triggerId, {
    triggerId,
    triggerAtMs,
    leadMinutes: safeDelay,
  });
  reg.updatedAtMs = Date.now();

  scheduleNextWakeTick();
  return true;
}

export function removeClientPushRegistration(clientId: string, endpoint?: string): void {
  if (clientId && clientRegistry.has(clientId)) {
    clientRegistry.delete(clientId);
  }
  if (endpoint) {
    for (const [cid, reg] of clientRegistry.entries()) {
      if (reg.subscription.endpoint === endpoint) {
        clientRegistry.delete(cid);
      }
    }
  }
  scheduleNextWakeTick();
}

export function triggerDelayedTestWebPush(
  subscription: PushSubscription,
  delayMs: number
): void {
  const safeDelay = Math.min(15_000, Math.max(0, Math.round(delayMs)));
  const timer = setTimeout(() => {
    void sendEncryptedPushPayload(
      subscription,
      {
        type: 'TEST_PUSH',
        title: '바이브 행사 · 백그라운드 Web Push 연결 확인',
        body: '앱이나 브라우저 창이 닫혀 있어도 설정한 리드타임에 맞춰 알림이 전달됩니다.',
        sentAtMs: Date.now(),
      },
      120
    );
  }, safeDelay);
  timer.unref?.();
}
