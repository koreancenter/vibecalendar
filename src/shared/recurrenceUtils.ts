import { CalendarEventItem, RecurrenceFrequency, RecurrenceRule } from '../types';
import { addDays, formatDateString, getDayDistance } from './dateUtils';

export const RECURRENCE_OCCURRENCE_SEP = '__occ__';

export interface RecurrenceSelectOption {
  value: RecurrenceFrequency | 'none';
  label: string;
}

export const RECURRENCE_OPTIONS: RecurrenceSelectOption[] = [
  { value: 'none', label: '반복 없음' },
  { value: 'daily', label: '매일' },
  { value: 'weekly', label: '매주' },
  { value: 'biweekly', label: '격주 (2주마다)' },
  { value: 'monthly', label: '매월' },
  { value: 'yearly', label: '매년' },
];

const VALID_FREQUENCIES = new Set<RecurrenceFrequency>([
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'yearly',
]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidRecurrenceFrequency(val: unknown): val is RecurrenceFrequency {
  return typeof val === 'string' && VALID_FREQUENCIES.has(val as RecurrenceFrequency);
}

export function normalizeRecurrenceRule(raw: unknown): RecurrenceRule | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const freqRaw = typeof obj.frequency === 'string' ? obj.frequency.trim().toLowerCase() : '';
  if (!isValidRecurrenceFrequency(freqRaw)) return undefined;

  const until =
    typeof obj.until === 'string' && ISO_DATE_RE.test(obj.until.trim())
      ? obj.until.trim()
      : undefined;

  const rawCount = typeof obj.count === 'number' ? obj.count : Number(obj.count);
  const count =
    Number.isFinite(rawCount) && rawCount >= 1 && rawCount <= 365
      ? Math.round(rawCount)
      : undefined;

  return {
    frequency: freqRaw,
    ...(until ? { until } : {}),
    ...(count ? { count } : {}),
  };
}

/**
 * 자연어 프롬프트에서 명확한 반복 주기 표현("매주", "격주", "매일", "매월", "매년")이 있을 때 보조 추론
 */
export function inferRecurrenceRuleFromPrompt(prompt?: string | null): RecurrenceRule | undefined {
  if (!prompt || !prompt.trim()) return undefined;
  const text = prompt.trim();

  let frequency: RecurrenceFrequency | null = null;
  if (/(?:격주|2\s*주\s*마다|이주\s*마다)/.test(text)) {
    frequency = 'biweekly';
  } else if (/(?:매주|주간\s*정기|주례|매주\s*[월화수목금토일])/.test(text)) {
    frequency = 'weekly';
  } else if (/(?:매일|일일\s*정기|하루\s*마다)/.test(text)) {
    frequency = 'daily';
  } else if (/(?:매월|매달|월간\s*정기|월례)/.test(text)) {
    frequency = 'monthly';
  } else if (/(?:매년|해마다|연례)/.test(text)) {
    frequency = 'yearly';
  }

  if (!frequency) return undefined;

  const countMatch = text.match(/(\d{1,3})\s*(?:회|번|주\s*동안\s*반복)/);
  const count =
    countMatch && Number(countMatch[1]) >= 2 && Number(countMatch[1]) <= 365
      ? Number(countMatch[1])
      : undefined;

  return {
    frequency,
    ...(count ? { count } : {}),
  };
}

export function formatRecurrenceShortLabel(rule?: RecurrenceRule | null): string {
  if (!rule) return '';
  switch (rule.frequency) {
    case 'daily':
      return '매일';
    case 'weekly':
      return '매주';
    case 'biweekly':
      return '격주';
    case 'monthly':
      return '매월';
    case 'yearly':
      return '매년';
    default:
      return '';
  }
}

export function formatRecurrenceLabel(rule?: RecurrenceRule | null): string {
  if (!rule) return '반복 없음';
  const base = `${formatRecurrenceShortLabel(rule)} 반복`;
  if (rule.until) {
    return `${base} · ${rule.until}까지`;
  }
  if (rule.count) {
    return `${base} · 총 ${rule.count}회`;
  }
  return base;
}

export function parseOccurrenceIdentity(
  eventOrId:
    | string
    | Pick<CalendarEventItem, 'id' | 'date' | 'recurrenceMasterId' | 'occurrenceDate'>
): {
  masterId: string;
  occurrenceDate: string | null;
  isVirtualOccurrence: boolean;
} {
  const rawId = typeof eventOrId === 'string' ? eventOrId : eventOrId.id;
  const sepIdx = rawId.indexOf(RECURRENCE_OCCURRENCE_SEP);
  if (sepIdx !== -1) {
    const masterId = rawId.slice(0, sepIdx);
    const occDate = rawId.slice(sepIdx + RECURRENCE_OCCURRENCE_SEP.length);
    return {
      masterId,
      occurrenceDate: ISO_DATE_RE.test(occDate) ? occDate : null,
      isVirtualOccurrence: true,
    };
  }

  if (typeof eventOrId !== 'string') {
    return {
      masterId: eventOrId.recurrenceMasterId || eventOrId.id,
      occurrenceDate: eventOrId.occurrenceDate || eventOrId.date || null,
      isVirtualOccurrence: false,
    };
  }

  return {
    masterId: rawId,
    occurrenceDate: null,
    isVirtualOccurrence: false,
  };
}

export function resolveMasterEventId(eventId: string): string {
  return parseOccurrenceIdentity(eventId).masterId;
}

export function isRecurringSeriesItem(event: CalendarEventItem | null | undefined): boolean {
  if (!event) return false;
  return Boolean(
    event.recurrence ||
      event.recurrenceMasterId ||
      event.id.includes(RECURRENCE_OCCURRENCE_SEP)
  );
}

/**
 * 저장소/백업 직렬화 전 가상 회차(__occ__)를 제거하고 마스터 일정만 남김
 */
export function stripVirtualOccurrences(events: CalendarEventItem[]): CalendarEventItem[] {
  return events
    .filter((ev) => !ev.id.includes(RECURRENCE_OCCURRENCE_SEP))
    .map((ev) => {
      if (!ev.recurrenceMasterId && !ev.occurrenceDate) return ev;
      const cleaned: CalendarEventItem = { ...ev };
      delete cleaned.recurrenceMasterId;
      delete cleaned.occurrenceDate;
      return cleaned;
    });
}

function addMonthsClamped(baseDateStr: string, monthsToAdd: number): string {
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const totalMonths = (y * 12 + (m - 1)) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12;
  const maxDayInTargetMonth = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
  const clampedDay = Math.min(d, maxDayInTargetMonth);
  return formatDateString(new Date(targetYear, targetMonthIndex, clampedDay));
}

function advanceRecurrenceDate(
  anchorDateStr: string,
  frequency: RecurrenceFrequency,
  stepIndex: number
): string {
  if (stepIndex === 0) return anchorDateStr;
  switch (frequency) {
    case 'daily':
      return addDays(anchorDateStr, stepIndex);
    case 'weekly':
      return addDays(anchorDateStr, stepIndex * 7);
    case 'biweekly':
      return addDays(anchorDateStr, stepIndex * 14);
    case 'monthly':
      return addMonthsClamped(anchorDateStr, stepIndex);
    case 'yearly':
      return addMonthsClamped(anchorDateStr, stepIndex * 12);
  }
}

/**
 * 지정된 조회 구간 [rangeStart, rangeEnd] 내에 걸치는 반복 일정 회차를 동적으로 전개
 * - 타임존 시차(±1일) 경계 누락 방지를 위해 양옆 1일 여유 버퍼 적용
 */
export function expandRecurringEventsForRange(
  events: CalendarEventItem[],
  rangeStart: string,
  rangeEnd: string,
  maxOccurrencesPerSeries = 180
): CalendarEventItem[] {
  if (!events.length || !ISO_DATE_RE.test(rangeStart) || !ISO_DATE_RE.test(rangeEnd)) {
    return events;
  }

  const paddedStart = addDays(rangeStart, -1);
  const paddedEnd = addDays(rangeEnd, 1);
  const result: CalendarEventItem[] = [];

  for (const ev of events) {
    if (ev.id.includes(RECURRENCE_OCCURRENCE_SEP)) {
      result.push(ev);
      continue;
    }

    if (!ev.recurrence) {
      result.push(ev);
      continue;
    }

    const rule = ev.recurrence;
    const spanOffsetDays =
      ev.endDate && ISO_DATE_RE.test(ev.endDate) && ev.endDate > ev.date
        ? Math.min(30, getDayDistance(ev.date, ev.endDate))
        : 0;

    const excludedSet = new Set(ev.excludedDates || []);
    const completedSet = new Set(ev.completedDates || []);
    const maxCount = rule.count && rule.count >= 1 ? Math.min(rule.count, 365) : 365;

    let emittedForSeries = 0;
    let totalGeneratedCount = 0;

    for (let step = 0; step < 730; step++) {
      if (totalGeneratedCount >= maxCount || emittedForSeries >= maxOccurrencesPerSeries) {
        break;
      }

      const occStart = advanceRecurrenceDate(ev.date, rule.frequency, step);
      if (rule.until && occStart > rule.until) {
        break;
      }
      if (occStart > paddedEnd) {
        break;
      }

      totalGeneratedCount += 1;

      if (excludedSet.has(occStart)) {
        continue;
      }

      const occEnd = spanOffsetDays > 0 ? addDays(occStart, spanOffsetDays) : occStart;
      if (occEnd < paddedStart) {
        continue;
      }

      const isMasterDate = occStart === ev.date;
      const occId = isMasterDate ? ev.id : `${ev.id}${RECURRENCE_OCCURRENCE_SEP}${occStart}`;
      const isOccCompleted =
        completedSet.size > 0
          ? completedSet.has(occStart)
          : isMasterDate
          ? Boolean(ev.isCompleted)
          : false;

      result.push({
        ...ev,
        id: occId,
        date: occStart,
        endDate: spanOffsetDays > 0 ? occEnd : undefined,
        isCompleted: isOccCompleted,
        recurrenceMasterId: ev.id,
        occurrenceDate: occStart,
      });

      emittedForSeries += 1;
    }
  }

  return result;
}

/**
 * RecurrenceRule -> RFC 5545 RRULE 값 문자열 변환 (예: "FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231T235959Z")
 */
export function recurrenceRuleToRruleString(rule: RecurrenceRule): string {
  const parts: string[] = [];
  switch (rule.frequency) {
    case 'daily':
      parts.push('FREQ=DAILY');
      break;
    case 'weekly':
      parts.push('FREQ=WEEKLY');
      break;
    case 'biweekly':
      parts.push('FREQ=WEEKLY', 'INTERVAL=2');
      break;
    case 'monthly':
      parts.push('FREQ=MONTHLY');
      break;
    case 'yearly':
      parts.push('FREQ=YEARLY');
      break;
  }

  if (rule.until && ISO_DATE_RE.test(rule.until)) {
    const compact = rule.until.replace(/-/g, '');
    parts.push(`UNTIL=${compact}T235959Z`);
  } else if (rule.count && rule.count >= 1) {
    parts.push(`COUNT=${Math.round(rule.count)}`);
  }

  return parts.join(';');
}

/**
 * RFC 5545 RRULE 문자열 -> RecurrenceRule 역변환
 */
export function parseRruleToRecurrenceRule(rruleRaw: string): RecurrenceRule | undefined {
  if (!rruleRaw || !rruleRaw.trim()) return undefined;
  const cleaned = rruleRaw.replace(/^RRULE:/i, '').trim();
  const kvMap = new Map<string, string>();
  for (const token of cleaned.split(';')) {
    const eqIdx = token.indexOf('=');
    if (eqIdx > 0) {
      const k = token.slice(0, eqIdx).trim().toUpperCase();
      const v = token.slice(eqIdx + 1).trim();
      kvMap.set(k, v);
    }
  }

  const freqToken = (kvMap.get('FREQ') || '').toUpperCase();
  const intervalNum = Number(kvMap.get('INTERVAL') || '1') || 1;

  let frequency: RecurrenceFrequency | null = null;
  if (freqToken === 'DAILY') {
    frequency = 'daily';
  } else if (freqToken === 'WEEKLY') {
    frequency = intervalNum === 2 ? 'biweekly' : 'weekly';
  } else if (freqToken === 'MONTHLY') {
    frequency = 'monthly';
  } else if (freqToken === 'YEARLY') {
    frequency = 'yearly';
  }

  if (!frequency) return undefined;

  let until: string | undefined;
  const untilRaw = kvMap.get('UNTIL');
  if (untilRaw) {
    const m = untilRaw.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) {
      until = `${m[1]}-${m[2]}-${m[3]}`;
    }
  }

  let count: number | undefined;
  const countRaw = kvMap.get('COUNT');
  if (countRaw) {
    const parsedCount = Number(countRaw);
    if (Number.isFinite(parsedCount) && parsedCount >= 1 && parsedCount <= 365) {
      count = Math.round(parsedCount);
    }
  }

  return {
    frequency,
    ...(until ? { until } : {}),
    ...(count ? { count } : {}),
  };
}
