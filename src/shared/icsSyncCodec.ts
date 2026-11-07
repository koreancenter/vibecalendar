import { CalendarCategory, CalendarEventItem, ChecklistItem, RecurrenceRule } from '../types';
import { addDays } from './dateUtils';
import { formatCombinedLocation, hasValidCoordinates, normalizeCoordinates, normalizePlaceAndAddress } from './locationUtils';
import { parseRruleToRecurrenceRule, recurrenceRuleToRruleString } from './recurrenceUtils';
import { detectBrowserTimeZone, formatClockInTimeZone, inferTimeZoneFromLocation, isValidTimeZone } from './timeZoneUtils';

export interface NormalizedRemoteEventPayload {
  remoteUid: string;
  remoteIcalUid?: string;
  remoteEtag?: string;
  remoteHref?: string;
  status: 'confirmed' | 'cancelled';
  title: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  timeZone?: string;
  isAllDay: boolean;
  category?: CalendarCategory;
  location?: string;
  locationAddress?: string;
  locationLat?: number;
  locationLng?: number;
  content?: string;
  checklist?: ChecklistItem[];
  recurrence?: RecurrenceRule;
  excludedDates?: string[];
  showAsFree?: boolean;
}

const VALID_CATEGORIES = new Set<CalendarCategory>([
  '업무',
  '방문·출장',
  '식사·모임',
  '개인',
  '행사·세미나',
  '기타',
]);

function unescapeIcsText(raw: string): string {
  return raw
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function escapeIcsText(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function unfoldIcsLines(icsText: string): string[] {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
  return unfolded
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

interface ParsedProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parsePropLine(line: string): ParsedProp | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx <= 0) return null;
  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const segments = head.split(';');
  const name = (segments[0] || '').trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const eqIdx = seg.indexOf('=');
    if (eqIdx > 0) {
      const k = seg.slice(0, eqIdx).trim().toUpperCase();
      const v = seg
        .slice(eqIdx + 1)
        .trim()
        .replace(/^"|"$/g, '');
      params[k] = v;
    }
  }
  return { name, params, value };
}

const WINDOWS_TO_IANA_TZ: Record<string, string> = {
  UTC: 'UTC',
  'Korea Standard Time': 'Asia/Seoul',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'SE Asia Standard Time': 'Asia/Jakarta',
  'India Standard Time': 'Asia/Kolkata',
  'Arabian Standard Time': 'Asia/Dubai',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'AUS Eastern Standard Time': 'Australia/Sydney',
};

export function resolveSafeIanaTimeZone(rawTz?: string | null): string | undefined {
  if (!rawTz) return undefined;
  const trimmed = rawTz.trim();
  if (!trimmed) return undefined;
  if (WINDOWS_TO_IANA_TZ[trimmed]) {
    return WINDOWS_TO_IANA_TZ[trimmed];
  }
  if (isValidTimeZone(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function parseDateTimeProp(
  rawValue: string,
  params: Record<string, string>,
  fallbackZone: string
): {
  date: string;
  time?: string;
  isAllDay: boolean;
  timeZone?: string;
} | null {
  const val = rawValue.trim();
  const isDateOnly = params.VALUE?.toUpperCase() === 'DATE' || /^\d{8}$/.test(val);
  if (isDateOnly) {
    const m = val.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return {
      date: `${m[1]}-${m[2]}-${m[3]}`,
      isAllDay: true,
    };
  }

  const dtMatch = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(?:\d{2})?(Z)?$/i);
  if (!dtMatch) return null;

  const year = Number(dtMatch[1]);
  const month = Number(dtMatch[2]);
  const day = Number(dtMatch[3]);
  const hour = Number(dtMatch[4]);
  const minute = Number(dtMatch[5]);
  const isUtc = Boolean(dtMatch[6]);
  const validTz = resolveSafeIanaTimeZone(params.TZID);

  if (isUtc) {
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    const targetZone = validTz || fallbackZone;
    const formatted = formatClockInTimeZone(utcDate, targetZone);
    return {
      date: formatted.dateShort.replace(/\./g, '-'),
      time: formatted.time24,
      isAllDay: false,
      timeZone: validTz || targetZone,
    };
  }

  return {
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    isAllDay: false,
    timeZone: validTz,
  };
}

export function decodeHybridDescriptionMetadata(rawDescription?: string | null): {
  cleanContent?: string;
  checklist?: ChecklistItem[];
  extractedCategory?: CalendarCategory;
} {
  if (!rawDescription) return {};
  const lines = rawDescription.replace(/\r\n/g, '\n').split('\n');
  const contentLines: string[] = [];
  const checklist: ChecklistItem[] = [];
  let extractedCategory: CalendarCategory | undefined;
  let inChecklist = false;
  const stamp = Date.now();

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed === '[체크리스트]') {
      inChecklist = true;
      continue;
    }
    const catMatch = trimmed.match(/^\[분류:\s*(.+?)\]$/);
    if (catMatch) {
      const candidate = catMatch[1].trim() as CalendarCategory;
      if (VALID_CATEGORIES.has(candidate)) {
        extractedCategory = candidate;
      }
      continue;
    }
    const chkMatch = trimmed.match(/^(?:-\s*)?\[([vVxX ])\]\s+(.+)$/);
    if (chkMatch) {
      checklist.push({
        id: `sync-chk-${stamp}-${checklist.length}`,
        text: chkMatch[2].trim(),
        done: chkMatch[1].trim().length > 0,
      });
      continue;
    }
    if (inChecklist && trimmed.length === 0) {
      inChecklist = false;
    }
    if (!inChecklist) {
      contentLines.push(rawLine);
    }
  }

  const joined = contentLines.join('\n').trim();
  return {
    cleanContent: joined || undefined,
    checklist: checklist.length > 0 ? checklist : undefined,
    extractedCategory,
  };
}

export function encodeHybridDescriptionMetadata(event: CalendarEventItem): string {
  const parts: string[] = [];
  if (event.content?.trim()) {
    parts.push(event.content.trim());
  }
  if (event.checklist && event.checklist.length > 0) {
    const chkLines = event.checklist.map((c) => `[${c.done ? 'v' : ' '}] ${c.text}`).join('\n');
    parts.push(`[체크리스트]\n${chkLines}`);
  }
  if (event.category) {
    parts.push(`[분류: ${event.category}]`);
  }
  return parts.join('\n\n').trim();
}

export function parseCalDavIcsResource(
  icsText: string,
  meta: {
    href?: string;
    etag?: string;
    fallbackTimeZone?: string;
  } = {}
): NormalizedRemoteEventPayload[] {
  const fallbackZone = resolveSafeIanaTimeZone(meta.fallbackTimeZone) || 'UTC';
  const lines = unfoldIcsLines(icsText);
  const results: NormalizedRemoteEventPayload[] = [];

  let inEvent = false;
  let props: ParsedProp[] = [];

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      inEvent = true;
      props = [];
      continue;
    }
    if (upper === 'END:VEVENT') {
      if (inEvent && props.length > 0) {
        const getFirst = (n: string) => props.find((p) => p.name === n);
        const getAll = (n: string) => props.filter((p) => p.name === n);

        // Skip detached recurrence override sub-components with RECURRENCE-ID when master VEVENT exists
        const recurrenceIdProp = getFirst('RECURRENCE-ID');
        if (!recurrenceIdProp) {
          const uidProp = getFirst('UID');
          const statusProp = getFirst('STATUS');
          const dtStartProp = getFirst('DTSTART');
          const dtEndProp = getFirst('DTEND');
          const summaryProp = getFirst('SUMMARY');
          const transpProp = getFirst('TRANSP');

          const rawUid = uidProp ? unescapeIcsText(uidProp.value) : meta.href || `caldav-${Date.now()}`;
          const isCancelled = statusProp?.value.trim().toUpperCase() === 'CANCELLED';

          if (isCancelled) {
            results.push({
              remoteUid: rawUid,
              remoteIcalUid: rawUid,
              remoteEtag: meta.etag,
              remoteHref: meta.href,
              status: 'cancelled',
              title: summaryProp ? unescapeIcsText(summaryProp.value) || '취소된 일정' : '취소된 일정',
              date: '1970-01-01',
              startTime: '09:00',
              endTime: '10:00',
              isAllDay: false,
            });
          } else if (dtStartProp) {
            const parsedStart = parseDateTimeProp(dtStartProp.value, dtStartProp.params, fallbackZone);
            if (parsedStart) {
              const parsedEnd = dtEndProp
                ? parseDateTimeProp(dtEndProp.value, dtEndProp.params, fallbackZone)
                : null;

              const isAllDay = parsedStart.isAllDay;
              let endDate: string | undefined;
              let startTime = parsedStart.time || '09:00';
              let endTime = parsedEnd?.time || '10:00';

              if (isAllDay) {
                startTime = '09:00';
                endTime = '18:00';
                if (parsedEnd?.date) {
                  const inclusiveEnd = addDays(parsedEnd.date, -1);
                  if (inclusiveEnd > parsedStart.date) {
                    endDate = inclusiveEnd;
                  }
                }
              } else if (parsedEnd) {
                if (parsedEnd.date > parsedStart.date) {
                  endDate = parsedEnd.date;
                }
                if (!endDate && endTime <= startTime) {
                  const [hh, mm] = startTime.split(':').map(Number);
                  const nextMins = Math.min(23 * 60 + 59, (hh || 9) * 60 + (mm || 0) + 60);
                  endTime = `${String(Math.floor(nextMins / 60)).padStart(2, '0')}:${String(
                    nextMins % 60
                  ).padStart(2, '0')}`;
                }
              }

              const title = summaryProp ? unescapeIcsText(summaryProp.value) || '외부 일정' : '외부 일정';
              const descProp = getFirst('DESCRIPTION');
              const { cleanContent, checklist, extractedCategory } = decodeHybridDescriptionMetadata(
                descProp ? unescapeIcsText(descProp.value) : undefined
              );

              const locProp = getFirst('LOCATION');
              const { location, locationAddress } = normalizePlaceAndAddress(
                locProp ? unescapeIcsText(locProp.value) : undefined,
                undefined
              );

              let locationLat: number | undefined;
              let locationLng: number | undefined;
              const geoProp = getFirst('GEO');
              if (geoProp) {
                const [latPart, lngPart] = geoProp.value.split(';');
                const coords = normalizeCoordinates(latPart, lngPart);
                locationLat = coords.locationLat;
                locationLng = coords.locationLng;
              }

              const rruleProp = getFirst('RRULE');
              const recurrence = rruleProp ? parseRruleToRecurrenceRule(rruleProp.value) : undefined;

              const excludedDates: string[] = [];
              for (const exProp of getAll('EXDATE')) {
                for (const token of exProp.value.split(',')) {
                  const parsedEx = parseDateTimeProp(token, exProp.params, fallbackZone);
                  if (parsedEx?.date && !excludedDates.includes(parsedEx.date)) {
                    excludedDates.push(parsedEx.date);
                  }
                }
              }

              const resolvedTz = !isAllDay
                ? parsedStart.timeZone ||
                  inferTimeZoneFromLocation(location) ||
                  inferTimeZoneFromLocation(locationAddress) ||
                  undefined
                : undefined;

              results.push({
                remoteUid: rawUid,
                remoteIcalUid: rawUid,
                remoteEtag: meta.etag,
                remoteHref: meta.href,
                status: 'confirmed',
                title,
                date: parsedStart.date,
                endDate,
                startTime,
                endTime,
                timeZone: resolvedTz,
                isAllDay,
                category: extractedCategory,
                location,
                locationAddress,
                locationLat,
                locationLng,
                content: cleanContent,
                checklist,
                recurrence,
                excludedDates: excludedDates.length > 0 ? excludedDates : undefined,
                showAsFree: transpProp?.value.trim().toUpperCase() === 'TRANSPARENT',
              });
            }
          }
        }
      }
      inEvent = false;
      props = [];
      continue;
    }
    if (inEvent) {
      const p = parsePropLine(line);
      if (p) props.push(p);
    }
  }

  return results;
}

function formatIcsDateValue(dateStr: string, timeStr?: string, isAllDay = false): string {
  const [y, m, d] = dateStr.split('-');
  if (isAllDay || !timeStr) {
    return `${y}${m}${d}`;
  }
  const [hh, mm] = timeStr.split(':');
  return `${y}${m}${d}T${hh || '09'}${mm || '00'}00`;
}

export function serializeEventToCalDavIcs(event: CalendarEventItem, uid: string): string {
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const isAllDay = Boolean(event.isAllDay);
  const startStr = formatIcsDateValue(event.date, event.startTime, isAllDay);
  const endStr = isAllDay
    ? formatIcsDateValue(addDays(event.endDate || event.date, 1), undefined, true)
    : formatIcsDateValue(event.endDate || event.date, event.endTime || '10:00', false);

  const tz =
    !isAllDay && event.timeZone && isValidTimeZone(event.timeZone)
      ? event.timeZone
      : !isAllDay
      ? detectBrowserTimeZone()
      : undefined;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vibe Calendar Sync Engine//KO',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
  ];

  if (isAllDay) {
    lines.push(`DTSTART;VALUE=DATE:${startStr}`);
    lines.push(`DTEND;VALUE=DATE:${endStr}`);
  } else if (tz) {
    lines.push(`DTSTART;TZID=${tz}:${startStr}`);
    lines.push(`DTEND;TZID=${tz}:${endStr}`);
  } else {
    lines.push(`DTSTART:${startStr}`);
    lines.push(`DTEND:${endStr}`);
  }

  if (event.recurrence) {
    const rrule = recurrenceRuleToRruleString(event.recurrence);
    if (rrule) lines.push(`RRULE:${rrule}`);
  }

  if (event.excludedDates && event.excludedDates.length > 0) {
    const exValues = event.excludedDates
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .map((d) => formatIcsDateValue(d, event.startTime, isAllDay));
    if (exValues.length > 0) {
      if (isAllDay) {
        lines.push(`EXDATE;VALUE=DATE:${exValues.join(',')}`);
      } else if (tz) {
        lines.push(`EXDATE;TZID=${tz}:${exValues.join(',')}`);
      } else {
        lines.push(`EXDATE:${exValues.join(',')}`);
      }
    }
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);

  const encodedDesc = encodeHybridDescriptionMetadata(event);
  if (encodedDesc) {
    lines.push(`DESCRIPTION:${escapeIcsText(encodedDesc)}`);
  }

  const combinedLocation = formatCombinedLocation(event.location, event.locationAddress, ', ');
  if (combinedLocation) {
    lines.push(`LOCATION:${escapeIcsText(combinedLocation)}`);
  }
  if (hasValidCoordinates(event.locationLat, event.locationLng)) {
    lines.push(`GEO:${event.locationLat!.toFixed(6)};${event.locationLng!.toFixed(6)}`);
  }
  if (event.category) {
    lines.push(`CATEGORIES:${escapeIcsText(event.category)}`);
  }

  lines.push('STATUS:CONFIRMED');
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}
