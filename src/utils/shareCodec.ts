import { CalendarCategory, CalendarEventItem, ChecklistItem, ProjectItem } from '../types';
import { formatKoreanDateWithDay } from '../shared/dateUtils';
import {
  formatCombinedLocation,
  formatCoordinatePairPlain,
  hasValidCoordinates,
  normalizeCoordinates,
  normalizePlaceAndAddress,
} from '../shared/locationUtils';
import { detectBrowserTimeZone, getTimeZoneMeta, isValidTimeZone, resolveEventTimeZone } from '../shared/timeZoneUtils';

export type ShareCardTheme = 'obsidian' | 'editorial';

export interface SharedProposedSlot {
  date: string;
  startTime: string;
  endTime: string;
  label?: string;
}

export interface SharedEventPassData {
  id: string;
  title: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  isAllDay: boolean;
  category: CalendarCategory;
  projectName?: string;
  location?: string;
  locationAddress?: string;
  locationLat?: number;
  locationLng?: number;
  content?: string;
  checklist?: ChecklistItem[];
  proposedSlots?: SharedProposedSlot[];
}

export interface SharedProjectPassData {
  id: string;
  name: string;
  code?: string;
  clientOrOrg?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  events: SharedEventPassData[];
}

export interface SharedPassPayload {
  version: 1;
  kind: 'event' | 'project';
  theme: ShareCardTheme;
  senderNote?: string;
  issuedAt: string; // YYYY-MM-DD
  event?: SharedEventPassData;
  project?: SharedProjectPassData;
}

interface CompactWireEvent {
  t: string; // title
  d: string; // date
  ed?: string; // endDate
  s: string; // startTime
  e: string; // endTime
  z: string; // timeZone
  a?: 1; // isAllDay
  c: CalendarCategory; // category
  pn?: string; // projectName
  l?: string; // location
  la?: string; // locationAddress
  lt?: number; // locationLat
  lg?: number; // locationLng
  m?: string; // content (memo)
  cl?: Array<[string, 0 | 1]>; // checklist [text, done]
  ps?: Array<[string, string, string, string?]>; // proposedSlots [date, start, end, label?]
}

interface CompactWirePayload {
  v: 1;
  k: 'e' | 'p';
  th: 'o' | 'w';
  n?: string;
  ia: string;
  ev?: CompactWireEvent;
  pr?: {
    nm: string;
    cd?: string;
    co?: string;
    ds?: string;
    sd?: string;
    ed?: string;
    evs: CompactWireEvent[];
  };
}

const MAX_SHARED_PROJECT_EVENTS = 50;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(base64Url: string): Uint8Array {
  const padded = base64Url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toWireEvent(ev: SharedEventPassData): CompactWireEvent {
  const wire: CompactWireEvent = {
    t: ev.title,
    d: ev.date,
    s: ev.startTime,
    e: ev.endTime,
    z: ev.timeZone,
    c: ev.category,
  };
  if (ev.endDate && ev.endDate !== ev.date) wire.ed = ev.endDate;
  if (ev.isAllDay) wire.a = 1;
  if (ev.projectName) wire.pn = ev.projectName;
  if (ev.location) wire.l = ev.location;
  if (ev.locationAddress) wire.la = ev.locationAddress;
  if (hasValidCoordinates(ev.locationLat, ev.locationLng)) {
    wire.lt = ev.locationLat;
    wire.lg = ev.locationLng;
  }
  if (ev.content) wire.m = ev.content;
  if (ev.checklist && ev.checklist.length > 0) {
    wire.cl = ev.checklist.map((item) => [item.text, item.done ? 1 : 0]);
  }
  if (ev.proposedSlots && ev.proposedSlots.length > 0) {
    wire.ps = ev.proposedSlots
      .slice(0, 4)
      .map((slot) =>
        slot.label
          ? [slot.date, slot.startTime, slot.endTime, slot.label]
          : [slot.date, slot.startTime, slot.endTime]
      );
  }
  return wire;
}

function fromWireEvent(wire: CompactWireEvent, index: number): SharedEventPassData {
  const safeZone = isValidTimeZone(wire.z) ? wire.z : detectBrowserTimeZone();
  const normalizedLoc = normalizePlaceAndAddress(wire.l, wire.la);
  const normalizedCoords = normalizeCoordinates(wire.lt, wire.lg);
  return {
    id: `shared-ev-${index}-${wire.d}`,
    title: String(wire.t || '일정').slice(0, 160),
    date: String(wire.d || '2026-01-01'),
    endDate: wire.ed ? String(wire.ed) : undefined,
    startTime: String(wire.s || '09:00'),
    endTime: String(wire.e || '10:00'),
    timeZone: safeZone,
    isAllDay: wire.a === 1,
    category: wire.c || '기타',
    projectName: wire.pn ? String(wire.pn) : undefined,
    location: normalizedLoc.location,
    locationAddress: normalizedLoc.locationAddress,
    locationLat: normalizedCoords.locationLat,
    locationLng: normalizedCoords.locationLng,
    content: wire.m ? String(wire.m) : undefined,
    checklist: Array.isArray(wire.cl)
      ? wire.cl.map(([text, done], idx) => ({
          id: `chk-${index}-${idx}`,
          text: String(text || ''),
          done: done === 1,
        }))
      : undefined,
    proposedSlots: Array.isArray(wire.ps)
      ? wire.ps.slice(0, 4).map(([d, s, e, lbl]) => ({
          date: String(d || wire.d || '2026-01-01'),
          startTime: String(s || '10:00'),
          endTime: String(e || '11:00'),
          label: lbl ? String(lbl) : undefined,
        }))
      : undefined,
  };
}

function toCompactWire(payload: SharedPassPayload): CompactWirePayload {
  const wire: CompactWirePayload = {
    v: 1,
    k: payload.kind === 'event' ? 'e' : 'p',
    th: payload.theme === 'editorial' ? 'w' : 'o',
    ia: payload.issuedAt,
  };
  if (payload.senderNote?.trim()) {
    wire.n = payload.senderNote.trim().slice(0, 200);
  }
  if (payload.kind === 'event' && payload.event) {
    wire.ev = toWireEvent(payload.event);
  }
  if (payload.kind === 'project' && payload.project) {
    wire.pr = {
      nm: payload.project.name,
      cd: payload.project.code || undefined,
      co: payload.project.clientOrOrg || undefined,
      ds: payload.project.description || undefined,
      sd: payload.project.startDate || undefined,
      ed: payload.project.endDate || undefined,
      evs: payload.project.events.slice(0, MAX_SHARED_PROJECT_EVENTS).map(toWireEvent),
    };
  }
  return wire;
}

function fromCompactWire(wire: CompactWirePayload): SharedPassPayload | null {
  if (!wire || wire.v !== 1 || (wire.k !== 'e' && wire.k !== 'p')) {
    return null;
  }
  const theme: ShareCardTheme = wire.th === 'w' ? 'editorial' : 'obsidian';
  const issuedAt = typeof wire.ia === 'string' ? wire.ia : '2026-01-01';
  const senderNote = typeof wire.n === 'string' && wire.n.trim() ? wire.n.trim() : undefined;

  if (wire.k === 'e' && wire.ev) {
    return {
      version: 1,
      kind: 'event',
      theme,
      senderNote,
      issuedAt,
      event: fromWireEvent(wire.ev, 0),
    };
  }

  if (wire.k === 'p' && wire.pr) {
    const events = Array.isArray(wire.pr.evs)
      ? wire.pr.evs.map((item, idx) => fromWireEvent(item, idx))
      : [];
    return {
      version: 1,
      kind: 'project',
      theme,
      senderNote,
      issuedAt,
      project: {
        id: 'shared-project',
        name: String(wire.pr.nm || '프로젝트 일정'),
        code: wire.pr.cd ? String(wire.pr.cd) : undefined,
        clientOrOrg: wire.pr.co ? String(wire.pr.co) : undefined,
        description: wire.pr.ds ? String(wire.pr.ds) : undefined,
        startDate: wire.pr.sd ? String(wire.pr.sd) : undefined,
        endDate: wire.pr.ed ? String(wire.pr.ed) : undefined,
        events,
      },
    };
  }

  return null;
}

/**
 * 프라이버시 필터링이 완료된 브리핑 패스 페이로드를 압축 Base64URL 토큰으로 직렬화
 */
export async function encodeSharePayload(payload: SharedPassPayload): Promise<string> {
  const wireJson = JSON.stringify(toCompactWire(payload));
  const rawBytes = new TextEncoder().encode(wireJson);

  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      writer.write(rawBytes);
      writer.close();
      const compressedBuf = await new Response(cs.readable).arrayBuffer();
      const compressedBytes = new Uint8Array(compressedBuf);
      if (compressedBytes.length < rawBytes.length) {
        return `z.${bytesToBase64Url(compressedBytes)}`;
      }
    } catch {
      // 브라우저 환경 제약 시 무압축 폴백
    }
  }

  return `u.${bytesToBase64Url(rawBytes)}`;
}

/**
 * URL의 pass 토큰을 복호화하여 검증된 SharedPassPayload 반환
 */
export async function decodeSharePayload(token: string): Promise<SharedPassPayload | null> {
  if (!token || typeof token !== 'string') return null;
  const trimmed = token.trim();

  try {
    let jsonBytes: Uint8Array;
    if (trimmed.startsWith('z.')) {
      if (typeof DecompressionStream === 'undefined') return null;
      const compressedBytes = base64UrlToBytes(trimmed.slice(2));
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(compressedBytes);
      writer.close();
      const decompressedBuf = await new Response(ds.readable).arrayBuffer();
      jsonBytes = new Uint8Array(decompressedBuf);
    } else if (trimmed.startsWith('u.')) {
      jsonBytes = base64UrlToBytes(trimmed.slice(2));
    } else {
      jsonBytes = base64UrlToBytes(trimmed);
    }

    const jsonText = new TextDecoder().decode(jsonBytes);
    const parsed = JSON.parse(jsonText) as CompactWirePayload;
    return fromCompactWire(parsed);
  } catch {
    return null;
  }
}

/**
 * 현재 URL에서 공유 패스 토큰 추출 (?pass=... 또는 #pass=...)
 */
export function extractShareTokenFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const searchParams = new URLSearchParams(window.location.search);
  const fromQuery = searchParams.get('pass');
  if (fromQuery) return fromQuery;

  const hash = window.location.hash;
  if (hash.startsWith('#pass=')) {
    return decodeURIComponent(hash.slice('#pass='.length));
  }
  return null;
}

/**
 * 공유 전용 URL 생성
 */
export function buildSharePassUrl(token: string): string {
  if (typeof window === 'undefined') return `?pass=${encodeURIComponent(token)}`;
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('pass', token);
  return url.toString();
}

/**
 * 외부 지도 앱(Google Maps) 검색 딥링크 생성 (window.open 없이 <a target="_blank">에 연결)
 */
export function buildGoogleMapsSearchUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.trim())}`;
}

/**
 * 단일 일정 -> 프라이버시 필터 적용된 SharedPassPayload 생성
 */
export function buildSingleEventSharePayload(params: {
  event: CalendarEventItem;
  viewerTimeZone: string;
  projectName?: string;
  theme: ShareCardTheme;
  senderNote?: string;
  includeMemo: boolean;
  includeChecklist: boolean;
  proposedSlots?: SharedProposedSlot[];
}): SharedPassPayload {
  const {
    event,
    viewerTimeZone,
    projectName,
    theme,
    senderNote,
    includeMemo,
    includeChecklist,
    proposedSlots,
  } = params;

  const resolvedTz = resolveEventTimeZone(event, viewerTimeZone);
  const normalizedLoc = normalizePlaceAndAddress(event.location, event.locationAddress);
  const nowIso = new Date().toISOString().slice(0, 10);

  return {
    version: 1,
    kind: 'event',
    theme,
    senderNote: senderNote?.trim() || undefined,
    issuedAt: nowIso,
    event: {
      id: event.id,
      title: event.title,
      date: event.date,
      endDate: event.endDate,
      startTime: event.startTime,
      endTime: event.endTime,
      timeZone: resolvedTz,
      isAllDay: event.isAllDay,
      category: event.category,
      projectName: projectName || undefined,
      location: normalizedLoc.location,
      locationAddress: normalizedLoc.locationAddress,
      locationLat: event.locationLat,
      locationLng: event.locationLng,
      content: includeMemo && event.content?.trim() ? event.content.trim() : undefined,
      checklist:
        includeChecklist && event.checklist && event.checklist.length > 0
          ? event.checklist.map((item) => ({ ...item }))
          : undefined,
      proposedSlots:
        proposedSlots && proposedSlots.length > 0
          ? proposedSlots.slice(0, 4).map((slot) => ({ ...slot }))
          : undefined,
    },
  };
}

/**
 * 프로젝트 -> 프라이버시 필터 적용된 SharedPassPayload 생성
 */
export function buildProjectSharePayload(params: {
  project: ProjectItem;
  events: CalendarEventItem[];
  viewerTimeZone: string;
  theme: ShareCardTheme;
  senderNote?: string;
  includeMemo: boolean;
  includeCompleted: boolean;
}): SharedPassPayload {
  const {
    project,
    events,
    viewerTimeZone,
    theme,
    senderNote,
    includeMemo,
    includeCompleted,
  } = params;

  const filtered = events
    .filter((e) => e.projectId === project.id)
    .filter((e) => (includeCompleted ? true : !e.isCompleted))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.startTime.localeCompare(b.startTime);
    });

  const sharedEvents: SharedEventPassData[] = filtered
    .slice(0, MAX_SHARED_PROJECT_EVENTS)
    .map((ev) => {
      const normalizedLoc = normalizePlaceAndAddress(ev.location, ev.locationAddress);
      return {
        id: ev.id,
        title: ev.title,
        date: ev.date,
        endDate: ev.endDate,
        startTime: ev.startTime,
        endTime: ev.endTime,
        timeZone: resolveEventTimeZone(ev, viewerTimeZone),
        isAllDay: ev.isAllDay,
        category: ev.category,
        projectName: project.name,
        location: normalizedLoc.location,
        locationAddress: normalizedLoc.locationAddress,
        locationLat: ev.locationLat,
        locationLng: ev.locationLng,
        content: includeMemo && ev.content?.trim() ? ev.content.trim() : undefined,
      };
    });

  const nowIso = new Date().toISOString().slice(0, 10);

  return {
    version: 1,
    kind: 'project',
    theme,
    senderNote: senderNote?.trim() || undefined,
    issuedAt: nowIso,
    project: {
      id: project.id,
      name: project.name,
      code: project.code,
      clientOrOrg: project.clientOrOrg,
      description: includeMemo ? project.description : undefined,
      startDate: project.startDate,
      endDate: project.endDate,
      events: sharedEvents,
    },
  };
}

/**
 * SharedEventPassData를 ICS 내보내기 호환 CalendarEventItem으로 변환
 */
export function sharedEventToCalendarItem(ev: SharedEventPassData): CalendarEventItem {
  return {
    id: ev.id,
    title: ev.title,
    date: ev.date,
    endDate: ev.endDate,
    startTime: ev.startTime,
    endTime: ev.endTime,
    timeZone: ev.timeZone,
    isAllDay: ev.isAllDay,
    category: ev.category,
    location: ev.location,
    locationAddress: ev.locationAddress,
    locationLat: ev.locationLat,
    locationLng: ev.locationLng,
    content: ev.content,
    checklist: ev.checklist,
  };
}

/**
 * 카카오톡·문자·슬랙 붙여넣기용 정제된 브리핑 텍스트 포맷
 */
export function formatPassPlainText(payload: SharedPassPayload, shareUrl?: string): string {
  const lines: string[] = [];

  if (payload.kind === 'event' && payload.event) {
    const ev = payload.event;
    const tzMeta = getTimeZoneMeta(ev.timeZone);
    const dateLabel = formatKoreanDateWithDay(ev.date, false);
    const timeLabel = ev.isAllDay
      ? '종일'
      : `${ev.startTime} – ${ev.endTime} ${tzMeta.shortCode} (${tzMeta.cityKo} 기준)`;

    if (ev.projectName) {
      lines.push(`${ev.projectName} · ${ev.category}`);
    } else {
      lines.push(`일정 브리핑 · ${ev.category}`);
    }
    lines.push(ev.title);
    lines.push('');
    lines.push(`일시: ${dateLabel} ${timeLabel}`);
    if (ev.location) {
      lines.push(`장소: ${ev.location}`);
    }
    if (ev.locationAddress) {
      lines.push(`주소: ${ev.locationAddress}`);
    }
    if (hasValidCoordinates(ev.locationLat, ev.locationLng)) {
      lines.push(`위경도: ${formatCoordinatePairPlain(ev.locationLat!, ev.locationLng!)}`);
    }
    if (payload.senderNote) {
      lines.push(`안내: ${payload.senderNote}`);
    }
    if (ev.content) {
      lines.push(`메모: ${ev.content}`);
    }
    if (ev.checklist && ev.checklist.length > 0) {
      lines.push('');
      lines.push('체크리스트:');
      for (const item of ev.checklist) {
        lines.push(`- [${item.done ? 'v' : ' '}] ${item.text}`);
      }
    }
    if (ev.proposedSlots && ev.proposedSlots.length > 0) {
      lines.push('');
      lines.push(`후보 시간 제안 (${tzMeta.shortCode} 기준):`);
      ev.proposedSlots.forEach((slot, idx) => {
        const suffix = slot.label ? ` (${slot.label})` : '';
        lines.push(`- 후보 ${idx + 1}: ${slot.date} ${slot.startTime} – ${slot.endTime}${suffix}`);
      });
    }
  } else if (payload.kind === 'project' && payload.project) {
    const pr = payload.project;
    const headerMeta = [pr.clientOrOrg, pr.code].filter(Boolean).join(' · ');
    lines.push(headerMeta ? `${pr.name} (${headerMeta})` : pr.name);
    if (pr.startDate || pr.endDate) {
      lines.push(`기간: ${pr.startDate || '미정'} – ${pr.endDate || '미정'} · 총 ${pr.events.length}건`);
    } else {
      lines.push(`전체 일정 ${pr.events.length}건`);
    }
    if (payload.senderNote) {
      lines.push(`안내: ${payload.senderNote}`);
    }
    lines.push('');
    for (const ev of pr.events.slice(0, 12)) {
      const tzMeta = getTimeZoneMeta(ev.timeZone);
      const timePart = ev.isAllDay ? '종일' : `${ev.startTime} ${tzMeta.shortCode}`;
      const combinedLoc = formatCombinedLocation(ev.location, ev.locationAddress);
      const locPart = combinedLoc ? ` · ${combinedLoc}` : '';
      lines.push(`${ev.date.slice(5)}  ${timePart}  ${ev.title}${locPart}`);
    }
    if (pr.events.length > 12) {
      lines.push(`외 ${pr.events.length - 12}건 일정 포함`);
    }
  }

  if (shareUrl) {
    lines.push('');
    lines.push(`브리핑 패스 열기: ${shareUrl}`);
  }

  return lines.join('\n');
}
