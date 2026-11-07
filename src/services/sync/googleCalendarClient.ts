import { CalendarEventItem, RecurrenceRule } from '../../types';
import { addDays } from '../../shared/dateUtils';
import { formatCombinedLocation, normalizePlaceAndAddress } from '../../shared/locationUtils';
import {
  decodeHybridDescriptionMetadata,
  encodeHybridDescriptionMetadata,
  NormalizedRemoteEventPayload,
  resolveSafeIanaTimeZone,
} from '../../shared/icsSyncCodec';
import { parseRruleToRecurrenceRule, recurrenceRuleToRruleString } from '../../shared/recurrenceUtils';
import { detectBrowserTimeZone, formatClockInTimeZone } from '../../shared/timeZoneUtils';

/**
 * Least-Privilege Google Calendar API Scopes (1P Workspace Integration)
 * - calendar.calendarlist.readonly: Enumerate user's subscribed calendars
 * - calendar.events: Read & bi-directionally sync calendar events
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (response: {
              access_token?: string;
              expires_in?: number;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
          };
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

// Strict in-memory token cache (NEVER persisted to localStorage or sessionStorage)
let cachedGoogleAccessToken: string | null = null;
let cachedGoogleExpiresAt = 0;
let gsiScriptPromise: Promise<void> | null = null;

export function isGoogleClientConfigured(): boolean {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  return typeof clientId === 'string' && clientId.trim().length > 8;
}

export function getCachedGoogleAccessToken(): string | null {
  if (!cachedGoogleAccessToken) return null;
  if (Date.now() + 30_000 >= cachedGoogleExpiresAt) {
    cachedGoogleAccessToken = null;
    cachedGoogleExpiresAt = 0;
    return null;
  }
  return cachedGoogleAccessToken;
}

export function clearCachedGoogleAccessToken(revokeRemote = false): void {
  const token = cachedGoogleAccessToken;
  cachedGoogleAccessToken = null;
  cachedGoogleExpiresAt = 0;
  if (revokeRemote && token && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(token, () => {});
    } catch {
      // ignore
    }
  }
}

function ensureGsiScriptLoaded(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gsiScriptPromise) return gsiScriptPromise;

  gsiScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => {
          gsiScriptPromise = null;
          reject(new Error('Google Identity Services 스크립트를 불러오지 못했습니다.'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gsiScriptPromise = null;
      reject(new Error('Google Identity Services 스크립트를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });

  return gsiScriptPromise;
}

export interface GoogleAuthResult {
  accessToken: string;
  accountEmail: string;
  displayName: string;
}

/**
 * Must be invoked directly from a user button click gesture
 */
export async function signInWithGoogleCalendar(): Promise<GoogleAuthResult> {
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) {
    throw new Error(
      'VITE_GOOGLE_CLIENT_ID 환경변수가 설정되어 있지 않습니다. AI Studio 환경변수에 Google OAuth 웹 클라이언트 ID를 등록해 주세요.'
    );
  }

  await ensureGsiScriptLoaded();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('Google OAuth 클라이언트를 초기화할 수 없습니다.');
  }

  const tokenResult = await new Promise<{ accessToken: string; expiresIn: number }>(
    (resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        prompt: 'consent',
        callback: (resp) => {
          if (resp.error || !resp.access_token) {
            reject(
              new Error(
                resp.error_description || resp.error || 'Google 인증이 취소되었거나 거부되었습니다.'
              )
            );
            return;
          }
          resolve({
            accessToken: resp.access_token,
            expiresIn: resp.expires_in ?? 3599,
          });
        },
        error_callback: (err) => {
          reject(
            new Error(
              err.type === 'popup_closed'
                ? 'Google 로그인 팝업 창이 닫혔습니다.'
                : err.message || 'Google 로그인 팝업을 열지 못했습니다.'
            )
          );
        },
      });

      client.requestAccessToken({ prompt: 'consent' });
    }
  );

  cachedGoogleAccessToken = tokenResult.accessToken;
  cachedGoogleExpiresAt = Date.now() + tokenResult.expiresIn * 1000;

  // Retrieve primary calendar identity using ONLY the approved Calendar scopes
  const primaryRes = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary',
    {
      headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
    }
  );
  const primaryData = (await primaryRes.json().catch(() => ({}))) as Record<string, unknown>;
  const accountEmail =
    typeof primaryData.id === 'string' && primaryData.id.includes('@')
      ? primaryData.id
      : 'google-calendar@workspace';
  const displayName =
    typeof primaryData.summary === 'string' && primaryData.summary.trim()
      ? primaryData.summary.trim()
      : accountEmail;

  return {
    accessToken: tokenResult.accessToken,
    accountEmail,
    displayName,
  };
}

export async function listGoogleCalendars(accessToken?: string) {
  const token = accessToken || getCachedGoogleAccessToken();
  if (!token) {
    throw new Error('Google Calendar 액세스 토큰이 만료되었습니다. 다시 로그인해 주세요.');
  }

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=freeBusyReader',
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401) clearCachedGoogleAccessToken(false);
    throw new Error(`Google 캘린더 목록 조회 실패 (HTTP ${res.status})`);
  }

  const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];
  return items.map((c) => {
    const accessRole = String(c.accessRole || 'reader');
    const canWrite = accessRole === 'owner' || accessRole === 'writer';
    return {
      remoteCalendarId: String(c.id || ''),
      name: String(c.summaryOverride || c.summary || 'Google 캘린더'),
      color: typeof c.backgroundColor === 'string' ? c.backgroundColor : '#3b82f6',
      readOnlyRemote: !canWrite,
      isPrimary: Boolean(c.primary),
    };
  });
}

function parseGoogleRecurrenceLines(lines: unknown, fallbackZone: string): {
  recurrence?: RecurrenceRule;
  excludedDates?: string[];
} {
  if (!Array.isArray(lines)) return {};
  let recurrence: RecurrenceRule | undefined;
  const excludedDates: string[] = [];

  for (const rawLine of lines) {
    if (typeof rawLine !== 'string') continue;
    const upper = rawLine.toUpperCase();
    if (upper.startsWith('RRULE:')) {
      recurrence = parseRruleToRecurrenceRule(rawLine.slice(6));
    } else if (upper.startsWith('EXDATE')) {
      const colonIdx = rawLine.indexOf(':');
      if (colonIdx > 0) {
        const tokens = rawLine.slice(colonIdx + 1).split(',');
        for (const t of tokens) {
          const clean = t.trim();
          const m = clean.match(/^(\d{4})(\d{2})(\d{2})/);
          if (m) {
            const dStr = `${m[1]}-${m[2]}-${m[3]}`;
            if (!excludedDates.includes(dStr)) excludedDates.push(dStr);
          } else if (clean.endsWith('Z')) {
            const parsed = new Date(clean);
            if (!Number.isNaN(parsed.getTime())) {
              const clock = formatClockInTimeZone(parsed, fallbackZone);
              const dStr = clock.dateShort.replace(/\./g, '-');
              if (!excludedDates.includes(dStr)) excludedDates.push(dStr);
            }
          }
        }
      }
    }
  }

  return {
    recurrence,
    excludedDates: excludedDates.length > 0 ? excludedDates : undefined,
  };
}

export async function pullGoogleCalendarDelta(params: {
  remoteCalendarId: string;
  syncToken?: string;
  viewerTimeZone?: string;
}): Promise<{
  nextSyncToken?: string;
  fullResetApplied?: boolean;
  events: NormalizedRemoteEventPayload[];
}> {
  const token = getCachedGoogleAccessToken();
  if (!token) {
    throw new Error('Google Calendar 인증 세션이 만료되었습니다. 다시 로그인해 주세요.');
  }

  const safeZone = resolveSafeIanaTimeZone(params.viewerTimeZone) || detectBrowserTimeZone() || 'UTC';
  const collected: NormalizedRemoteEventPayload[] = [];
  let pageToken: string | undefined;
  let activeSyncToken = params.syncToken;
  let fullResetApplied = false;
  let nextSyncToken: string | undefined;
  let pages = 0;

  while (pages < 12) {
    pages += 1;
    const query = new URLSearchParams({
      maxResults: '250',
      showDeleted: 'true',
      singleEvents: 'false',
    });

    if (activeSyncToken) {
      query.set('syncToken', activeSyncToken);
    } else {
      const minDate = new Date(Date.now() - 90 * 86_400_000).toISOString();
      query.set('timeMin', minDate);
    }
    if (pageToken) {
      query.set('pageToken', pageToken);
    }

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      params.remoteCalendarId
    )}/events?${query.toString()}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 410 && activeSyncToken) {
      // Google Calendar 410 GONE: syncToken invalidated -> clear cursor and perform full sync
      activeSyncToken = undefined;
      pageToken = undefined;
      collected.length = 0;
      fullResetApplied = true;
      continue;
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (res.status === 401) clearCachedGoogleAccessToken(false);
      throw new Error(`Google 일정 동기화 실패 (HTTP ${res.status})`);
    }

    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];
    for (const raw of items) {
      const id = String(raw.id || '');
      if (!id) continue;

      // Skip detached recurring instance overrides when syncing master series
      if (raw.recurringEventId && raw.status !== 'cancelled') {
        continue;
      }

      if (raw.status === 'cancelled') {
        collected.push({
          remoteUid: id,
          remoteIcalUid: typeof raw.iCalUID === 'string' ? raw.iCalUID : undefined,
          status: 'cancelled',
          title: String(raw.summary || '취소된 일정'),
          date: '1970-01-01',
          startTime: '09:00',
          endTime: '10:00',
          isAllDay: false,
        });
        continue;
      }

      const startObj = (raw.start || {}) as Record<string, unknown>;
      const endObj = (raw.end || {}) as Record<string, unknown>;

      let date = '';
      let endDate: string | undefined;
      let startTime = '09:00';
      let endTime = '10:00';
      let isAllDay = false;
      let resolvedTz: string | undefined;

      if (typeof startObj.date === 'string') {
        isAllDay = true;
        date = startObj.date.slice(0, 10);
        startTime = '09:00';
        endTime = '18:00';
        if (typeof endObj.date === 'string') {
          const inclusive = addDays(endObj.date.slice(0, 10), -1);
          if (inclusive > date) endDate = inclusive;
        }
      } else if (typeof startObj.dateTime === 'string') {
        const startInstant = new Date(startObj.dateTime);
        const itemZone =
          resolveSafeIanaTimeZone(String(startObj.timeZone || '')) || safeZone;
        resolvedTz = itemZone;

        if (!Number.isNaN(startInstant.getTime())) {
          const startClock = formatClockInTimeZone(startInstant, itemZone);
          date = startClock.dateShort.replace(/\./g, '-');
          startTime = startClock.time24;
        } else {
          date = startObj.dateTime.slice(0, 10);
          startTime = startObj.dateTime.slice(11, 16) || '09:00';
        }

        if (typeof endObj.dateTime === 'string') {
          const endInstant = new Date(endObj.dateTime);
          if (!Number.isNaN(endInstant.getTime())) {
            const endClock = formatClockInTimeZone(endInstant, itemZone);
            const eDate = endClock.dateShort.replace(/\./g, '-');
            endTime = endClock.time24;
            if (eDate > date) endDate = eDate;
          } else {
            const eDate = endObj.dateTime.slice(0, 10);
            endTime = endObj.dateTime.slice(11, 16) || '10:00';
            if (eDate > date) endDate = eDate;
          }
        }
      }

      if (!date) continue;

      const { cleanContent, checklist, extractedCategory } = decodeHybridDescriptionMetadata(
        typeof raw.description === 'string' ? raw.description : undefined
      );
      const { location, locationAddress } = normalizePlaceAndAddress(
        typeof raw.location === 'string' ? raw.location : undefined,
        undefined
      );
      const { recurrence, excludedDates } = parseGoogleRecurrenceLines(raw.recurrence, safeZone);

      collected.push({
        remoteUid: id,
        remoteIcalUid: typeof raw.iCalUID === 'string' ? raw.iCalUID : undefined,
        remoteEtag: typeof raw.etag === 'string' ? raw.etag : undefined,
        status: 'confirmed',
        title: String(raw.summary || '제목 없음'),
        date,
        endDate,
        startTime,
        endTime,
        timeZone: resolvedTz,
        isAllDay,
        category: extractedCategory,
        location,
        locationAddress,
        content: cleanContent,
        checklist,
        recurrence,
        excludedDates,
        showAsFree: String(raw.transparency || '').toLowerCase() === 'transparent',
      });
    }

    if (typeof data.nextPageToken === 'string' && data.nextPageToken) {
      pageToken = data.nextPageToken;
    } else {
      nextSyncToken = typeof data.nextSyncToken === 'string' ? data.nextSyncToken : undefined;
      break;
    }
  }

  return {
    nextSyncToken,
    fullResetApplied,
    events: collected,
  };
}

export interface GooglePushMutation {
  op: 'create' | 'update' | 'delete';
  localEventId?: string;
  remoteUid?: string;
  remoteEtag?: string;
  event?: CalendarEventItem;
}

export async function pushGoogleCalendarMutations(params: {
  remoteCalendarId: string;
  operations: GooglePushMutation[];
}) {
  const token = getCachedGoogleAccessToken();
  if (!token) {
    throw new Error('Google Calendar 인증 세션이 만료되었습니다. 다시 로그인해 주세요.');
  }

  const results: Array<{
    op: 'create' | 'update' | 'delete';
    localEventId?: string;
    remoteUid: string;
    remoteIcalUid?: string;
    remoteEtag?: string;
    ok: boolean;
    conflict?: boolean;
    error?: string;
  }> = [];

  for (const item of params.operations) {
    if (item.op === 'delete') {
      if (!item.remoteUid) continue;
      const delRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          params.remoteCalendarId
        )}/events/${encodeURIComponent(item.remoteUid)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            ...(item.remoteEtag ? { 'If-Match': item.remoteEtag } : {}),
          },
        }
      );

      if (delRes.status === 412) {
        results.push({
          op: 'delete',
          localEventId: item.localEventId,
          remoteUid: item.remoteUid,
          ok: false,
          conflict: true,
          error: 'Google Calendar 원격 버전 충돌 (HTTP 412)',
        });
        continue;
      }

      results.push({
        op: 'delete',
        localEventId: item.localEventId,
        remoteUid: item.remoteUid,
        ok: delRes.ok || delRes.status === 404 || delRes.status === 410,
        error:
          !delRes.ok && delRes.status !== 404 && delRes.status !== 410
            ? `HTTP ${delRes.status}`
            : undefined,
      });
      continue;
    }

    if (!item.event) continue;
    const ev = item.event;
    const tz = resolveSafeIanaTimeZone(ev.timeZone) || detectBrowserTimeZone() || 'UTC';

    const startObj = ev.isAllDay
      ? { date: ev.date }
      : { dateTime: `${ev.date}T${ev.startTime || '09:00'}:00`, timeZone: tz };
    const endObj = ev.isAllDay
      ? { date: addDays(ev.endDate || ev.date, 1) }
      : { dateTime: `${ev.endDate || ev.date}T${ev.endTime || '10:00'}:00`, timeZone: tz };

    const recurrenceLines: string[] = [];
    if (ev.recurrence) {
      const rrule = recurrenceRuleToRruleString(ev.recurrence);
      if (rrule) recurrenceLines.push(`RRULE:${rrule}`);
    }
    if (ev.excludedDates && ev.excludedDates.length > 0) {
      const formatted = ev.excludedDates
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .map((d) => {
          const compact = d.replace(/-/g, '');
          return ev.isAllDay
            ? compact
            : `${compact}T${(ev.startTime || '09:00').replace(':', '')}00`;
        });
      if (formatted.length > 0) {
        recurrenceLines.push(
          ev.isAllDay
            ? `EXDATE;VALUE=DATE:${formatted.join(',')}`
            : `EXDATE;TZID=${tz}:${formatted.join(',')}`
        );
      }
    }

    const bodyPayload: Record<string, unknown> = {
      summary: ev.title,
      description: encodeHybridDescriptionMetadata(ev),
      location: formatCombinedLocation(ev.location, ev.locationAddress, ', ') || '',
      start: startObj,
      end: endObj,
      ...(recurrenceLines.length > 0 ? { recurrence: recurrenceLines } : {}),
    };

    const isUpdate = item.op === 'update' && Boolean(item.remoteUid);
    const url = isUpdate
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          params.remoteCalendarId
        )}/events/${encodeURIComponent(item.remoteUid!)}`
      : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          params.remoteCalendarId
        )}/events`;

    const upRes = await fetch(url, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(isUpdate && item.remoteEtag ? { 'If-Match': item.remoteEtag } : {}),
      },
      body: JSON.stringify(bodyPayload),
    });

    if (upRes.status === 412) {
      results.push({
        op: item.op,
        localEventId: item.localEventId,
        remoteUid: item.remoteUid || '',
        ok: false,
        conflict: true,
        error: 'Google Calendar 원격 버전 충돌 (HTTP 412)',
      });
      continue;
    }

    const upData = (await upRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!upRes.ok) {
      results.push({
        op: item.op,
        localEventId: item.localEventId,
        remoteUid: item.remoteUid || '',
        ok: false,
        error: `HTTP ${upRes.status}`,
      });
      continue;
    }

    results.push({
      op: item.op,
      localEventId: item.localEventId,
      remoteUid: String(upData.id || item.remoteUid || ''),
      remoteIcalUid: typeof upData.iCalUID === 'string' ? upData.iCalUID : undefined,
      remoteEtag: typeof upData.etag === 'string' ? upData.etag : undefined,
      ok: true,
    });
  }

  return results;
}
