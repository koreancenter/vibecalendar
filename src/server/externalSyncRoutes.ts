import express from 'express';
import { z } from 'zod';
import { apiRateLimiter, textCommandJsonParser } from './security';
import {
  discoverCalDavAccount,
  pullCalDavCalendarDelta,
  pushCalDavCalendarMutations,
} from './caldavClient';
import {
  completeMicrosoftAuthCallback,
  createMicrosoftAuthUrl,
  isMicrosoftGraphConfigured,
  listMicrosoftCalendars,
  pullMicrosoftCalendarDelta,
  pushMicrosoftCalendarMutations,
  resolveMicrosoftRedirectUri,
  revokeMicrosoftSession,
} from './microsoftGraphService';
import { CalendarEventItem } from '../types';

const CalDavAuthSchema = z.object({
  serverUrl: z.string().min(4).max(512),
  username: z.string().min(1).max(256),
  appPassword: z.string().min(1).max(512),
});

const CalDavPullSchema = CalDavAuthSchema.extend({
  calendarUrl: z.string().min(8).max(1024),
  previousCtag: z.string().max(512).optional(),
  knownEtagsByHref: z.record(z.string(), z.string()).optional(),
  viewerTimeZone: z.string().max(100).optional(),
});

const OutboundEventPayloadSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime: z.string().max(8),
  endTime: z.string().max(8),
  timeZone: z.string().max(100).optional(),
  isAllDay: z.boolean(),
  category: z.enum(['업무', '방문·출장', '식사·모임', '개인', '행사·세미나', '기타']),
  location: z.string().max(300).optional(),
  locationAddress: z.string().max(400).optional(),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  content: z.string().max(10_000).optional(),
  checklist: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().max(300),
        done: z.boolean(),
      })
    )
    .optional(),
  recurrence: z
    .object({
      frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'yearly']),
      until: z.string().optional(),
      count: z.number().optional(),
    })
    .optional(),
  excludedDates: z.array(z.string()).optional(),
});

const CalDavPushSchema = CalDavAuthSchema.extend({
  calendarUrl: z.string().min(8).max(1024),
  operations: z
    .array(
      z.object({
        op: z.enum(['create', 'update', 'delete']),
        localEventId: z.string().max(200).optional(),
        remoteUid: z.string().min(1).max(300),
        remoteHref: z.string().max(1024).optional(),
        remoteEtag: z.string().max(512).optional(),
        event: OutboundEventPayloadSchema.optional(),
      })
    )
    .max(100),
});

const MicrosoftSessionSchema = z.object({
  sessionHandle: z.string().min(8).max(256),
});

const MicrosoftPullSchema = MicrosoftSessionSchema.extend({
  remoteCalendarId: z.string().min(1).max(512),
  deltaLink: z.string().max(2048).optional(),
  viewerTimeZone: z.string().max(100).optional(),
});

const MicrosoftPushSchema = MicrosoftSessionSchema.extend({
  remoteCalendarId: z.string().min(1).max(512),
  operations: z
    .array(
      z.object({
        op: z.enum(['create', 'update', 'delete']),
        localEventId: z.string().max(200).optional(),
        remoteUid: z.string().max(512).optional(),
        remoteEtag: z.string().max(512).optional(),
        event: OutboundEventPayloadSchema.optional(),
      })
    )
    .max(100),
});

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function registerExternalSyncRoutes(app: express.Express): void {
  // 1. Microsoft OAuth 2.0 + PKCE Endpoints (Popup Provider URL Flow)
  app.get('/api/auth/microsoft/status', apiRateLimiter, (req, res) => {
    const origin = typeof req.query.origin === 'string' ? req.query.origin : undefined;
    res.json({
      configured: isMicrosoftGraphConfigured(),
      callbackUrl: resolveMicrosoftRedirectUri(req, origin),
    });
  });

  app.get('/api/auth/microsoft/url', apiRateLimiter, (req, res) => {
    try {
      const origin = typeof req.query.origin === 'string' ? req.query.origin : undefined;
      const result = createMicrosoftAuthUrl(req, origin);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Microsoft OAuth URL 생성에 실패했습니다.',
      });
    }
  });

  const handleMsCallback: express.RequestHandler = async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthErr =
      typeof req.query.error_description === 'string'
        ? req.query.error_description
        : typeof req.query.error === 'string'
        ? req.query.error
        : '';

    if (oauthErr || !code || !state) {
      const safeMsg = escapeHtml(oauthErr || '인증 코드가 전달되지 않았습니다.');
      res.status(200).send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Microsoft 인증 실패</title></head>
<body style="background:#0c0e14;color:#e5e7eb;font-family:system-ui,sans-serif;padding:24px;">
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', provider: 'microsoft', error: ${JSON.stringify(
        oauthErr || '인증 취소 또는 실패'
      )} }, window.location.origin);
      window.close();
    }
  </script>
  <p style="font-size:13px;">Microsoft 인증을 완료하지 못했습니다: ${safeMsg}</p>
</body></html>`);
      return;
    }

    try {
      const session = await completeMicrosoftAuthCallback(code, state);
      const payloadJson = JSON.stringify({
        type: 'OAUTH_AUTH_SUCCESS',
        provider: 'microsoft',
        sessionHandle: session.sessionHandle,
        accountEmail: session.accountEmail,
        displayName: session.displayName,
      });

      res.status(200).send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Microsoft 연결 완료</title></head>
<body style="background:#0c0e14;color:#e5e7eb;font-family:system-ui,sans-serif;padding:24px;">
  <script>
    if (window.opener) {
      window.opener.postMessage(${payloadJson}, window.location.origin);
      window.close();
    } else {
      window.location.href = '/';
    }
  </script>
  <p style="font-size:13px;">Microsoft 캘린더 인증이 완료되었습니다. 창이 자동으로 닫힙니다.</p>
</body></html>`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '토큰 교환 중 오류가 발생했습니다.';
      res.status(200).send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Microsoft 인증 오류</title></head>
<body style="background:#0c0e14;color:#e5e7eb;font-family:system-ui,sans-serif;padding:24px;">
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', provider: 'microsoft', error: ${JSON.stringify(
        message
      )} }, window.location.origin);
      window.close();
    }
  </script>
  <p style="font-size:13px;">${escapeHtml(message)}</p>
</body></html>`);
    }
  };

  app.get(['/auth/microsoft/callback', '/auth/microsoft/callback/'], handleMsCallback);

  app.post(
    '/api/auth/microsoft/disconnect',
    apiRateLimiter,
    textCommandJsonParser,
    (req, res) => {
      const parsed = MicrosoftSessionSchema.safeParse(req.body);
      if (parsed.success) {
        revokeMicrosoftSession(parsed.data.sessionHandle);
      }
      res.json({ ok: true });
    }
  );

  // 2. Microsoft Graph Calendar Sync Endpoints
  app.post(
    '/api/sync/microsoft/calendars',
    apiRateLimiter,
    textCommandJsonParser,
    async (req, res) => {
      const parsed = MicrosoftSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: '유효하지 않은 Microsoft 세션 요청입니다.' });
        return;
      }
      try {
        const calendars = await listMicrosoftCalendars(parsed.data.sessionHandle);
        res.json({ calendars });
      } catch (err) {
        res.status(401).json({
          error: err instanceof Error ? err.message : 'Microsoft 캘린더 조회 실패',
        });
      }
    }
  );

  app.post(
    '/api/sync/microsoft/pull',
    apiRateLimiter,
    textCommandJsonParser,
    async (req, res) => {
      const parsed = MicrosoftPullSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: '유효하지 않은 Microsoft 동기화 요청입니다.' });
        return;
      }
      try {
        const result = await pullMicrosoftCalendarDelta(parsed.data);
        res.json(result);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Microsoft 일정 동기화 실패',
        });
      }
    }
  );

  app.post(
    '/api/sync/microsoft/push',
    apiRateLimiter,
    textCommandJsonParser,
    async (req, res) => {
      const parsed = MicrosoftPushSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: '유효하지 않은 Microsoft 변경 전송 요청입니다.' });
        return;
      }
      try {
        const results = await pushMicrosoftCalendarMutations({
          sessionHandle: parsed.data.sessionHandle,
          remoteCalendarId: parsed.data.remoteCalendarId,
          operations: parsed.data.operations.map((op) => ({
            ...op,
            event: op.event as CalendarEventItem | undefined,
          })),
        });
        res.json({ results });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Microsoft 원격 반영 실패',
        });
      }
    }
  );

  // 3. RFC 4791 Standard CalDAV Proxy Endpoints
  app.post(
    '/api/sync/caldav/discover',
    apiRateLimiter,
    textCommandJsonParser,
    async (req, res) => {
      const parsed = CalDavAuthSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'CalDAV 서버 주소, 계정, 앱 전용 비밀번호를 모두 입력해 주세요.' });
        return;
      }
      try {
        const result = await discoverCalDavAccount(parsed.data);
        res.json(result);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'CalDAV 서버 검색에 실패했습니다.',
        });
      }
    }
  );

  app.post(
    '/api/sync/caldav/pull',
    apiRateLimiter,
    textCommandJsonParser,
    async (req, res) => {
      const parsed = CalDavPullSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: '유효하지 않은 CalDAV 동기화 요청입니다.' });
        return;
      }
      try {
        const result = await pullCalDavCalendarDelta(parsed.data);
        res.json(result);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'CalDAV 일정 조회 실패',
        });
      }
    }
  );

  app.post(
    '/api/sync/caldav/push',
    apiRateLimiter,
    textCommandJsonParser,
    async (req, res) => {
      const parsed = CalDavPushSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: '유효하지 않은 CalDAV 변경 전송 요청입니다.' });
        return;
      }
      try {
        const results = await pushCalDavCalendarMutations(
          {
            serverUrl: parsed.data.serverUrl,
            username: parsed.data.username,
            appPassword: parsed.data.appPassword,
            calendarUrl: parsed.data.calendarUrl,
          },
          parsed.data.operations.map((op) => ({
            ...op,
            event: op.event as CalendarEventItem | undefined,
          }))
        );
        res.json({ results });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'CalDAV 원격 반영 실패',
        });
      }
    }
  );
}
