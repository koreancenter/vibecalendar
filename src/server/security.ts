import http from 'http';
import os from 'os';
import express from 'express';
import { z } from 'zod';
import { CalendarCategory, CalendarEventItem, ChecklistItem } from '../types';
import { getDayDistance, getTodayDateString, parseNaturalDateFromText } from '../shared/dateUtils';
import { normalizeCoordinates, normalizePlaceAndAddress } from '../shared/locationUtils';
import { isValidTimeZone } from '../shared/timeZoneUtils';

export const INLINE_MEDIA_PAYLOAD_LIMIT = '18mb';
export const TEXT_COMMAND_PAYLOAD_LIMIT = '512kb';

export const INLINE_MEDIA_MAX_BYTES = 18 * 1024 * 1024; // 18MB (인라인 미디어·첨부 파일 전용 상한)
export const TEXT_COMMAND_MAX_BYTES = 512 * 1024; // 512KB (일반 텍스트 명령 전용 엄격 상한)

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

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

const ALLOWED_TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/calendar',
  'text/csv',
  'text/tab-separated-values',
  'text/markdown',
  'text/html',
  'text/xml',
  'application/json',
  'application/xml',
]);

const MAX_IMAGE_BASE64_LENGTH = 5_600_000; // 약 4MB 바이너리 상한
const MAX_INLINE_BASE64_LENGTH = 11_200_000; // 약 8MB 바이너리 상한
const MAX_TOTAL_INLINE_BASE64_LENGTH = 18_000_000; // 총합 약 13.5MB 상한
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_TEXT_LENGTH = 40_000;
const MAX_PROMPT_LENGTH = 8_000;
const MAX_GROUNDING_TOPIC_LENGTH = 300;
const MAX_EXISTING_EVENTS_INPUT = 500;
const MAX_EXISTING_EVENTS_SANITIZED = 120;
const MAX_CHAT_HISTORY_INPUT = 50;
const MAX_CHAT_HISTORY_SANITIZED = 10;
const MAX_PROJECTS_INPUT = 200;
const MAX_PROJECTS_SANITIZED = 20;

export const CloudModelIdSchema = z.enum([
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
]);

export const ALLOWED_CLOUD_MODELS = new Set<string>(CloudModelIdSchema.options);

export const CalendarCategorySchema = z.enum([
  '업무',
  '방문·출장',
  '식사·모임',
  '개인',
  '행사·세미나',
  '기타',
]);

const AttachmentKindSchema = z.enum([
  'image',
  'pdf',
  'audio',
  'spreadsheet',
  'calendar',
  'document',
  'clipboard',
]);

const ProjectStatusSchema = z.enum(['active', 'planning', 'on_hold', 'completed']);

const AgentActionTypeSchema = z.enum([
  'QUERY_EVENTS',
  'CREATE_EVENT',
  'RECOMMEND_VENUE',
  'SUGGEST_DATES',
  'UPDATE_EVENT',
  'DELETE_EVENT',
  'GENERAL_CHAT',
]);

const BASE64_PATTERN = /^[A-Za-z0-9+/=\r\n]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

// C0/C1 제어 문자, DEL, 제로폭·양방향 오버라이드(Bidi) 유니코드 제어 문자 제거 패턴
const UNSAFE_CONTROL_AND_BIDI_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

// 프롬프트 구획 구분자 위장(Indirect Prompt Injection) 무력화 패턴
const SPOOFED_SECTION_HEADER_PATTERN =
  /\[\s*(시스템\s*지침|보안\s*및\s*역할\s*경계|사용자\s*요청|세션\s*컨텍스트\s*JSON[^\]]*|첨부\s*미디어\s*파일[^\]]*|첨부\s*문서\/데이터\s*파일[^\]]*)\s*\]/gi;

function stripUnsafeChars(val: string): string {
  return val.replace(UNSAFE_CONTROL_AND_BIDI_CHARS, '');
}

export function sanitizeSingleLineText(val: string | null | undefined, maxLen: number): string {
  if (!val) return '';
  return stripUnsafeChars(val)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeMultilineText(
  val: string | null | undefined,
  maxLen: number,
  neutralizePromptDelimiters = false
): string {
  if (!val) return '';
  let cleaned = stripUnsafeChars(val)
    .replace(/\r\n?/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n');

  if (neutralizePromptDelimiters) {
    cleaned = cleaned.replace(SPOOFED_SECTION_HEADER_PATTERN, '($1)');
  }

  return cleaned.trim().slice(0, maxLen);
}

function sanitizeIdentifier(val: string | null | undefined, maxLen: number): string {
  if (!val) return '';
  return stripUnsafeChars(val)
    .replace(/[\r\n\t[\]<>\\]+/g, '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeFileName(val: string | null | undefined, maxLen = 160): string {
  if (!val) return '첨부파일';
  const baseName = stripUnsafeChars(val)
    .split(/[/\\]/)
    .pop() || '';
  const cleaned = baseName
    .replace(/\.\.+/g, '.')
    .replace(/[\r\n\t[\]<>]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
  return cleaned || '첨부파일';
}

function sanitizeBase64Data(val: string): string {
  return val.replace(/\s+/g, '');
}

export function isValidIsoDateString(val: string): boolean {
  const trimmed = val.trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) return false;
  const [yStr, mStr, dStr] = trimmed.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function normalizeTimeString(val: string | null | undefined, fallback: string): string {
  const cleaned = sanitizeSingleLineText(val, 8);
  return HH_MM_PATTERN.test(cleaned) ? cleaned : fallback;
}

function resolveAllowedCloudModel(rawModelId: string | null | undefined): string {
  const cleaned = sanitizeSingleLineText(rawModelId, 60);
  const parsed = CloudModelIdSchema.safeParse(cleaned);
  return parsed.success ? parsed.data : 'gemini-3.8-flash';
}

function resolveAllowedCategory(rawCategory: string | null | undefined): CalendarCategory {
  const cleaned = sanitizeSingleLineText(rawCategory, 30);
  const parsed = CalendarCategorySchema.safeParse(cleaned);
  return parsed.success ? parsed.data : '기타';
}

function resolveAttachmentKind(rawKind: string | null | undefined): string {
  const cleaned = sanitizeSingleLineText(rawKind, 30).toLowerCase();
  const parsed = AttachmentKindSchema.safeParse(cleaned);
  return parsed.success ? parsed.data : 'document';
}

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
 * LRU/FIFO 상한 보호형 인메모리 Rate Limiter
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

/**
 * 엔드포인트별 페이로드 크기 보호 파서 및 인라인 미디어 조건부 검증 미들웨어
 * - 일반 텍스트 명령 엔드포인트: 엄격한 512KB 제한
 * - 인라인 미디어/첨부 엔드포인트(/api/agent/command): 인라인 미디어가 포함된 경우에만 최대 18MB 허용,
 *   인라인 미디어가 없는 일반 텍스트 요청은 동일하게 512KB로 엄격 제한
 */
const rawRequestByteSizeMap = new WeakMap<http.IncomingMessage, number>();

export const textCommandJsonParser = express.json({
  limit: TEXT_COMMAND_PAYLOAD_LIMIT,
  strict: true,
});

export const inlineMediaJsonParser = express.json({
  limit: INLINE_MEDIA_PAYLOAD_LIMIT,
  strict: true,
  verify: (req, _res, buf) => {
    rawRequestByteSizeMap.set(req, buf.byteLength);
  },
});

const InlineMediaEnvelopeSchema = z.object({
  image: z
    .object({
      data: z.string().min(1),
      mimeType: z.string().min(1),
    })
    .nullish(),
  attachments: z
    .array(
      z.object({
        transferMode: z.string().optional(),
        base64Data: z.string().optional(),
      })
    )
    .nullish(),
});

export function enforceInlineMediaOrTextPayloadLimit(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const measuredBytes =
    rawRequestByteSizeMap.get(req) ?? Number(req.headers['content-length'] || 0);

  if (measuredBytes <= TEXT_COMMAND_MAX_BYTES) {
    next();
    return;
  }

  const envelope = InlineMediaEnvelopeSchema.safeParse(req.body);
  if (!envelope.success) {
    res.status(413).json({
      error: '텍스트 명령 요청 크기가 허용 한도(512KB)를 초과했습니다.',
    });
    return;
  }

  let inlineBase64Bytes = 0;
  if (envelope.data.image?.data) {
    inlineBase64Bytes += Buffer.byteLength(envelope.data.image.data, 'utf8');
  }
  if (envelope.data.attachments) {
    for (const att of envelope.data.attachments) {
      if (att.transferMode === 'inline' && att.base64Data) {
        inlineBase64Bytes += Buffer.byteLength(att.base64Data, 'utf8');
      }
    }
  }

  // 인라인 미디어/첨부 파일이 전혀 없는 일반 텍스트 명령은 512KB 초과 즉시 차단
  if (inlineBase64Bytes === 0) {
    res.status(413).json({
      error: '텍스트 명령 요청 크기가 허용 한도(512KB)를 초과했습니다.',
    });
    return;
  }

  // 인라인 미디어를 제외한 일반 JSON/텍스트 본문 영역이 512KB를 초과하는 비정상 페이로드도 차단
  const nonInlineBytes = Math.max(0, measuredBytes - inlineBase64Bytes);
  if (nonInlineBytes > TEXT_COMMAND_MAX_BYTES) {
    res.status(413).json({
      error: '첨부 미디어를 제외한 텍스트 본문 크기가 허용 한도(512KB)를 초과했습니다.',
    });
    return;
  }

  next();
}

/**
 * 명시적 Zod 요청 스키마 정의
 */
const ChecklistItemInputSchema = z.object({
  id: z.string().max(120).optional(),
  text: z.string().max(500),
  done: z.boolean().optional().default(false),
});

export const CalendarEventInputSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(400),
  date: z.string().regex(ISO_DATE_PATTERN, { message: '일정 날짜 형식이 올바르지 않습니다.' }),
  endDate: z.string().max(30).nullish(),
  startTime: z.string().max(20).optional().default('10:00'),
  endTime: z.string().max(20).optional().default('11:00'),
  timeZone: z.string().max(100).nullish(),
  isAllDay: z.boolean().optional().default(false),
  category: z.string().max(60).optional().default('기타'),
  projectId: z.string().max(160).nullish(),
  location: z.string().max(500).nullish(),
  locationAddress: z.string().max(600).nullish(),
  locationLat: z.number().nullish(),
  locationLng: z.number().nullish(),
  content: z.string().max(8_000).nullish(),
  isCompleted: z.boolean().nullish(),
  checklist: z.array(ChecklistItemInputSchema).max(60).nullish(),
  isSample: z.boolean().nullish(),
});

const ChatTargetEventInputSchema = z.object({
  id: z.string().max(160),
  title: z.string().max(400),
});

const ChatUpdatedEventInputSchema = z.object({
  id: z.string().max(160),
  targetTitle: z.string().max(400).optional(),
  diffSummary: z.string().max(600).optional(),
  updates: CalendarEventInputSchema.partial().optional(),
});

export const ChatHistoryItemInputSchema = z.object({
  id: z.string().max(160).optional(),
  role: z.enum(['user', 'assistant']),
  content: z.string().max(16_000),
  timestamp: z.string().max(80).optional(),
  actionType: AgentActionTypeSchema.optional(),
  targetDate: z.string().max(30).nullish(),
  targetEvent: ChatTargetEventInputSchema.nullish(),
  createdEvents: z.array(CalendarEventInputSchema).max(30).nullish(),
  updatedEvent: ChatUpdatedEventInputSchema.nullish(),
  deletedEventId: z.string().max(160).nullish(),
});

export const ProjectInputSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(200),
  code: z.string().max(40).nullish(),
  description: z.string().max(1_500).nullish(),
  color: z.string().max(40).optional(),
  status: ProjectStatusSchema.optional(),
  startDate: z.string().max(30).nullish(),
  endDate: z.string().max(30).nullish(),
  clientOrOrg: z.string().max(200).nullish(),
  createdAt: z.string().max(80).optional(),
  isSample: z.boolean().nullish(),
});

export const AgentImageSchema = z.object({
  mimeType: z
    .string()
    .min(1)
    .max(60)
    .refine((m) => ALLOWED_IMAGE_MIME_TYPES.has(m.trim().toLowerCase()), {
      message: '지원하지 않는 이미지 형식입니다. JPG, PNG, WEBP, GIF 파일만 허용됩니다.',
    }),
  data: z
    .string()
    .min(1, { message: '이미지 데이터가 비어 있습니다.' })
    .refine((d) => BASE64_PATTERN.test(d.trim()), {
      message: '손상된 Base64 이미지 데이터입니다.',
    }),
});

const InlineAttachmentInputSchema = z.object({
  name: z.string().min(1).max(260),
  mimeType: z
    .string()
    .min(1)
    .max(120)
    .refine((m) => ALLOWED_INLINE_MIME_TYPES.has(m.trim().toLowerCase()), {
      message: '지원되지 않는 첨부 미디어 형식입니다.',
    }),
  kind: z.string().min(1).max(40),
  transferMode: z.literal('inline'),
  base64Data: z
    .string()
    .min(1, { message: '첨부 파일의 바이너리 데이터가 비어 있습니다.' })
    .refine((d) => BASE64_PATTERN.test(d.trim()), {
      message: '첨부 파일의 Base64 데이터가 손상되었습니다.',
    }),
  textContent: z.string().max(MAX_ATTACHMENT_TEXT_LENGTH).optional(),
});

const TextAttachmentInputSchema = z.object({
  name: z.string().min(1).max(260),
  mimeType: z.string().min(1).max(120),
  kind: z.string().min(1).max(40),
  transferMode: z.literal('text'),
  textContent: z
    .string()
    .max(MAX_ATTACHMENT_TEXT_LENGTH, {
      message: `첨부 문서의 텍스트 길이가 허용 범위(최대 ${MAX_ATTACHMENT_TEXT_LENGTH.toLocaleString()}자)를 초과했습니다.`,
    })
    .refine((t) => sanitizeMultilineText(t, MAX_ATTACHMENT_TEXT_LENGTH).length > 0, {
      message: '첨부 문서의 텍스트 내용이 비어 있습니다.',
    }),
  base64Data: z.string().optional(),
});

export const AgentAttachmentSchema = z.discriminatedUnion('transferMode', [
  InlineAttachmentInputSchema,
  TextAttachmentInputSchema,
]);

export const AgentContextSchema = z.object({
  currentYear: z.number().int().min(2000).max(2100).optional(),
  selectedDate: z
    .string()
    .refine(isValidIsoDateString, {
      message: '선택된 기준 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).',
    })
    .optional(),
  viewerTimeZone: z.string().max(80).nullish(),
  existingEvents: z
    .array(CalendarEventInputSchema)
    .max(MAX_EXISTING_EVENTS_INPUT)
    .optional()
    .default([]),
  selectedEvent: CalendarEventInputSchema.nullish(),
  lastReferencedEvent: CalendarEventInputSchema.nullish(),
  chatHistory: z
    .array(ChatHistoryItemInputSchema)
    .max(MAX_CHAT_HISTORY_INPUT)
    .optional()
    .default([]),
  projects: z.array(ProjectInputSchema).max(MAX_PROJECTS_INPUT).optional().default([]),
  selectedProjectId: z.string().max(120).optional().default('all'),
  activeProjectName: z.string().max(200).nullish(),
});

export const AgentCommandRequestSchema = z
  .object({
    prompt: z.string().optional().default(''),
    modelId: z.string().max(80).optional(),
    image: AgentImageSchema.nullish(),
    attachments: z
      .array(AgentAttachmentSchema)
      .max(MAX_ATTACHMENTS, {
        message: `첨부 파일은 한 번에 최대 ${MAX_ATTACHMENTS}개까지 전송할 수 있습니다.`,
      })
      .nullish(),
    context: AgentContextSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const trimmedPrompt = stripUnsafeChars(data.prompt).trim();
    if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['prompt'],
        message: `프롬프트 길이가 허용 범위(최대 ${MAX_PROMPT_LENGTH.toLocaleString()}자)를 초과했습니다.`,
      });
    }

    const hasPrompt = trimmedPrompt.length > 0;
    const hasImage = Boolean(data.image);
    const hasAttachments = Boolean(data.attachments && data.attachments.length > 0);

    if (!hasPrompt && !hasImage && !hasAttachments) {
      ctx.addIssue({
        code: 'custom',
        path: ['prompt'],
        message: '자연어 지시나 분석할 파일을 전달해 주세요.',
      });
    }
  });

export const GroundingDatesRequestSchema = z
  .object({
    topic: z
      .string()
      .optional()
      .default('')
      .refine((s) => stripUnsafeChars(s).trim().length <= MAX_GROUNDING_TOPIC_LENGTH, {
        message: `탐색 주제는 최대 ${MAX_GROUNDING_TOPIC_LENGTH}자까지 입력할 수 있습니다.`,
      }),
    rangeMonths: z
      .number()
      .min(1, { message: '탐색 기간은 최소 1개월 이상이어야 합니다.' })
      .max(12, { message: '탐색 기간은 최대 12개월 이하만 허용됩니다.' })
      .optional()
      .default(3),
    modelId: z.string().max(80).optional(),
    currentYear: z.number().int().min(2000).max(2100).optional(),
    selectedDate: z
      .string()
      .refine(isValidIsoDateString, {
        message: '기준 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).',
      })
      .optional(),
    activeProjectName: z.string().max(200).nullish(),
    activeProjectClient: z.string().max(200).nullish(),
    existingEvents: z
      .array(CalendarEventInputSchema)
      .max(MAX_EXISTING_EVENTS_INPUT)
      .optional()
      .default([]),
  })
  .strict();

export const ResolveLocationRequestSchema = z
  .object({
    location: z.string().max(240).optional().default(''),
    locationAddress: z.string().max(300).nullish(),
    modelId: z.string().max(80).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const cleanLoc = sanitizeSingleLineText(data.location, 180);
    const cleanAddr = sanitizeSingleLineText(data.locationAddress, 220);
    if (!cleanLoc && !cleanAddr) {
      ctx.addIssue({
        code: 'custom',
        path: ['location'],
        message: '탐색할 장소명 또는 주소를 입력해 주세요.',
      });
    }
  });

export const EnrichLocationsRequestSchema = z
  .object({
    items: z
      .array(
        z.object({
          key: z.string().min(1).max(160),
          queryName: z.string().min(1).max(400),
        })
      )
      .min(1)
      .max(8),
    modelId: z.string().max(80).optional(),
  })
  .strict();

export type AgentCommandRequestInput = z.infer<typeof AgentCommandRequestSchema>;
export type GroundingDatesRequestInput = z.infer<typeof GroundingDatesRequestSchema>;
export type ResolveLocationRequestInput = z.infer<typeof ResolveLocationRequestSchema>;
export type EnrichLocationsRequestInput = z.infer<typeof EnrichLocationsRequestSchema>;

/**
 * 살균(Sanitized) 출력 인터페이스 (executeGeminiAgentCommand 및 하위 명령 계약)
 */
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

export interface ValidatedLocationResolveRequest {
  location: string;
  locationAddress?: string;
  modelId: string;
}

export interface ValidatedEnrichLocationsRequest {
  items: Array<{ key: string; queryName: string }>;
  modelId: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

const SAFE_KOREAN_ISSUE_PATTERN = /[가-힣]/;

function formatSafeZodError(zodError: z.ZodError, fallbackMessage: string): string {
  const firstIssue = zodError.issues[0];
  if (!firstIssue) {
    return fallbackMessage;
  }

  if (firstIssue.code === 'unrecognized_keys') {
    return '허용되지 않은 요청 필드가 포함되어 있습니다.';
  }

  if (firstIssue.message && SAFE_KOREAN_ISSUE_PATTERN.test(firstIssue.message)) {
    return firstIssue.message;
  }

  const rootField = firstIssue.path.length > 0 ? String(firstIssue.path[0]) : '';
  switch (rootField) {
    case 'prompt':
      return '프롬프트 입력 형식이 올바르지 않습니다.';
    case 'image':
      return '첨부 이미지 데이터 형식이 올바르지 않습니다.';
    case 'attachments':
      return '첨부 파일 데이터 형식이 올바르지 않습니다.';
    case 'context':
      return '세션 컨텍스트 데이터 형식이 올바르지 않습니다.';
    case 'topic':
      return '일정 탐색 주제 형식이 올바르지 않습니다.';
    case 'rangeMonths':
      return '탐색 기간은 1~12개월 범위의 숫자여야 합니다.';
    case 'selectedDate':
      return '기준 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).';
    case 'currentYear':
      return '기준 연도 값이 올바르지 않습니다.';
    case 'existingEvents':
      return '기존 일정 목록 형식이 올바르지 않습니다.';
    case 'location':
    case 'locationAddress':
      return '장소명 또는 주소 입력 형식이 올바르지 않습니다.';
    case 'modelId':
      return '선택한 AI 모델 식별자 형식이 올바르지 않습니다.';
    default:
      return fallbackMessage;
  }
}

type ParsedCalendarEventInput = z.infer<typeof CalendarEventInputSchema>;

function sanitizeEventSummary(raw: ParsedCalendarEventInput | null | undefined): CalendarEventItem | null {
  if (!raw) return null;

  const id = sanitizeIdentifier(raw.id, 80);
  const title = sanitizeSingleLineText(raw.title, 150);
  const date = sanitizeSingleLineText(raw.date, 10);
  if (!id || !title || !isValidIsoDateString(date)) {
    return null;
  }

  const rawEndDate = sanitizeSingleLineText(raw.endDate, 10);
  const endDate = rawEndDate && isValidIsoDateString(rawEndDate) ? rawEndDate : undefined;

  const category = resolveAllowedCategory(raw.category);
  const rawTz = sanitizeSingleLineText(raw.timeZone, 60);
  const timeZone = rawTz && isValidTimeZone(rawTz) ? rawTz : undefined;

  const { location, locationAddress } = normalizePlaceAndAddress(
    sanitizeSingleLineText(raw.location, 160),
    sanitizeSingleLineText(raw.locationAddress, 200)
  );
  const { locationLat, locationLng } = normalizeCoordinates(raw.locationLat, raw.locationLng);

  let checklist: ChecklistItem[] | undefined;
  if (raw.checklist && raw.checklist.length > 0) {
    const cleanedChecklist = raw.checklist
      .slice(0, 8)
      .map((item, idx) => {
        const text = sanitizeSingleLineText(item.text, 200);
        if (!text) return null;
        return {
          id: sanitizeIdentifier(item.id, 80) || `chk-${idx}`,
          text,
          done: Boolean(item.done),
        };
      })
      .filter((item): item is ChecklistItem => item !== null);

    if (cleanedChecklist.length > 0) {
      checklist = cleanedChecklist;
    }
  }

  return {
    id,
    title,
    date,
    endDate,
    startTime: normalizeTimeString(raw.startTime, '10:00'),
    endTime: normalizeTimeString(raw.endTime, '11:00'),
    timeZone,
    isAllDay: Boolean(raw.isAllDay),
    category,
    projectId: sanitizeIdentifier(raw.projectId, 80) || undefined,
    location,
    locationAddress,
    locationLat,
    locationLng,
    content: sanitizeMultilineText(raw.content, 500, true) || undefined,
    isCompleted: Boolean(raw.isCompleted),
    checklist,
  };
}

function prioritizeEventsByDateProximity(
  rawEvents: ParsedCalendarEventInput[],
  anchorDates: string[],
  limit: number
): CalendarEventItem[] {
  const sanitizedAll = rawEvents
    .map((ev) => sanitizeEventSummary(ev))
    .filter((ev): ev is CalendarEventItem => ev !== null);

  if (sanitizedAll.length <= limit) {
    return sanitizedAll;
  }

  const validAnchors = anchorDates.filter((d) => Boolean(d) && isValidIsoDateString(d));
  if (validAnchors.length === 0) {
    return sanitizedAll.slice(0, limit);
  }

  return sanitizedAll
    .map((ev) => {
      let minDist = Number.MAX_SAFE_INTEGER;
      for (const anchor of validAnchors) {
        const startDist = getDayDistance(ev.date, anchor);
        const endDist = ev.endDate ? getDayDistance(ev.endDate, anchor) : startDist;
        const spanned = ev.endDate && ev.date <= anchor && anchor <= ev.endDate ? 0 : Math.min(startDist, endDist);
        if (spanned < minDist) {
          minDist = spanned;
        }
      }
      return { ev, minDist };
    })
    .sort((a, b) => a.minDist - b.minDist || a.ev.date.localeCompare(b.ev.date))
    .slice(0, limit)
    .map((item) => item.ev)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

/**
 * Zod 스키마 검증 완료 후 executeGeminiAgentCommand 전달 전 정밀 페이로드 살균
 */
export function sanitizeAgentCommandPayload(
  input: AgentCommandRequestInput
): ValidatedAgentRequest {
  const prompt = sanitizeMultilineText(input.prompt, MAX_PROMPT_LENGTH, false);
  const modelId = resolveAllowedCloudModel(input.modelId);

  let sanitizedImage: SanitizedAgentImage | undefined;
  if (input.image) {
    const mimeType = sanitizeSingleLineText(input.image.mimeType, 40).toLowerCase();
    const data = sanitizeBase64Data(input.image.data);
    if (ALLOWED_IMAGE_MIME_TYPES.has(mimeType) && data.length > 0) {
      sanitizedImage = {
        data,
        mimeType,
      };
    }
  }

  const sanitizedAttachments: SanitizedAgentAttachment[] = [];
  if (input.attachments) {
    for (const att of input.attachments.slice(0, MAX_ATTACHMENTS)) {
      const name = sanitizeFileName(att.name, 160);
      const kind = resolveAttachmentKind(att.kind);

      if (att.transferMode === 'inline') {
        const mimeType = sanitizeSingleLineText(att.mimeType, 100).toLowerCase();
        const base64Data = sanitizeBase64Data(att.base64Data);
        if (ALLOWED_INLINE_MIME_TYPES.has(mimeType) && base64Data.length > 0) {
          sanitizedAttachments.push({
            name,
            mimeType,
            kind,
            transferMode: 'inline',
            base64Data,
          });
        }
      } else {
        const rawTextMime = sanitizeSingleLineText(att.mimeType, 100).toLowerCase();
        const mimeType = ALLOWED_TEXT_MIME_TYPES.has(rawTextMime) ? rawTextMime : 'text/plain';
        const textContent = sanitizeMultilineText(
          att.textContent,
          MAX_ATTACHMENT_TEXT_LENGTH,
          true
        );
        if (textContent.length > 0) {
          sanitizedAttachments.push({
            name,
            mimeType,
            kind,
            transferMode: 'text',
            textContent,
          });
        }
      }
    }
  }

  const rawCtx = input.context;
  const currentYear = rawCtx?.currentYear ?? new Date().getFullYear();
  const selectedDate =
    rawCtx?.selectedDate && isValidIsoDateString(rawCtx.selectedDate)
      ? rawCtx.selectedDate.trim()
      : getTodayDateString();

  const rawViewerTz = sanitizeSingleLineText(rawCtx?.viewerTimeZone, 60);
  const viewerTimeZone =
    rawViewerTz && isValidTimeZone(rawViewerTz) ? rawViewerTz : 'Asia/Seoul';

  const promptNaturalDate = parseNaturalDateFromText(prompt, currentYear);
  const anchorDates = [
    selectedDate,
    promptNaturalDate || '',
    rawCtx?.selectedEvent?.date || '',
    rawCtx?.lastReferencedEvent?.date || '',
  ].filter(Boolean);

  const existingEvents = prioritizeEventsByDateProximity(
    rawCtx?.existingEvents ?? [],
    anchorDates,
    MAX_EXISTING_EVENTS_SANITIZED
  );

  const chatHistory = (rawCtx?.chatHistory ?? [])
    .slice(-MAX_CHAT_HISTORY_SANITIZED)
    .map((item) => {
      const content = sanitizeMultilineText(item.content, 600, true);
      if (!content) return null;
      const targetEventTitle = item.targetEvent
        ? sanitizeSingleLineText(item.targetEvent.title, 100) || undefined
        : undefined;
      const targetEventId = item.targetEvent
        ? sanitizeIdentifier(item.targetEvent.id, 80) || undefined
        : undefined;
      return {
        role: item.role,
        content,
        targetEventTitle,
        targetEventId,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const projects = (rawCtx?.projects ?? [])
    .slice(0, MAX_PROJECTS_SANITIZED)
    .map((proj) => {
      const id = sanitizeIdentifier(proj.id, 80);
      const name = sanitizeSingleLineText(proj.name, 100);
      if (!id || !name) return null;
      return {
        id,
        name,
        code: sanitizeSingleLineText(proj.code, 16) || undefined,
        clientOrOrg: sanitizeSingleLineText(proj.clientOrOrg, 100) || undefined,
      };
    })
    .filter((proj): proj is NonNullable<typeof proj> => proj !== null);

  const selectedProjectId = sanitizeIdentifier(rawCtx?.selectedProjectId, 80) || 'all';
  const activeProjectName = sanitizeSingleLineText(rawCtx?.activeProjectName, 100) || undefined;

  return {
    prompt,
    modelId,
    image: sanitizedImage,
    attachments: sanitizedAttachments,
    context: {
      currentYear,
      selectedDate,
      viewerTimeZone,
      selectedProjectId,
      activeProjectName,
      existingEvents,
      selectedEvent: sanitizeEventSummary(rawCtx?.selectedEvent),
      lastReferencedEvent: sanitizeEventSummary(rawCtx?.lastReferencedEvent),
      chatHistory,
      projects,
    },
  };
}

export function sanitizeGroundingDatesPayload(
  input: GroundingDatesRequestInput
): ValidatedGroundingDiscoveryRequest {
  const topic = sanitizeSingleLineText(input.topic, MAX_GROUNDING_TOPIC_LENGTH);
  const rangeMonths = Math.min(12, Math.max(1, Math.round(input.rangeMonths)));
  const modelId = resolveAllowedCloudModel(input.modelId);
  const currentYear = input.currentYear ?? new Date().getFullYear();
  const selectedDate =
    input.selectedDate && isValidIsoDateString(input.selectedDate)
      ? input.selectedDate.trim()
      : getTodayDateString();

  const existingEvents = prioritizeEventsByDateProximity(
    input.existingEvents,
    [selectedDate, parseNaturalDateFromText(topic, currentYear) || ''],
    MAX_EXISTING_EVENTS_SANITIZED
  );

  return {
    topic,
    rangeMonths,
    modelId,
    currentYear,
    selectedDate,
    activeProjectName: sanitizeSingleLineText(input.activeProjectName, 100) || undefined,
    activeProjectClient: sanitizeSingleLineText(input.activeProjectClient, 100) || undefined,
    existingEvents,
  };
}

export function sanitizeResolveLocationPayload(
  input: ResolveLocationRequestInput
): ValidatedLocationResolveRequest {
  const rawLocation = sanitizeSingleLineText(input.location, 180);
  const rawAddress = sanitizeSingleLineText(input.locationAddress, 220) || undefined;
  const { location, locationAddress } = normalizePlaceAndAddress(rawLocation, rawAddress);
  const effectiveLocation = location || rawLocation || locationAddress || rawAddress || '';

  return {
    location: effectiveLocation,
    locationAddress: locationAddress || rawAddress,
    modelId: resolveAllowedCloudModel(input.modelId),
  };
}

export function sanitizeEnrichLocationsPayload(
  input: EnrichLocationsRequestInput
): ValidatedEnrichLocationsRequest {
  const items = input.items
    .slice(0, 8)
    .map((it) => ({
      key: sanitizeIdentifier(it.key, 120),
      queryName: sanitizeSingleLineText(it.queryName, 260),
    }))
    .filter((it) => Boolean(it.key && it.queryName));

  return {
    items,
    modelId: resolveAllowedCloudModel(input.modelId),
  };
}

/**
 * 요청 검증 함수 (명시적 Zod 스키마 검증 + 용량 상한 검증)
 */
export function validateAgentCommandRequest(
  body: unknown
): ValidationResult<AgentCommandRequestInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: '유효하지 않은 요청 형식입니다.' };
  }

  const parsed = AgentCommandRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: formatSafeZodError(parsed.error, '유효하지 않은 명령 요청 형식입니다.'),
    };
  }

  const data = parsed.data;
  let totalInlineBase64Len = 0;

  if (data.image) {
    const cleanImgData = sanitizeBase64Data(data.image.data);
    if (cleanImgData.length > MAX_IMAGE_BASE64_LENGTH) {
      return {
        ok: false,
        status: 413,
        error: '첨부 이미지 용량이 너무 큽니다. 4MB 이하의 이미지를 사용해 주세요.',
      };
    }
    totalInlineBase64Len += cleanImgData.length;
  }

  if (data.attachments) {
    for (const att of data.attachments) {
      if (att.transferMode === 'inline') {
        const cleanAttData = sanitizeBase64Data(att.base64Data);
        if (cleanAttData.length > MAX_INLINE_BASE64_LENGTH) {
          return {
            ok: false,
            status: 413,
            error: '첨부 파일 용량이 허용 상한(8MB)을 초과했습니다.',
          };
        }
        totalInlineBase64Len += cleanAttData.length;
        if (totalInlineBase64Len > MAX_TOTAL_INLINE_BASE64_LENGTH) {
          return {
            ok: false,
            status: 413,
            error: '전체 첨부 파일 용량 합계가 너무 큽니다. 일부 파일을 나누어 전송해 주세요.',
          };
        }
      }
    }
  }

  return { ok: true, value: data };
}

export function validateGroundingDatesRequest(
  body: unknown
): ValidationResult<GroundingDatesRequestInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: '유효하지 않은 요청 형식입니다.' };
  }

  const parsed = GroundingDatesRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: formatSafeZodError(parsed.error, '유효하지 않은 일정 탐색 요청 형식입니다.'),
    };
  }

  return { ok: true, value: parsed.data };
}

export function validateResolveLocationRequest(
  body: unknown
): ValidationResult<ResolveLocationRequestInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: '유효하지 않은 요청 형식입니다.' };
  }

  const parsed = ResolveLocationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: formatSafeZodError(parsed.error, '유효하지 않은 위치 탐색 요청 형식입니다.'),
    };
  }

  return { ok: true, value: parsed.data };
}

export function validateEnrichLocationsRequest(
  body: unknown
): ValidationResult<EnrichLocationsRequestInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: '유효하지 않은 요청 형식입니다.' };
  }

  const parsed = EnrichLocationsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: formatSafeZodError(parsed.error, '유효하지 않은 일괄 위치 탐색 요청 형식입니다.'),
    };
  }

  return { ok: true, value: parsed.data };
}

const ALLOWED_OLLAMA_ENDPOINTS = new Set([
  '/api/tags',
  '/api/ps',
  '/api/version',
  '/api/chat',
]);

const ALLOWED_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const OllamaProxyRequestSchema = z
  .object({
    baseUrl: z.string().min(1).max(200).optional().default('http://127.0.0.1:11434'),
    endpoint: z.enum(['/api/tags', '/api/ps', '/api/version', '/api/chat']),
    method: z.enum(['GET', 'POST']).optional().default('GET'),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type OllamaProxyRequestInput = z.infer<typeof OllamaProxyRequestSchema>;

export interface ValidatedOllamaProxyTarget {
  targetUrl: string;
  endpoint: '/api/tags' | '/api/ps' | '/api/version' | '/api/chat';
  method: 'GET' | 'POST';
  payload?: Record<string, unknown>;
}

export function validateAndSanitizeOllamaProxyRequest(
  body: unknown
): ValidationResult<ValidatedOllamaProxyTarget> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: '유효하지 않은 프록시 요청 형식입니다.' };
  }

  const parsed = OllamaProxyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: '허용되지 않은 로컬 프록시 요청 파라미터입니다.',
    };
  }

  const { baseUrl, endpoint, method, payload } = parsed.data;
  if (!ALLOWED_OLLAMA_ENDPOINTS.has(endpoint)) {
    return { ok: false, status: 400, error: '허용되지 않은 Ollama API 경로입니다.' };
  }

  if (endpoint === '/api/chat' && method !== 'POST') {
    return { ok: false, status: 400, error: '채팅 요청은 POST 메서드만 허용됩니다.' };
  }
  if (endpoint !== '/api/chat' && method !== 'GET') {
    return { ok: false, status: 400, error: '상태 조회 요청은 GET 메서드만 허용됩니다.' };
  }

  let parsedUrl: URL;
  try {
    const rawTrimmed = stripUnsafeChars(baseUrl).trim().replace(/\/+$/, '');
    const withProto = /^https?:\/\//i.test(rawTrimmed) ? rawTrimmed : `http://${rawTrimmed}`;
    parsedUrl = new URL(withProto);
  } catch {
    return { ok: false, status: 400, error: '올바른 로컬 서버 URL 형식이 아닙니다.' };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, status: 400, error: 'HTTP/HTTPS 프로토콜만 허용됩니다.' };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (!ALLOWED_LOOPBACK_HOSTS.has(hostname)) {
    return {
      ok: false,
      status: 403,
      error: '보안 정책상 백엔드 프록시는 로컬 루프백(127.0.0.1 / localhost) 주소만 지원합니다.',
    };
  }

  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, status: 400, error: 'URL 내 인증 정보는 허용되지 않습니다.' };
  }

  const portNum = parsedUrl.port ? Number(parsedUrl.port) : 11434;
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return { ok: false, status: 400, error: '유효하지 않은 포트 번호입니다.' };
  }

  const origin = `${parsedUrl.protocol}//${parsedUrl.hostname}:${portNum}`;
  return {
    ok: true,
    value: {
      targetUrl: `${origin}${endpoint}`,
      endpoint,
      method,
      payload: method === 'POST' ? payload : undefined,
    },
  };
}

interface CpuTickTotals {
  idle: number;
  total: number;
}

function readCpuTickTotals(): CpuTickTotals {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

let prevCpuSnapshot: CpuTickTotals = readCpuTickTotals();
let lastHostCpuPercent = 0;

const cpuSampleInterval = setInterval(() => {
  const current = readCpuTickTotals();
  const totalDelta = current.total - prevCpuSnapshot.total;
  const idleDelta = current.idle - prevCpuSnapshot.idle;
  if (totalDelta > 0) {
    const busyRatio = Math.max(0, Math.min(1, 1 - idleDelta / totalDelta));
    lastHostCpuPercent = Math.round(busyRatio * 100);
  }
  prevCpuSnapshot = current;
}, 2000);
cpuSampleInterval.unref();

export interface HostHardwareMetrics {
  cpuPercent: number;
  cores: number;
  totalMemBytes: number;
  usedMemBytes: number;
  isLocalHostServer: boolean;
}

export function getHostHardwareMetrics(): HostHardwareMetrics {
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const usedMemBytes = Math.max(0, totalMemBytes - freeMemBytes);
  const cores = Math.max(1, os.cpus().length);
  const isCloudContainer = Boolean(
    process.env.K_SERVICE || process.env.CLOUD_RUN_JOB || process.env.DYNO
  );

  return {
    cpuPercent: lastHostCpuPercent,
    cores,
    totalMemBytes,
    usedMemBytes,
    isLocalHostServer: !isCloudContainer,
  };
}

/**
 * 통합 검증 + 살균 헬퍼 (하위 호환 유지)
 */
export function validateAndSanitizeAgentRequest(
  body: unknown
): ValidationResult<ValidatedAgentRequest> {
  const validated = validateAgentCommandRequest(body);
  if (!validated.ok) return validated;
  const sanitized = sanitizeAgentCommandPayload(validated.value);
  if (!sanitized.prompt && !sanitized.image && sanitized.attachments.length === 0) {
    return { ok: false, status: 400, error: '자연어 지시나 분석할 파일을 전달해 주세요.' };
  }
  return { ok: true, value: sanitized };
}

export function validateAndSanitizeGroundingRequest(
  body: unknown
): ValidationResult<ValidatedGroundingDiscoveryRequest> {
  const validated = validateGroundingDatesRequest(body);
  if (!validated.ok) return validated;
  return { ok: true, value: sanitizeGroundingDatesPayload(validated.value) };
}

export function validateAndSanitizeLocationResolveRequest(
  body: unknown
): ValidationResult<ValidatedLocationResolveRequest> {
  const validated = validateResolveLocationRequest(body);
  if (!validated.ok) return validated;
  const sanitized = sanitizeResolveLocationPayload(validated.value);
  if (!sanitized.location && !sanitized.locationAddress) {
    return { ok: false, status: 400, error: '탐색할 장소명 또는 주소를 입력해 주세요.' };
  }
  return { ok: true, value: sanitized };
}

/**
 * 내부 스택 트레이스·API 키·SDK 상세 오류 노출을 원천 차단하는 안전 에러 응답 변환기
 */
export type ApiErrorContext = 'command' | 'grounding' | 'location' | 'general';

const UpstreamErrorShapeSchema = z.object({
  status: z.number().int().optional(),
  statusCode: z.number().int().optional(),
  code: z.string().optional(),
  type: z.string().optional(),
  name: z.string().optional(),
});

const FALLBACK_MESSAGES: Record<ApiErrorContext, string> = {
  command: 'AI 일정 분석 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  grounding: '일정 탐색 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  location: '장소 정보를 확인하는 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  general: '요청을 처리하는 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
};

export function toSafeErrorResponse(
  err: unknown,
  context: ApiErrorContext = 'general',
  isInlineMediaEndpoint = false
): { status: number; error: string } {
  const parsedErr = UpstreamErrorShapeSchema.safeParse(err);
  const rawStatus = parsedErr.success
    ? parsedErr.data.statusCode ?? parsedErr.data.status
    : undefined;
  const rawCode = parsedErr.success ? parsedErr.data.code : undefined;
  const errType = parsedErr.success ? parsedErr.data.type : undefined;

  if (errType === 'entity.too.large' || rawStatus === 413) {
    return {
      status: 413,
      error: isInlineMediaEndpoint
        ? '첨부 파일 포함 전체 요청 용량이 허용 한도(18MB)를 초과했습니다.'
        : '요청 데이터 크기가 허용 한도(512KB)를 초과했습니다.',
    };
  }

  if (errType === 'entity.parse.failed' || (err instanceof SyntaxError && rawStatus === 400)) {
    return {
      status: 400,
      error: '요청 본문이 올바른 JSON 형식이 아닙니다.',
    };
  }

  if (
    errType === 'charset.unsupported' ||
    errType === 'encoding.unsupported' ||
    rawStatus === 415
  ) {
    return {
      status: 415,
      error: '지원하지 않는 요청 인코딩 형식입니다.',
    };
  }

  if (rawStatus === 429) {
    return {
      status: 429,
      error: 'AI 서비스 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
    };
  }

  if (rawStatus === 503 && rawCode === 'GEMINI_KEY_MISSING') {
    return {
      status: 503,
      error:
        '클라우드 AI 연결을 위해 Settings > Secrets 패널에서 GEMINI_API_KEY를 설정하거나, 모델 선택기에서 로컬 모델(WebLLM · Ollama)로 전환해 주세요.',
    };
  }

  if (rawStatus === 503) {
    return {
      status: 503,
      error: '현재 AI 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    };
  }

  if (rawStatus === 401 || rawStatus === 403) {
    return {
      status: 502,
      error:
        'GEMINI_API_KEY 인증을 확인할 수 없습니다. Settings > Secrets 패널에 설정된 키가 유효한지 점검해 주세요.',
    };
  }

  if (rawStatus === 400) {
    return {
      status: 400,
      error: '전달된 요청 또는 첨부 파일을 처리할 수 없습니다. 입력 내용을 확인해 주세요.',
    };
  }

  return {
    status: 502,
    error: FALLBACK_MESSAGES[context],
  };
}

export function logSafeServerError(scope: string, err: unknown): void {
  const parsedErr = UpstreamErrorShapeSchema.safeParse(err);
  const status = parsedErr.success
    ? parsedErr.data.statusCode ?? parsedErr.data.status ?? 500
    : 500;
  const name = parsedErr.success && parsedErr.data.name ? parsedErr.data.name : 'Error';
  console.error(`[${scope}] name=${name} status=${status}`);
}

export function apiErrorHandler(
  err: unknown,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const isInlineMediaEndpoint =
    req.path === '/api/agent/command' || req.path === '/api/agent/ollama-proxy';
  const safe = toSafeErrorResponse(err, 'general', isInlineMediaEndpoint);
  logSafeServerError('API Middleware Error', err);
  res.status(safe.status).json({ error: safe.error });
}
