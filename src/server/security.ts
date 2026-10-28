import express from 'express';
import {
  CalendarCategory,
  CalendarEventItem,
  ChatSessionHistoryItem,
  ProjectItem,
} from '../types';
import { getTodayDateString } from '../shared/dateUtils';
import { normalizeCoordinates, normalizePlaceAndAddress } from '../shared/locationUtils';
import { isValidTimeZone } from '../shared/timeZoneUtils';

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_INLINE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
]);
const MAX_IMAGE_BASE64_LENGTH = 5_600_000; // 약 4MB 바이너리 상한
const MAX_INLINE_BASE64_LENGTH = 11_200_000; // 약 8MB 바이너리 상한
const MAX_TOTAL_INLINE_BASE64_LENGTH = 18_000_000; // 총합 약 13.5MB 상한
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_TEXT_LENGTH = 40_000;
const MAX_PROMPT_LENGTH = 8_000;

export const ALLOWED_CLOUD_MODELS = new Set([
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
]);

const VALID_CATEGORIES = new Set<CalendarCategory>([
  '업무',
  '방문·출장',
  '식사·모임',
  '개인',
  '행사·세미나',
  '기타',
]);

/**
 * 보안 헤더 미들웨어 (CSP 적용 및 프리뷰 iframe 호환성 보장)
 */
export function securityHeaders(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "font-src 'self' https://cdn.jsdelivr.net data:",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "worker-src 'self' blob:",
      "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:* https:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ')
  );
  next();
}

/**
 * LRU/FIFO 상한 보호형 인메모리 Rate Limiter (전체 clear 우회 취약점 해결)
 */
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const ipRateLimitMap = new Map<string, RateLimitRecord>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const MAX_ENTRIES_BEFORE_EVICT = 5_000;

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRateLimitMap.entries()) {
    if (now > record.resetTime) {
      ipRateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

export function apiRateLimiter(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
  const now = Date.now();
  const record = ipRateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    if (!record && ipRateLimitMap.size >= MAX_ENTRIES_BEFORE_EVICT) {
      // 가장 오래된 단일 엔트리만 제거하여 기존 차단 대상 IP 기록 보존
      const oldestKey = ipRateLimitMap.keys().next().value;
      if (oldestKey !== undefined) {
        ipRateLimitMap.delete(oldestKey);
      }
    }
    ipRateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfter.toString());
    res.status(429).json({
      error: '단기간에 요청이 집중되었습니다. 잠시 후 다시 시도해 주세요.',
    });
    return;
  }

  record.count += 1;
  next();
}

export interface SanitizedAgentImage {
  data: string;
  mimeType: string;
}

export interface SanitizedAgentAttachment {
  name: string;
  mimeType: string;
  kind: string;
  transferMode: 'inline' | 'text';
  base64Data?: string;
  textContent?: string;
}

export interface SanitizedAgentContext {
  currentYear: number;
  selectedDate: string;
  viewerTimeZone: string;
  selectedProjectId: string;
  activeProjectName?: string;
  existingEvents: CalendarEventItem[];
  selectedEvent: CalendarEventItem | null;
  lastReferencedEvent: CalendarEventItem | null;
  chatHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
    targetEventTitle?: string;
    targetEventId?: string;
  }>;
  projects: Array<{ id: string; name: string; code?: string; clientOrOrg?: string }>;
}

export interface ValidatedAgentRequest {
  prompt: string;
  modelId: string;
  image?: SanitizedAgentImage;
  attachments: SanitizedAgentAttachment[];
  context: SanitizedAgentContext;
}

function cleanText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLen);
}

function sanitizeEventSummary(raw: unknown): CalendarEventItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const id = cleanText(e.id, 80);
  const title = cleanText(e.title, 150);
  const date = cleanText(e.date, 10);
  if (!id || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const rawCat = cleanText(e.category, 20) as CalendarCategory;
  const category: CalendarCategory = VALID_CATEGORIES.has(rawCat) ? rawCat : '기타';

  const rawTz = cleanText(e.timeZone, 60);
  const timeZone = rawTz && isValidTimeZone(rawTz) ? rawTz : undefined;

  const { location, locationAddress } = normalizePlaceAndAddress(
    cleanText(e.location, 160),
    cleanText(e.locationAddress, 200)
  );
  const { locationLat, locationLng } = normalizeCoordinates(e.locationLat, e.locationLng);

  return {
    id,
    title,
    date,
    startTime: /^\d{2}:\d{2}$/.test(cleanText(e.startTime, 5)) ? cleanText(e.startTime, 5) : '10:00',
    endTime: /^\d{2}:\d{2}$/.test(cleanText(e.endTime, 5)) ? cleanText(e.endTime, 5) : '11:00',
    timeZone,
    isAllDay: Boolean(e.isAllDay),
    category,
    projectId: cleanText(e.projectId, 80) || undefined,
    location,
    locationAddress,
    locationLat,
    locationLng,
    content: cleanText(e.content, 500) || undefined,
    isCompleted: Boolean(e.isCompleted),
  };
}

/**
 * 에이전트 API 요청 본문 및 첨부 이미지 정밀 검증/살균
 */
export function validateAndSanitizeAgentRequest(
  body: unknown
): { ok: true; value: ValidatedAgentRequest } | { ok: false; status: number; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: '유효하지 않은 요청 형식입니다.' };
  }

  const rawBody = body as Record<string, unknown>;
  const rawPrompt = typeof rawBody.prompt === 'string' ? rawBody.prompt.trim() : '';

  if (rawPrompt.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `프롬프트 길이가 허용 범위(최대 ${MAX_PROMPT_LENGTH.toLocaleString()}자)를 초과했습니다.`,
    };
  }

  let validatedImage: SanitizedAgentImage | undefined;
  if (rawBody.image !== undefined && rawBody.image !== null) {
    if (typeof rawBody.image !== 'object') {
      return { ok: false, status: 400, error: '이미지 데이터 형식이 올바르지 않습니다.' };
    }
    const imgObj = rawBody.image as Record<string, unknown>;
    const mimeType = cleanText(imgObj.mimeType, 40).toLowerCase();
    const data = typeof imgObj.data === 'string' ? imgObj.data.trim() : '';

    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
      return {
        ok: false,
        status: 400,
        error: '지원하지 않는 이미지 형식입니다. JPG, PNG, WEBP 파일만 허용됩니다.',
      };
    }
    if (!data || data.length > MAX_IMAGE_BASE64_LENGTH) {
      return {
        ok: false,
        status: 413,
        error: '첨부 이미지 용량이 너무 큽니다. 4MB 이하의 이미지를 사용해 주세요.',
      };
    }
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) {
      return { ok: false, status: 400, error: '손상된 Base64 이미지 데이터입니다.' };
    }
    validatedImage = { data, mimeType };
  }

  const validatedAttachments: SanitizedAgentAttachment[] = [];
  if (rawBody.attachments !== undefined && rawBody.attachments !== null) {
    if (!Array.isArray(rawBody.attachments)) {
      return { ok: false, status: 400, error: '첨부 파일 목록 형식이 올바르지 않습니다.' };
    }
    if (rawBody.attachments.length > MAX_ATTACHMENTS) {
      return {
        ok: false,
        status: 400,
        error: `첨부 파일은 한 번에 최대 ${MAX_ATTACHMENTS}개까지 전송할 수 있습니다.`,
      };
    }

    let totalInlineLen = validatedImage ? validatedImage.data.length : 0;

    for (const rawAtt of rawBody.attachments) {
      if (!rawAtt || typeof rawAtt !== 'object') {
        return { ok: false, status: 400, error: '유효하지 않은 첨부 항목이 포함되어 있습니다.' };
      }
      const att = rawAtt as Record<string, unknown>;
      const name = cleanText(att.name, 160) || '첨부파일';
      const kind = cleanText(att.kind, 30) || 'document';
      const mimeType = cleanText(att.mimeType, 100).toLowerCase() || 'text/plain';
      const transferMode = att.transferMode === 'inline' ? 'inline' : 'text';

      if (transferMode === 'inline') {
        if (!ALLOWED_INLINE_MIME_TYPES.has(mimeType)) {
          return {
            ok: false,
            status: 400,
            error: `'${name}' 파일은 지원되지 않는 미디어 형식(${mimeType})입니다.`,
          };
        }
        const base64Data = typeof att.base64Data === 'string' ? att.base64Data.trim() : '';
        if (!base64Data || base64Data.length > MAX_INLINE_BASE64_LENGTH) {
          return {
            ok: false,
            status: 413,
            error: `'${name}' 파일 용량이 허용 상한(8MB)을 초과했습니다.`,
          };
        }
        if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64Data)) {
          return { ok: false, status: 400, error: `'${name}' Base64 데이터가 손상되었습니다.` };
        }
        totalInlineLen += base64Data.length;
        if (totalInlineLen > MAX_TOTAL_INLINE_BASE64_LENGTH) {
          return {
            ok: false,
            status: 413,
            error: '전체 첨부 파일 용량 합계가 너무 큽니다. 일부 파일을 나누어 전송해 주세요.',
          };
        }
        validatedAttachments.push({
          name,
          mimeType,
          kind,
          transferMode: 'inline',
          base64Data,
        });
      } else {
        const textContent = cleanText(att.textContent, MAX_ATTACHMENT_TEXT_LENGTH);
        if (!textContent) {
          return { ok: false, status: 400, error: `'${name}' 문서의 텍스트 내용이 비어 있습니다.` };
        }
        validatedAttachments.push({
          name,
          mimeType: 'text/plain',
          kind,
          transferMode: 'text',
          textContent,
        });
      }
    }
  }

  const prompt = cleanText(rawPrompt, MAX_PROMPT_LENGTH);
  if (!prompt && !validatedImage && validatedAttachments.length === 0) {
    return { ok: false, status: 400, error: '자연어 지시나 분석할 파일을 전달해 주세요.' };
  }

  const rawCtx =
    rawBody.context && typeof rawBody.context === 'object'
      ? (rawBody.context as Record<string, unknown>)
      : {};

  const currentYear =
    typeof rawCtx.currentYear === 'number' &&
    Number.isInteger(rawCtx.currentYear) &&
    rawCtx.currentYear >= 2000 &&
    rawCtx.currentYear <= 2100
      ? rawCtx.currentYear
      : new Date().getFullYear();

  const rawDate = cleanText(rawCtx.selectedDate, 10);
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getTodayDateString();

  const existingEvents = Array.isArray(rawCtx.existingEvents)
    ? rawCtx.existingEvents
        .slice(0, 40)
        .map(sanitizeEventSummary)
        .filter((e): e is CalendarEventItem => e !== null)
    : [];

  const chatHistory = Array.isArray(rawCtx.chatHistory)
    ? rawCtx.chatHistory
        .slice(-10)
        .filter((h): h is ChatSessionHistoryItem => Boolean(h && typeof h === 'object'))
        .map((h) => ({
          role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: cleanText(h.content, 600),
          targetEventTitle: h.targetEvent ? cleanText(h.targetEvent.title, 100) : undefined,
          targetEventId: h.targetEvent ? cleanText(h.targetEvent.id, 80) : undefined,
        }))
    : [];

  const projects = Array.isArray(rawCtx.projects)
    ? rawCtx.projects
        .slice(0, 20)
        .filter((p): p is ProjectItem => Boolean(p && typeof p === 'object'))
        .map((p) => ({
          id: cleanText(p.id, 80),
          name: cleanText(p.name, 100),
          code: cleanText(p.code, 16) || undefined,
          clientOrOrg: cleanText(p.clientOrOrg, 100) || undefined,
        }))
        .filter((p) => Boolean(p.id && p.name))
    : [];

  const rawModelId = cleanText(rawBody.modelId, 60);
  const modelId = ALLOWED_CLOUD_MODELS.has(rawModelId) ? rawModelId : 'gemini-3.8-flash';

  const rawViewerTz = cleanText(rawCtx.viewerTimeZone, 60);
  const viewerTimeZone =
    rawViewerTz && isValidTimeZone(rawViewerTz) ? rawViewerTz : 'Asia/Seoul';

  return {
    ok: true,
    value: {
      prompt,
      modelId,
      image: validatedImage,
      attachments: validatedAttachments,
      context: {
        currentYear,
        selectedDate,
        viewerTimeZone,
        selectedProjectId: cleanText(rawCtx.selectedProjectId, 80) || 'all',
        activeProjectName: cleanText(rawCtx.activeProjectName, 100) || undefined,
        existingEvents,
        selectedEvent: sanitizeEventSummary(rawCtx.selectedEvent),
        lastReferencedEvent: sanitizeEventSummary(rawCtx.lastReferencedEvent),
        chatHistory,
        projects,
      },
    },
  };
}

export interface ValidatedGroundingDiscoveryRequest {
  topic: string;
  rangeMonths: number;
  modelId: string;
  currentYear: number;
  selectedDate: string;
  activeProjectName?: string;
  activeProjectClient?: string;
  existingEvents: CalendarEventItem[];
}

export function validateAndSanitizeGroundingRequest(
  body: unknown
):
  | { ok: true; value: ValidatedGroundingDiscoveryRequest }
  | { ok: false; status: number; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: '유효하지 않은 요청 형식입니다.' };
  }

  const raw = body as Record<string, unknown>;
  const topic = cleanText(raw.topic, 300);

  const rawRange =
    typeof raw.rangeMonths === 'number' && Number.isFinite(raw.rangeMonths)
      ? Math.round(raw.rangeMonths)
      : 3;
  const rangeMonths = Math.min(12, Math.max(1, rawRange));

  const rawModelId = cleanText(raw.modelId, 60);
  const modelId = ALLOWED_CLOUD_MODELS.has(rawModelId) ? rawModelId : 'gemini-3.8-flash';

  const currentYear =
    typeof raw.currentYear === 'number' &&
    Number.isInteger(raw.currentYear) &&
    raw.currentYear >= 2000 &&
    raw.currentYear <= 2100
      ? raw.currentYear
      : new Date().getFullYear();

  const rawDate = cleanText(raw.selectedDate, 10);
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getTodayDateString();

  const existingEvents = Array.isArray(raw.existingEvents)
    ? raw.existingEvents
        .slice(0, 40)
        .map(sanitizeEventSummary)
        .filter((e): e is CalendarEventItem => e !== null)
    : [];

  return {
    ok: true,
    value: {
      topic,
      rangeMonths,
      modelId,
      currentYear,
      selectedDate,
      activeProjectName: cleanText(raw.activeProjectName, 100) || undefined,
      activeProjectClient: cleanText(raw.activeProjectClient, 100) || undefined,
      existingEvents,
    },
  };
}

export interface ValidatedLocationResolveRequest {
  location: string;
  locationAddress?: string;
  modelId: string;
}

export function validateAndSanitizeLocationResolveRequest(
  body: unknown
):
  | { ok: true; value: ValidatedLocationResolveRequest }
  | { ok: false; status: number; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: '유효하지 않은 요청 형식입니다.' };
  }

  const raw = body as Record<string, unknown>;
  const location = cleanText(raw.location, 180);
  const locationAddress = cleanText(raw.locationAddress, 220) || undefined;

  if (!location && !locationAddress) {
    return {
      ok: false,
      status: 400,
      error: '탐색할 장소명 또는 주소를 입력해 주세요.',
    };
  }

  const rawModelId = cleanText(raw.modelId, 60);
  const modelId = ALLOWED_CLOUD_MODELS.has(rawModelId) ? rawModelId : 'gemini-3.8-flash';

  return {
    ok: true,
    value: {
      location: location || locationAddress || '',
      locationAddress,
      modelId,
    },
  };
}
