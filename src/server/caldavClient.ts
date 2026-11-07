import dns from 'dns/promises';
import net from 'net';
import { XMLParser } from 'fast-xml-parser';
import { CalendarEventItem } from '../types';
import {
  NormalizedRemoteEventPayload,
  parseCalDavIcsResource,
  serializeEventToCalDavIcs,
} from '../shared/icsSyncCodec';

const CALDAV_TIMEOUT_MS = 18_000;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (tagName) =>
    tagName === 'response' ||
    tagName === 'propstat' ||
    tagName === 'comp' ||
    tagName === 'href',
});

export interface CalDavAuthInput {
  serverUrl: string;
  username: string;
  appPassword: string;
}

export interface DiscoveredCalDavCalendar {
  remoteCalendarId: string;
  name: string;
  color: string;
  ctag?: string;
  syncToken?: string;
  readOnlyRemote: boolean;
}

export interface CalDavDiscoveryResult {
  normalizedServerUrl: string;
  principalUrl: string;
  calendarHomeUrl: string;
  calendars: DiscoveredCalDavCalendar[];
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // Cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // Multicast / reserved
    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // Unique local
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true; // Link-local
    }
    if (lower.startsWith('::ffff:')) {
      return isPrivateOrReservedIp(lower.slice(7));
    }
    return false;
  }

  return true;
}

export async function validateSafeExternalCalDavUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    const withProto = /^https?:\/\//i.test(rawUrl.trim())
      ? rawUrl.trim()
      : `https://${rawUrl.trim()}`;
    parsed = new URL(withProto);
  } catch {
    throw new Error('유효한 CalDAV 서버 URL 형식이 아닙니다.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('보안을 위해 HTTPS(https://) 프로토콜을 사용하는 CalDAV 서버만 연결할 수 있습니다.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URL 내부에 계정 정보를 포함하지 말고 전용 입력란을 사용해 주세요.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error('내부 루프백 또는 사설 호스트로는 CalDAV 연결을 수행할 수 없습니다.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error('사설 IP 또는 예약된 네트워크 대역으로는 연결할 수 없습니다.');
    }
    return parsed;
  }

  const resolvedRecords = await dns.lookup(hostname, { all: true });
  if (!resolvedRecords.length) {
    throw new Error('CalDAV 서버 도메인을 찾을 수 없습니다.');
  }
  for (const rec of resolvedRecords) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error('사설 네트워크로 해석되는 도메인에는 보안상 연결할 수 없습니다.');
    }
  }

  return parsed;
}

function makeBasicAuthHeader(username: string, appPassword: string): string {
  const encoded = Buffer.from(`${username}:${appPassword}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

async function sendDavRequest(
  targetUrl: URL,
  options: {
    method: 'PROPFIND' | 'REPORT' | 'PUT' | 'DELETE';
    authHeader: string;
    depth?: '0' | '1';
    body?: string;
    contentType?: string;
    ifMatchEtag?: string;
    ifNoneMatchStar?: boolean;
  }
): Promise<{ status: number; headers: Headers; text: string; finalUrl: URL }> {
  await validateSafeExternalCalDavUrl(targetUrl.toString());

  let currentUrl = new URL(targetUrl.toString());
  const maxRedirects = 4;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALDAV_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        Authorization: options.authHeader,
        'User-Agent': 'VibeCalendar-CalDAV/1.0',
      };
      if (options.depth !== undefined) {
        headers.Depth = options.depth;
      }
      if (options.body !== undefined) {
        headers['Content-Type'] = options.contentType || 'application/xml; charset=utf-8';
      }
      if (options.ifMatchEtag) {
        headers['If-Match'] = options.ifMatchEtag;
      }
      if (options.ifNoneMatchStar) {
        headers['If-None-Match'] = '*';
      }

      const res = await fetch(currentUrl.toString(), {
        method: options.method,
        headers,
        body: options.body,
        redirect: 'manual',
        signal: controller.signal,
      });

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        if (!location) {
          throw new Error('CalDAV 리다이렉트 응답에 대상 경로가 없습니다.');
        }
        const nextUrl = new URL(location, currentUrl);
        await validateSafeExternalCalDavUrl(nextUrl.toString());
        currentUrl = nextUrl;
        continue;
      }

      const text = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        text,
        finalUrl: currentUrl,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('CalDAV 리다이렉트 횟수 상한을 초과했습니다.');
}

function extractFirstHref(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const rec = node as Record<string, unknown>;
  const rawHref = rec.href;
  if (typeof rawHref === 'string' && rawHref.trim()) {
    return rawHref.trim();
  }
  if (Array.isArray(rawHref) && rawHref.length > 0) {
    const first = rawHref[0];
    if (typeof first === 'string') return first.trim();
    if (first && typeof first === 'object' && typeof (first as Record<string, unknown>)['#text'] === 'string') {
      return String((first as Record<string, unknown>)['#text']).trim();
    }
  }
  return null;
}

function getOkPropsFromResponse(respObj: Record<string, unknown>): Record<string, unknown> {
  const propstats = Array.isArray(respObj.propstat)
    ? (respObj.propstat as Array<Record<string, unknown>>)
    : respObj.propstat && typeof respObj.propstat === 'object'
    ? [respObj.propstat as Record<string, unknown>]
    : [];

  const merged: Record<string, unknown> = {};
  for (const ps of propstats) {
    const statusStr = typeof ps.status === 'string' ? ps.status : '';
    if (!statusStr || statusStr.includes(' 200 ')) {
      if (ps.prop && typeof ps.prop === 'object') {
        Object.assign(merged, ps.prop as Record<string, unknown>);
      }
    }
  }
  return merged;
}

function normalizeHexColor(raw: unknown, fallback = '#6366f1'): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  const m6 = trimmed.match(/^#([0-9a-fA-F]{6})/);
  if (m6) return `#${m6[1].toLowerCase()}`;
  const m3 = trimmed.match(/^#([0-9a-fA-F]{3})$/);
  if (m3) return `#${m3[1].toLowerCase()}`;
  return fallback;
}

function xmlEscape(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function discoverCalDavAccount(input: CalDavAuthInput): Promise<CalDavDiscoveryResult> {
  const baseUrl = await validateSafeExternalCalDavUrl(input.serverUrl);
  const authHeader = makeBasicAuthHeader(input.username, input.appPassword);

  // Step 1: Discover current-user-principal (try provided URL first, fallback to /.well-known/caldav)
  const principalQueryBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal />
  </d:prop>
</d:propfind>`;

  let step1 = await sendDavRequest(baseUrl, {
    method: 'PROPFIND',
    depth: '0',
    authHeader,
    body: principalQueryBody,
  });

  if (step1.status === 401 || step1.status === 403) {
    throw new Error('CalDAV 인증에 실패했습니다. 아이디 또는 앱 전용 비밀번호(App Password)를 확인해 주세요.');
  }

  if (step1.status >= 400 && baseUrl.pathname === '/') {
    const wellKnownUrl = new URL('/.well-known/caldav', baseUrl);
    step1 = await sendDavRequest(wellKnownUrl, {
      method: 'PROPFIND',
      depth: '0',
      authHeader,
      body: principalQueryBody,
    });
    if (step1.status === 401 || step1.status === 403) {
      throw new Error('CalDAV 인증에 실패했습니다. 아이디 또는 앱 전용 비밀번호를 확인해 주세요.');
    }
  }

  if (step1.status >= 400) {
    throw new Error(`CalDAV 서버 응답 오류 (HTTP ${step1.status})`);
  }

  const parsedStep1 = xmlParser.parse(step1.text) as Record<string, unknown>;
  const responses1 = ((parsedStep1.multistatus as Record<string, unknown>)?.response ?? []) as Array<
    Record<string, unknown>
  >;

  let principalHref: string | null = null;
  for (const r of responses1) {
    const props = getOkPropsFromResponse(r);
    principalHref = extractFirstHref(props['current-user-principal']);
    if (principalHref) break;
  }

  const principalUrl = principalHref
    ? new URL(principalHref, step1.finalUrl)
    : step1.finalUrl;

  // Step 2: Discover calendar-home-set from Principal URL
  const homeSetBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set />
  </d:prop>
</d:propfind>`;

  const step2 = await sendDavRequest(principalUrl, {
    method: 'PROPFIND',
    depth: '0',
    authHeader,
    body: homeSetBody,
  });

  let calendarHomeUrl = principalUrl;
  if (step2.status >= 200 && step2.status < 300) {
    const parsedStep2 = xmlParser.parse(step2.text) as Record<string, unknown>;
    const responses2 = ((parsedStep2.multistatus as Record<string, unknown>)?.response ?? []) as Array<
      Record<string, unknown>
    >;
    for (const r of responses2) {
      const props = getOkPropsFromResponse(r);
      const homeHref = extractFirstHref(props['calendar-home-set']);
      if (homeHref) {
        calendarHomeUrl = new URL(homeHref, step2.finalUrl);
        break;
      }
    }
  }

  // Step 3: Enumerate Calendar Collections (Depth: 1)
  const listCalendarsBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <d:sync-token />
    <cs:getctag />
    <ic:calendar-color />
    <c:supported-calendar-component-set />
    <d:current-user-privilege-set />
  </d:prop>
</d:propfind>`;

  const step3 = await sendDavRequest(calendarHomeUrl, {
    method: 'PROPFIND',
    depth: '1',
    authHeader,
    body: listCalendarsBody,
  });

  if (step3.status >= 400) {
    throw new Error(`CalDAV 캘린더 목록 조회 실패 (HTTP ${step3.status})`);
  }

  const parsedStep3 = xmlParser.parse(step3.text) as Record<string, unknown>;
  const responses3 = ((parsedStep3.multistatus as Record<string, unknown>)?.response ?? []) as Array<
    Record<string, unknown>
  >;

  const calendars: DiscoveredCalDavCalendar[] = [];
  const palette = ['#6366f1', '#10b981', '#3b82f6', '#d4af37', '#a855f7', '#f43f5e'];

  for (const r of responses3) {
    const href = extractFirstHref(r);
    if (!href) continue;

    const props = getOkPropsFromResponse(r);
    const rt = props.resourcetype as Record<string, unknown> | undefined;
    if (!rt || !('calendar' in rt)) continue;

    // Exclude inbox / outbox / notification collections
    if ('schedule-inbox' in rt || 'schedule-outbox' in rt || 'notification' in rt) {
      continue;
    }

    // Check VEVENT support if supported-calendar-component-set is advertised
    const compSet = props['supported-calendar-component-set'] as Record<string, unknown> | undefined;
    if (compSet && Array.isArray(compSet.comp)) {
      const supportsVevent = (compSet.comp as Array<Record<string, unknown>>).some((c) => {
        const compName = String(c['@_name'] || '').toUpperCase();
        return compName === 'VEVENT';
      });
      if (!supportsVevent) continue;
    }

    const fullCollectionUrl = new URL(href, step3.finalUrl).toString();
    const rawDisplay = props.displayname;
    const displayName =
      typeof rawDisplay === 'string' && rawDisplay.trim()
        ? rawDisplay.trim()
        : decodeURIComponent(href.replace(/\/$/, '').split('/').pop() || 'CalDAV 캘린더');

    const ctag = typeof props.getctag === 'string' ? props.getctag.trim() : undefined;
    const syncToken = typeof props['sync-token'] === 'string' ? props['sync-token'].trim() : undefined;
    const color = normalizeHexColor(
      props['calendar-color'],
      palette[calendars.length % palette.length]
    );

    const privRaw = JSON.stringify(props['current-user-privilege-set'] || '');
    const readOnlyRemote =
      privRaw.length > 10 &&
      !privRaw.includes('write') &&
      !privRaw.includes('bind');

    calendars.push({
      remoteCalendarId: fullCollectionUrl,
      name: displayName,
      color,
      ctag,
      syncToken,
      readOnlyRemote,
    });
  }

  if (calendars.length === 0) {
    throw new Error('연결된 CalDAV 계정에서 일정(VEVENT)을 지원하는 캘린더 컬렉션을 찾지 못했습니다.');
  }

  return {
    normalizedServerUrl: baseUrl.origin,
    principalUrl: principalUrl.toString(),
    calendarHomeUrl: calendarHomeUrl.toString(),
    calendars,
  };
}

export interface CalDavPullInput extends CalDavAuthInput {
  calendarUrl: string;
  previousCtag?: string;
  knownEtagsByHref?: Record<string, string>;
  viewerTimeZone?: string;
}

export interface CalDavPullOutput {
  unchanged: boolean;
  nextCtag?: string;
  nextSyncToken?: string;
  upsertedEvents: NormalizedRemoteEventPayload[];
  deletedHrefs: string[];
}

export async function pullCalDavCalendarDelta(input: CalDavPullInput): Promise<CalDavPullOutput> {
  const colUrl = await validateSafeExternalCalDavUrl(input.calendarUrl);
  const authHeader = makeBasicAuthHeader(input.username, input.appPassword);

  // 1. Check Collection CTag & Resource ETags (Depth: 1)
  const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:getetag />
    <d:resourcetype />
    <d:sync-token />
    <cs:getctag />
  </d:prop>
</d:propfind>`;

  const listRes = await sendDavRequest(colUrl, {
    method: 'PROPFIND',
    depth: '1',
    authHeader,
    body: propfindBody,
  });

  if (listRes.status === 401 || listRes.status === 403) {
    throw new Error('CalDAV 인증이 만료되었거나 권한이 없습니다.');
  }
  if (listRes.status >= 400) {
    throw new Error(`CalDAV 동기화 조회 오류 (HTTP ${listRes.status})`);
  }

  const parsedList = xmlParser.parse(listRes.text) as Record<string, unknown>;
  const responses = ((parsedList.multistatus as Record<string, unknown>)?.response ?? []) as Array<
    Record<string, unknown>
  >;

  let nextCtag: string | undefined;
  let nextSyncToken: string | undefined;
  const remoteEtagMap = new Map<string, string>();
  const colPathNormalized = listRes.finalUrl.pathname.replace(/\/$/, '');

  for (const r of responses) {
    const href = extractFirstHref(r);
    if (!href) continue;
    const resolvedHrefUrl = new URL(href, listRes.finalUrl);
    const props = getOkPropsFromResponse(r);
    const rt = props.resourcetype as Record<string, unknown> | undefined;
    const isCollection = Boolean(rt && ('collection' in rt || 'calendar' in rt));

    if (
      isCollection ||
      resolvedHrefUrl.pathname.replace(/\/$/, '') === colPathNormalized
    ) {
      if (typeof props.getctag === 'string' && props.getctag.trim()) {
        nextCtag = props.getctag.trim();
      }
      if (typeof props['sync-token'] === 'string' && props['sync-token'].trim()) {
        nextSyncToken = props['sync-token'].trim();
      }
      continue;
    }

    const etag = typeof props.getetag === 'string' ? props.getetag.trim() : '';
    remoteEtagMap.set(resolvedHrefUrl.pathname, etag);
  }

  const known = input.knownEtagsByHref || {};
  const knownHrefs = Object.keys(known);

  if (
    input.previousCtag &&
    nextCtag &&
    input.previousCtag === nextCtag &&
    knownHrefs.length > 0
  ) {
    return {
      unchanged: true,
      nextCtag,
      nextSyncToken,
      upsertedEvents: [],
      deletedHrefs: [],
    };
  }

  const deletedHrefs: string[] = [];
  for (const oldHref of knownHrefs) {
    if (!remoteEtagMap.has(oldHref)) {
      deletedHrefs.push(oldHref);
    }
  }

  const changedHrefs: string[] = [];
  for (const [hrefPath, currentEtag] of remoteEtagMap.entries()) {
    const prevEtag = known[hrefPath];
    if (!prevEtag || !currentEtag || prevEtag !== currentEtag) {
      changedHrefs.push(hrefPath);
    }
  }

  if (changedHrefs.length === 0) {
    return {
      unchanged: deletedHrefs.length === 0,
      nextCtag,
      nextSyncToken,
      upsertedEvents: [],
      deletedHrefs,
    };
  }

  // 2. Fetch changed resources in batches via calendar-multiget REPORT
  const upsertedEvents: NormalizedRemoteEventPayload[] = [];
  const batchSize = 50;

  for (let i = 0; i < changedHrefs.length; i += batchSize) {
    const chunk = changedHrefs.slice(i, i + batchSize);
    const hrefXml = chunk.map((h) => `  <d:href>${xmlEscape(h)}</d:href>`).join('\n');
    const multigetBody = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
${hrefXml}
</c:calendar-multiget>`;

    const reportRes = await sendDavRequest(listRes.finalUrl, {
      method: 'REPORT',
      depth: '1',
      authHeader,
      body: multigetBody,
    });

    if (reportRes.status >= 400) {
      throw new Error(`CalDAV calendar-multiget 조회 실패 (HTTP ${reportRes.status})`);
    }

    const parsedReport = xmlParser.parse(reportRes.text) as Record<string, unknown>;
    const reportResponses = ((parsedReport.multistatus as Record<string, unknown>)?.response ??
      []) as Array<Record<string, unknown>>;

    for (const rr of reportResponses) {
      const rawHref = extractFirstHref(rr);
      if (!rawHref) continue;
      const normalizedPath = new URL(rawHref, listRes.finalUrl).pathname;
      const props = getOkPropsFromResponse(rr);
      const etag = typeof props.getetag === 'string' ? props.getetag.trim() : undefined;
      const calDataRaw = props['calendar-data'];
      const icsText =
        typeof calDataRaw === 'string'
          ? calDataRaw
          : calDataRaw && typeof calDataRaw === 'object' && typeof (calDataRaw as Record<string, unknown>)['#text'] === 'string'
          ? String((calDataRaw as Record<string, unknown>)['#text'])
          : '';

      if (!icsText.trim()) continue;
      const parsedItems = parseCalDavIcsResource(icsText, {
        href: normalizedPath,
        etag,
        fallbackTimeZone: input.viewerTimeZone,
      });
      upsertedEvents.push(...parsedItems);
    }
  }

  return {
    unchanged: false,
    nextCtag,
    nextSyncToken,
    upsertedEvents,
    deletedHrefs,
  };
}

export interface CalDavPushOperation {
  op: 'create' | 'update' | 'delete';
  localEventId?: string;
  remoteUid: string;
  remoteHref?: string;
  remoteEtag?: string;
  event?: CalendarEventItem;
}

export interface CalDavPushResultItem {
  op: 'create' | 'update' | 'delete';
  localEventId?: string;
  remoteUid: string;
  remoteHref: string;
  remoteEtag?: string;
  ok: boolean;
  conflict?: boolean;
  error?: string;
}

export async function pushCalDavCalendarMutations(
  auth: CalDavAuthInput & { calendarUrl: string },
  operations: CalDavPushOperation[]
): Promise<CalDavPushResultItem[]> {
  const colUrl = await validateSafeExternalCalDavUrl(auth.calendarUrl);
  const authHeader = makeBasicAuthHeader(auth.username, auth.appPassword);
  const results: CalDavPushResultItem[] = [];

  for (const item of operations) {
    const safeSlug = item.remoteUid.replace(/[^A-Za-z0-9._@-]/g, '_');
    const targetResourceUrl = item.remoteHref
      ? new URL(item.remoteHref, colUrl.origin)
      : new URL(
          `${colUrl.pathname.replace(/\/$/, '')}/${encodeURIComponent(safeSlug)}.ics`,
          colUrl.origin
        );

    try {
      if (item.op === 'delete') {
        const delRes = await sendDavRequest(targetResourceUrl, {
          method: 'DELETE',
          authHeader,
          ifMatchEtag: item.remoteEtag,
        });
        if (delRes.status === 412) {
          results.push({
            op: 'delete',
            localEventId: item.localEventId,
            remoteUid: item.remoteUid,
            remoteHref: targetResourceUrl.pathname,
            ok: false,
            conflict: true,
            error: '원격 서버에서 일정이 먼저 변경되었습니다 (ETag 412).',
          });
          continue;
        }
        if (delRes.status >= 400 && delRes.status !== 404) {
          results.push({
            op: 'delete',
            localEventId: item.localEventId,
            remoteUid: item.remoteUid,
            remoteHref: targetResourceUrl.pathname,
            ok: false,
            error: `CalDAV 삭제 실패 (HTTP ${delRes.status})`,
          });
          continue;
        }
        results.push({
          op: 'delete',
          localEventId: item.localEventId,
          remoteUid: item.remoteUid,
          remoteHref: targetResourceUrl.pathname,
          ok: true,
        });
        continue;
      }

      if (!item.event) {
        results.push({
          op: item.op,
          localEventId: item.localEventId,
          remoteUid: item.remoteUid,
          remoteHref: targetResourceUrl.pathname,
          ok: false,
          error: '전송할 일정 데이터가 누락되었습니다.',
        });
        continue;
      }

      const icsBody = serializeEventToCalDavIcs(item.event, item.remoteUid);
      const putRes = await sendDavRequest(targetResourceUrl, {
        method: 'PUT',
        authHeader,
        contentType: 'text/calendar; charset=utf-8',
        body: icsBody,
        ifMatchEtag: item.op === 'update' ? item.remoteEtag : undefined,
        ifNoneMatchStar: item.op === 'create' && !item.remoteHref,
      });

      if (putRes.status === 412) {
        results.push({
          op: item.op,
          localEventId: item.localEventId,
          remoteUid: item.remoteUid,
          remoteHref: targetResourceUrl.pathname,
          ok: false,
          conflict: true,
          error: '원격 서버의 ETag 버전과 충돌했습니다 (HTTP 412).',
        });
        continue;
      }

      if (putRes.status >= 400) {
        results.push({
          op: item.op,
          localEventId: item.localEventId,
          remoteUid: item.remoteUid,
          remoteHref: targetResourceUrl.pathname,
          ok: false,
          error: `CalDAV 저장 실패 (HTTP ${putRes.status})`,
        });
        continue;
      }

      const nextEtag = putRes.headers.get('etag')?.trim() || undefined;
      results.push({
        op: item.op,
        localEventId: item.localEventId,
        remoteUid: item.remoteUid,
        remoteHref: putRes.finalUrl.pathname,
        remoteEtag: nextEtag,
        ok: true,
      });
    } catch (err) {
      results.push({
        op: item.op,
        localEventId: item.localEventId,
        remoteUid: item.remoteUid,
        remoteHref: targetResourceUrl.pathname,
        ok: false,
        error: err instanceof Error ? err.message : 'CalDAV 요청 처리 실패',
      });
    }
  }

  return results;
}
