import express from 'express';
import { z } from 'zod';
import { apiRateLimiter, textCommandJsonParser } from './security';
import {
  getVapidPublicKeyInfo,
  removeClientPushRegistration,
  scheduleClientSnoozeWake,
  triggerDelayedTestWebPush,
  upsertClientWakeSchedule,
} from './webPushService';

const PushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .min(12)
    .max(2048)
    .refine((url) => /^https:\/\//i.test(url) || /^http:\/\/localhost/i.test(url), {
      message: '유효한 HTTPS Web Push 엔드포인트가 필요합니다.',
    }),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(10).max(512),
    auth: z.string().min(6).max(256),
  }),
});

const OpaqueWakeSlotSchema = z.object({
  triggerId: z.string().min(1).max(200),
  triggerAtMs: z.number().int().positive(),
  leadMinutes: z.number().int().min(0).max(10_080),
});

const SyncPushScheduleRequestSchema = z
  .object({
    clientId: z.string().min(6).max(120),
    subscription: PushSubscriptionSchema,
    triggers: z.array(OpaqueWakeSlotSchema).max(120).default([]),
  })
  .strict();

const SnoozePushRequestSchema = z
  .object({
    clientId: z.string().min(6).max(120),
    triggerId: z.string().min(1).max(200),
    delayMinutes: z.number().int().min(1).max(1440).default(10),
  })
  .strict();

const TestPushRequestSchema = z
  .object({
    subscription: PushSubscriptionSchema,
    delayMs: z.number().int().min(0).max(15_000).default(3000),
  })
  .strict();

const UnsubscribePushRequestSchema = z
  .object({
    clientId: z.string().max(120).optional().default(''),
    endpoint: z.string().max(2048).optional(),
  })
  .strict();

export function registerPushRoutes(app: express.Express): void {
  // 1. 공개 VAPID 키 조회 (개인키는 절대 클라이언트로 노출되지 않음)
  app.get('/api/push/vapid-public-key', apiRateLimiter, (_req, res) => {
    const info = getVapidPublicKeyInfo();
    res.json(info);
  });

  // 2. 제로 지식(Zero-Knowledge) 불투명 알림 타임스탬프 슬롯 동기화
  app.post(
    '/api/push/sync-schedule',
    apiRateLimiter,
    textCommandJsonParser,
    (req, res) => {
      const parsed = SyncPushScheduleRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: '유효하지 않은 푸시 스케줄 동기화 요청입니다.' });
        return;
      }

      const { clientId, subscription, triggers } = parsed.data;
      const result = upsertClientWakeSchedule(clientId, subscription, triggers);
      res.json({
        ok: true,
        scheduledCount: result.scheduledCount,
      });
    }
  );

  // 3. 앱 종료 상태 Service Worker 알림 액션에서 직접 호출하는 +10분 스누즈 예약
  app.post('/api/push/snooze', apiRateLimiter, textCommandJsonParser, (req, res) => {
    const parsed = SnoozePushRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: '유효하지 않은 스누즈 예약 요청입니다.' });
      return;
    }

    const { clientId, triggerId, delayMinutes } = parsed.data;
    const scheduled = scheduleClientSnoozeWake(clientId, triggerId, delayMinutes);
    res.json({ ok: true, scheduled });
  });

  // 4. 지연 백그라운드 Web Push 연결 검증 발송 (기본 3초 후 도착)
  app.post('/api/push/test', apiRateLimiter, textCommandJsonParser, (req, res) => {
    const parsed = TestPushRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: '유효하지 않은 테스트 푸시 요청입니다.' });
      return;
    }

    triggerDelayedTestWebPush(parsed.data.subscription, parsed.data.delayMs);
    res.json({ ok: true, delayMs: parsed.data.delayMs });
  });

  // 5. Web Push 구독 해제 및 서버 예약 취소
  app.post('/api/push/unsubscribe', apiRateLimiter, textCommandJsonParser, (req, res) => {
    const parsed = UnsubscribePushRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: '유효하지 않은 구독 해제 요청입니다.' });
      return;
    }

    removeClientPushRegistration(parsed.data.clientId, parsed.data.endpoint);
    res.json({ ok: true });
  });
}
