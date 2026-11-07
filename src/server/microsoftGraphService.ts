import crypto from 'crypto';
import express from 'express';
import { CalendarEventItem, RecurrenceRule } from '../types';
import { addDays } from '../shared/dateUtils';
import { formatCombinedLocation, normalizePlaceAndAddress } from '../shared/locationUtils';
import {
  decodeHybridDescriptionMetadata,
  encodeHybridDescriptionMetadata,
  NormalizedRemoteEventPayload,
  resolveSafeIanaTimeZone,
} from '../shared/icsSyncCodec';
import { detectBrowserTimeZone } from '../shared/timeZoneUtils';

const MS_SCOPES = 'openid profile email offline_access User.Read Calendars.ReadWrite';

interface PkcePendingState {
  codeVerifier: string;
  redirectUri: string;
  tenantId: string;
  createdAt: number;
}

interface MicrosoftTokenSession {
  sessionHandle: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tenantId: string;
  redirectUri: string;
  accountEmail: string;
  displayName: string;
  updatedAt: number;
}

const pendingPkceStates = new Map<string, PkcePendingState>();
const microsoftSessions = new Map<string, MicrosoftTokenSession>();

const PKCE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingPkceStates.entries()) {
    if (now - v.createdAt > PKCE_TTL_MS) pendingPkceStates.delete(k);
  }
  for (const [k, v] of microsoftSessions.entries()) {
    if (now - v.updatedAt > SESSION_TTL_MS) microsoftSessions.delete(k);
  }
}, 5 * 60 * 1000);
cleanupInterval.unref();

function toBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function resolveMicrosoftRedirectUri(req: express.Request, explicitOrigin?: string): string {
  const configuredAppUrl = process.env.APP_URL?.trim();
  if (configuredAppUrl && /^https?:\/\//i.test(configuredAppUrl)) {
    return `${configuredAppUrl.replace(/\/$/, '')}/auth/microsoft/callback`;
  }
  if (explicitOrigin && /^https?:\/\/[A-Za-z0-9.:-]+$/.test(explicitOrigin.trim())) {
    return `${explicitOrigin.trim().replace(/\/$/, '')}/auth/microsoft/callback`;
  }
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.get('host') || 'localhost:3000';
  return `${proto}://${host}/auth/microsoft/callback`;
}

export function isMicrosoftGraphConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID?.trim());
}

export function createMicrosoftAuthUrl(req: express.Request, explicitOrigin?: string): {
  url: string;
  redirectUri: string;
} {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error(
      'Microsoft Graph 연동 환경변수(MICROSOFT_CLIENT_ID)가 설정되지 않았습니다. AI Studio 환경변수에 등록해 주세요.'
    );
  }

  const tenantId = (process.env.MICROSOFT_TENANT_ID || 'common').trim() || 'common';
  const redirectUri = resolveMicrosoftRedirectUri(req, explicitOrigin);

  const state = toBase64Url(crypto.randomBytes(24));
  const codeVerifier = toBase64Url(crypto.randomBytes(32));
  const codeChallenge = toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());

  if (pendingPkceStates.size >= 500) {
    const oldest = pendingPkceStates.keys().next().value;
    if (oldest) pendingPkceStates.delete(oldest);
  }

  pendingPkceStates.set(state, {
    codeVerifier,
    redirectUri,
    tenantId,
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: MS_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  return {
    url: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${params.toString()}`,
    redirectUri,
  };
}

export async function completeMicrosoftAuthCallback(
  code: string,
  state: string
): Promise<MicrosoftTokenSession> {
  const pending = pendingPkceStates.get(state);
  pendingPkceStates.delete(state);
  if (!pending || Date.now() - pending.createdAt > PKCE_TTL_MS) {
    throw new Error('OAuth 인증 세션(state)이 만료되었거나 유효하지 않습니다. 다시 시도해 주세요.');
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error('MICROSOFT_CLIENT_ID 환경변수가 설정되어 있지 않습니다.');
  }
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.codeVerifier,
    scope: MS_SCOPES,
  });
  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(pending.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }
  );

  const tokenData = (await tokenRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!tokenRes.ok || typeof tokenData.access_token !== 'string') {
    const desc =
      typeof tokenData.error_description === 'string'
        ? tokenData.error_description.slice(0, 180)
        : 'Microsoft 토큰 교환에 실패했습니다.';
    throw new Error(desc);
  }

  const accessToken = tokenData.access_token;
  const refreshToken =
    typeof tokenData.refresh_token === 'string' ? tokenData.refresh_token : undefined;
  const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;

  // Fetch /me profile
  const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meData = (await meRes.json().catch(() => ({}))) as Record<string, unknown>;
  const accountEmail = String(meData.mail || meData.userPrincipalName || 'outlook-user@microsoft.com');
  const displayName = String(meData.displayName || accountEmail);

  const sessionHandle = `ms_${toBase64Url(crypto.randomBytes(24))}`;
  if (microsoftSessions.size >= 300) {
    const oldest = microsoftSessions.keys().next().value;
    if (oldest) microsoftSessions.delete(oldest);
  }

  const session: MicrosoftTokenSession = {
    sessionHandle,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    tenantId: pending.tenantId,
    redirectUri: pending.redirectUri,
    accountEmail,
    displayName,
    updatedAt: Date.now(),
  };
  microsoftSessions.set(sessionHandle, session);
  return session;
}

export function revokeMicrosoftSession(sessionHandle: string): void {
  microsoftSessions.delete(sessionHandle);
}

async function getValidMicrosoftAccessToken(sessionHandle: string): Promise<string> {
  const session = microsoftSessions.get(sessionHandle);
  if (!session) {
    throw new Error('Microsoft Graph 인증 세션이 만료되었습니다. 계정을 다시 연결해 주세요.');
  }

  session.updatedAt = Date.now();
  if (Date.now() + 60_000 < session.expiresAt) {
    return session.accessToken;
  }

  if (!session.refreshToken) {
    microsoftSessions.delete(sessionHandle);
    throw new Error('Microsoft Graph 액세스 토큰이 만료되었습니다. 계정을 다시 연결해 주세요.');
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
    scope: MS_SCOPES,
  });
  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(session.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== 'string') {
    microsoftSessions.delete(sessionHandle);
    throw new Error('Microsoft 토큰 자동 갱신에 실패했습니다. 다시 로그인해 주세요.');
  }

  session.accessToken = data.access_token;
  if (typeof data.refresh_token === 'string') {
    session.refreshToken = data.refresh_token;
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  session.expiresAt = Date.now() + expiresIn * 1000;
  return session.accessToken;
}

const OUTLOOK_COLOR_MAP: Record<string, string> = {
  auto: '#3b82f6',
  lightBlue: '#3b82f6',
  lightGreen: '#10b981',
  lightOrange: '#d97706',
  lightGray: '#94a3b8',
  lightYellow: '#d4af37',
  lightTeal: '#10b981',
  lightPink: '#f43f5e',
  lightRed: '#f43f5e',
  lightPurple: '#a855f7',
};

export async function listMicrosoftCalendars(sessionHandle: string) {
  const accessToken = await getValidMicrosoftAccessToken(sessionHandle);
  const res = await fetch(
    'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,color,hexColor,canEdit,isDefaultCalendar',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Microsoft 캘린더 목록 조회 실패 (HTTP ${res.status})`);
  }

  const items = Array.isArray(data.value) ? (data.value as Array<Record<string, unknown>>) : [];
  return items.map((c) => {
    const hex = typeof c.hexColor === 'string' && c.hexColor.startsWith('#') ? c.hexColor : undefined;
    const mappedColor = hex || OUTLOOK_COLOR_MAP[String(c.color || 'auto')] || '#3b82f6';
    return {
      remoteCalendarId: String(c.id || ''),
      name: String(c.name || 'Outlook 캘린더'),
      color: mappedColor,
      readOnlyRemote: c.canEdit === false,
      isPrimary: Boolean(c.isDefaultCalendar),
    };
  });
}

function parseGraphRecurrence(rawRec: unknown): RecurrenceRule | undefined {
  if (!rawRec || typeof rawRec !== 'object') return undefined;
  const rec = rawRec as Record<string, unknown>;
  const pattern = rec.pattern as Record<string, unknown> | undefined;
  const range = rec.range as Record<string, unknown> | undefined;
  if (!pattern) return undefined;

  const pType = String(pattern.type || '').toLowerCase();
  const interval = Number(pattern.interval || 1);
  let frequency: RecurrenceRule['frequency'] | null = null;
  if (pType === 'daily') frequency = 'daily';
  else if (pType === 'weekly') frequency = interval === 2 ? 'biweekly' : 'weekly';
  else if (pType.includes('monthly')) frequency = 'monthly';
  else if (pType.includes('yearly')) frequency = 'yearly';
  if (!frequency) return undefined;

  const until =
    range && String(range.type) === 'endDate' && typeof range.endDate === 'string'
      ? range.endDate.slice(0, 10)
      : undefined;
  const count =
    range && String(range.type) === 'numbered' && typeof range.numberOfOccurrences === 'number'
      ? range.numberOfOccurrences
      : undefined;

  return { frequency, until, count };
}

function toGraphRecurrence(event: CalendarEventItem): Record<string, unknown> | null {
  if (!event.recurrence) return null;
  const freq = event.recurrence.frequency;
  const dt = new Date(`${event.date}T00:00:00Z`);
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dow = dayNames[dt.getUTCDay()];

  let pattern: Record<string, unknown>;
  if (freq === 'daily') {
    pattern = { type: 'daily', interval: 1 };
  } else if (freq === 'weekly' || freq === 'biweekly') {
    pattern = { type: 'weekly', interval: freq === 'biweekly' ? 2 : 1, daysOfWeek: [dow] };
  } else if (freq === 'monthly') {
    pattern = { type: 'absoluteMonthly', interval: 1, dayOfMonth: dt.getUTCDate() };
  } else {
    pattern = {
      type: 'absoluteYearly',
      interval: 1,
      dayOfMonth: dt.getUTCDate(),
      month: dt.getUTCMonth() + 1,
    };
  }

  const range: Record<string, unknown> = event.recurrence.until
    ? { type: 'endDate', startDate: event.date, endDate: event.recurrence.until }
    : event.recurrence.count
    ? { type: 'numbered', startDate: event.date, numberOfOccurrences: event.recurrence.count }
    : { type: 'noEnd', startDate: event.date };

  return { pattern, range };
}

export async function pullMicrosoftCalendarDelta(params: {
  sessionHandle: string;
  remoteCalendarId: string;
  deltaLink?: string;
  viewerTimeZone?: string;
}): Promise<{
  nextDeltaLink?: string;
  events: NormalizedRemoteEventPayload[];
}> {
  const accessToken = await getValidMicrosoftAccessToken(params.sessionHandle);
  const safeZone = resolveSafeIanaTimeZone(params.viewerTimeZone) || 'UTC';

  const now = new Date();
  const startIso = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const endIso = new Date(now.getTime() + 365 * 86_400_000).toISOString();

  let nextUrl: string | undefined = params.deltaLink
    ? params.deltaLink
    : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
        params.remoteCalendarId
      )}/calendarView/delta?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}`;

  let nextDeltaLink: string | undefined;
  const collected: NormalizedRemoteEventPayload[] = [];
  let pages = 0;

  while (nextUrl && pages < 10) {
    pages += 1;
    const res = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: `outlook.body-content-type="text", outlook.timezone="${safeZone}"`,
      },
    });

    if (res.status === 410 && params.deltaLink && pages === 1) {
      // Delta token expired -> fallback to fresh window
      nextUrl = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
        params.remoteCalendarId
      )}/calendarView/delta?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}`;
      continue;
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Microsoft 일정 동기화 실패 (HTTP ${res.status})`);
    }

    const items = Array.isArray(data.value) ? (data.value as Array<Record<string, unknown>>) : [];
    for (const raw of items) {
      const id = String(raw.id || '');
      if (!id) continue;

      if (raw['@removed'] || raw.isCancelled === true) {
        collected.push({
          remoteUid: id,
          remoteIcalUid: typeof raw.iCalUId === 'string' ? raw.iCalUId : undefined,
          status: 'cancelled',
          title: String(raw.subject || '취소된 일정'),
          date: '1970-01-01',
          startTime: '09:00',
          endTime: '10:00',
          isAllDay: false,
        });
        continue;
      }

      // Skip expanded occurrence instances if seriesMaster is also synced, or normalize cleanly
      const eventType = String(raw.type || '');
      if (eventType === 'occurrence') {
        // calendarView/delta expands occurrences; keep singleInstance & exception, or normalize occurrences when master isn't returned
      }

      const startObj = (raw.start || {}) as Record<string, unknown>;
      const endObj = (raw.end || {}) as Record<string, unknown>;
      const startDtStr = String(startObj.dateTime || '');
      const endDtStr = String(endObj.dateTime || '');
      if (!startDtStr) continue;

      const isAllDay = Boolean(raw.isAllDay);
      const startDate = startDtStr.slice(0, 10);
      const rawEndDate = endDtStr ? endDtStr.slice(0, 10) : startDate;

      let endDate: string | undefined;
      let startTime = startDtStr.slice(11, 16) || '09:00';
      let endTime = endDtStr.slice(11, 16) || '10:00';

      if (isAllDay) {
        startTime = '09:00';
        endTime = '18:00';
        const inclusiveEnd = addDays(rawEndDate, -1);
        if (inclusiveEnd > startDate) endDate = inclusiveEnd;
      } else if (rawEndDate > startDate) {
        endDate = rawEndDate;
      }

      const resolvedTz = !isAllDay
        ? resolveSafeIanaTimeZone(String(startObj.timeZone || '')) || safeZone
        : undefined;

      const bodyObj = (raw.body || {}) as Record<string, unknown>;
      const { cleanContent, checklist, extractedCategory } = decodeHybridDescriptionMetadata(
        typeof bodyObj.content === 'string' ? bodyObj.content : undefined
      );

      const locObj = (raw.location || {}) as Record<string, unknown>;
      const addrObj = (locObj.address || {}) as Record<string, unknown>;
      const addrStr = [addrObj.street, addrObj.city, addrObj.state, addrObj.countryOrRegion]
        .filter((s): s is string => typeof s === 'string' && Boolean(s.trim()))
        .join(', ');
      const { location, locationAddress } = normalizePlaceAndAddress(
        typeof locObj.displayName === 'string' ? locObj.displayName : undefined,
        addrStr || undefined
      );

      const coordsObj = (locObj.coordinates || {}) as Record<string, unknown>;
      const lat = typeof coordsObj.latitude === 'number' ? coordsObj.latitude : undefined;
      const lng = typeof coordsObj.longitude === 'number' ? coordsObj.longitude : undefined;

      collected.push({
        remoteUid: id,
        remoteIcalUid: typeof raw.iCalUId === 'string' ? raw.iCalUId : undefined,
        remoteEtag: typeof raw['@odata.etag'] === 'string' ? raw['@odata.etag'] : undefined,
        status: 'confirmed',
        title: String(raw.subject || '제목 없음'),
        date: startDate,
        endDate,
        startTime,
        endTime,
        timeZone: resolvedTz,
        isAllDay,
        category: extractedCategory,
        location,
        locationAddress,
        locationLat: lat,
        locationLng: lng,
        content: cleanContent,
        checklist,
        recurrence: parseGraphRecurrence(raw.recurrence),
        showAsFree: String(raw.showAs || '').toLowerCase() === 'free',
      });
    }

    if (typeof data['@odata.nextLink'] === 'string') {
      nextUrl = data['@odata.nextLink'];
    } else {
      nextDeltaLink =
        typeof data['@odata.deltaLink'] === 'string' ? data['@odata.deltaLink'] : undefined;
      nextUrl = undefined;
    }
  }

  return {
    nextDeltaLink,
    events: collected,
  };
}

export interface MicrosoftPushMutation {
  op: 'create' | 'update' | 'delete';
  localEventId?: string;
  remoteUid?: string;
  remoteEtag?: string;
  event?: CalendarEventItem;
}

export async function pushMicrosoftCalendarMutations(params: {
  sessionHandle: string;
  remoteCalendarId: string;
  operations: MicrosoftPushMutation[];
}) {
  const accessToken = await getValidMicrosoftAccessToken(params.sessionHandle);
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
        `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
          params.remoteCalendarId
        )}/events/${encodeURIComponent(item.remoteUid)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
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
          error: 'Outlook 원격 일정 버전과 충돌했습니다 (HTTP 412).',
        });
        continue;
      }

      results.push({
        op: 'delete',
        localEventId: item.localEventId,
        remoteUid: item.remoteUid,
        ok: delRes.ok || delRes.status === 404,
        error: !delRes.ok && delRes.status !== 404 ? `HTTP ${delRes.status}` : undefined,
      });
      continue;
    }

    if (!item.event) continue;
    const ev = item.event;
    const tz = resolveSafeIanaTimeZone(ev.timeZone) || detectBrowserTimeZone() || 'UTC';
    const startPayload = ev.isAllDay
      ? { dateTime: `${ev.date}T00:00:00`, timeZone: 'UTC' }
      : { dateTime: `${ev.date}T${ev.startTime || '09:00'}:00`, timeZone: tz };
    const endPayload = ev.isAllDay
      ? { dateTime: `${addDays(ev.endDate || ev.date, 1)}T00:00:00`, timeZone: 'UTC' }
      : { dateTime: `${ev.endDate || ev.date}T${ev.endTime || '10:00'}:00`, timeZone: tz };

    const combinedLoc = formatCombinedLocation(ev.location, ev.locationAddress, ', ');
    const graphBody: Record<string, unknown> = {
      subject: ev.title,
      isAllDay: Boolean(ev.isAllDay),
      start: startPayload,
      end: endPayload,
      body: {
        contentType: 'text',
        content: encodeHybridDescriptionMetadata(ev),
      },
      location: combinedLoc ? { displayName: combinedLoc } : { displayName: '' },
      recurrence: toGraphRecurrence(ev),
    };

    const isUpdate = item.op === 'update' && Boolean(item.remoteUid);
    const url = isUpdate
      ? `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
          params.remoteCalendarId
        )}/events/${encodeURIComponent(item.remoteUid!)}`
      : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
          params.remoteCalendarId
        )}/events`;

    const upRes = await fetch(url, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(isUpdate && item.remoteEtag ? { 'If-Match': item.remoteEtag } : {}),
      },
      body: JSON.stringify(graphBody),
    });

    if (upRes.status === 412) {
      results.push({
        op: item.op,
        localEventId: item.localEventId,
        remoteUid: item.remoteUid || '',
        ok: false,
        conflict: true,
        error: 'Outlook 원격 일정 버전과 충돌했습니다 (HTTP 412).',
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
      remoteIcalUid: typeof upData.iCalUId === 'string' ? upData.iCalUId : undefined,
      remoteEtag: typeof upData['@odata.etag'] === 'string' ? upData['@odata.etag'] : undefined,
      ok: true,
    });
  }

  return results;
}
