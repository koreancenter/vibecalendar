import {
  CalendarCategory,
  CalendarEventItem,
  ChecklistItem,
  ProjectItem,
} from '../types';
import { addDays, getTodayDateString } from '../shared/dateUtils';
import { normalizeCoordinates, normalizePlaceAndAddress } from '../shared/locationUtils';
import {
  normalizeRecurrenceRule,
  parseRruleToRecurrenceRule,
  stripVirtualOccurrences,
} from '../shared/recurrenceUtils';
import {
  detectBrowserTimeZone,
  formatClockInTimeZone,
  inferTimeZoneFromLocation,
  isValidTimeZone,
} from '../shared/timeZoneUtils';
import { PROJECT_STATUS_MAP } from '../constants/projects';

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

function unfoldIcsLines(icsText: string): string[] {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
  return unfolded
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

interface ParsedIcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseIcsPropertyLine(line: string): ParsedIcsProperty | null {
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
      const pKey = seg.slice(0, eqIdx).trim().toUpperCase();
      const pVal = seg
        .slice(eqIdx + 1)
        .trim()
        .replace(/^"|"$/g, '');
      params[pKey] = pVal;
    }
  }

  return { name, params, value };
}

function parseIcsDateTimeValue(
  rawValue: string,
  params: Record<string, string>,
  viewerTimeZone: string
): {
  date: string;
  time?: string;
  isAllDay: boolean;
  timeZone?: string;
} | null {
  const val = rawValue.trim();
  const isValueDate = params.VALUE?.toUpperCase() === 'DATE' || /^\d{8}$/.test(val);

  if (isValueDate) {
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

  const rawTzid = params.TZID?.trim();
  const validTzid = rawTzid && isValidTimeZone(rawTzid) ? rawTzid : undefined;

  if (isUtc) {
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    const targetZone = validTzid || viewerTimeZone;
    const formatted = formatClockInTimeZone(utcDate, targetZone);
    const localDate = formatted.dateShort.replace(/\./g, '-');
    return {
      date: localDate,
      time: formatted.time24,
      isAllDay: false,
      timeZone: validTzid,
    };
  }

  const dateStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    day
  ).padStart(2, '0')}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  return {
    date: dateStr,
    time: timeStr,
    isAllDay: false,
    timeZone: validTzid,
  };
}

function inferCategoryFromIcs(rawCat?: string, summary?: string): CalendarCategory {
  if (rawCat) {
    const first = rawCat.split(',')[0]?.trim();
    if (first && VALID_CATEGORIES.has(first as CalendarCategory)) {
      return first as CalendarCategory;
    }
    if (/meeting|work|업무|회의/i.test(rawCat)) return '업무';
    if (/travel|visit|출장|방문/i.test(rawCat)) return '방문·출장';
    if (/dinner|lunch|meal|식사|오찬|만찬|모임/i.test(rawCat)) return '식사·모임';
    if (/event|seminar|conference|행사|세미나|포럼|컨퍼런스/i.test(rawCat)) return '행사·세미나';
    if (/personal|개인|휴가/i.test(rawCat)) return '개인';
  }

  const title = summary || '';
  if (/(?:세미나|컨퍼런스|포럼|박람회|전시|개막|리허설|본행사|총회|웨비나)/.test(title)) {
    return '행사·세미나';
  }
  if (/(?:오찬|만찬|식사|회식|점심|저녁|티타임)/.test(title)) {
    return '식사·모임';
  }
  if (/(?:출장|방문|답사|실사|현장\s*점검)/.test(title)) {
    return '방문·출장';
  }
  return '업무';
}

function extractDescriptionAndMetadata(rawDesc: string): {
  cleanContent?: string;
  checklist?: ChecklistItem[];
  extractedCategory?: CalendarCategory;
} {
  if (!rawDesc) return {};
  const lines = rawDesc.split('\n');
  const contentLines: string[] = [];
  const checklist: ChecklistItem[] = [];
  let extractedCategory: CalendarCategory | undefined;
  let inChecklistBlock = false;
  const now = Date.now();

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed === '[체크리스트]') {
      inChecklistBlock = true;
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

    const checkMatch = trimmed.match(/^(?:-\s*)?\[([vVxX ])\]\s+(.+)$/);
    if (checkMatch) {
      checklist.push({
        id: `ics-chk-${now}-${checklist.length}`,
        text: checkMatch[2].trim(),
        done: checkMatch[1].trim().length > 0,
      });
      continue;
    }

    if (inChecklistBlock && trimmed.length === 0) {
      inChecklistBlock = false;
    }

    if (!inChecklistBlock) {
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

export interface IcsImportOptions {
  existingEvents?: CalendarEventItem[];
  defaultProjectId?: string;
  viewerTimeZone?: string;
}

export interface IcsImportResult {
  events: CalendarEventItem[];
  skippedDuplicates: number;
  calendarName?: string;
}

/**
 * RFC 5545 표준 iCalendar (.ics) 텍스트를 파싱하여 CalendarEventItem 배열로 변환
 */
export function parseIcsContent(icsText: string, options: IcsImportOptions = {}): IcsImportResult {
  const safeViewerZone =
    options.viewerTimeZone && isValidTimeZone(options.viewerTimeZone)
      ? options.viewerTimeZone
      : detectBrowserTimeZone();

  const lines = unfoldIcsLines(icsText);
  let calendarName: string | undefined;

  const existingSignatures = new Set<string>();
  for (const existing of options.existingEvents || []) {
    const sig = `${existing.title.trim().toLowerCase()}|${existing.date}|${
      existing.isAllDay ? 'ALLDAY' : existing.startTime
    }`;
    existingSignatures.add(sig);
  }

  const importedEvents: CalendarEventItem[] = [];
  let skippedDuplicates = 0;
  let inEvent = false;
  let currentProps: ParsedIcsProperty[] = [];
  const batchNow = Date.now();

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      inEvent = true;
      currentProps = [];
      continue;
    }

    if (upper === 'END:VEVENT') {
      if (inEvent && currentProps.length > 0) {
        const getFirst = (propName: string) =>
          currentProps.find((p) => p.name === propName);
        const getAll = (propName: string) =>
          currentProps.filter((p) => p.name === propName);

        const dtStartProp = getFirst('DTSTART');
        const dtEndProp = getFirst('DTEND');
        const summaryProp = getFirst('SUMMARY');

        if (dtStartProp) {
          const parsedStart = parseIcsDateTimeValue(
            dtStartProp.value,
            dtStartProp.params,
            safeViewerZone
          );

          if (parsedStart) {
            const parsedEnd = dtEndProp
              ? parseIcsDateTimeValue(dtEndProp.value, dtEndProp.params, safeViewerZone)
              : null;

            const isAllDay = parsedStart.isAllDay;
            let endDate: string | undefined;
            let startTime = parsedStart.time || '09:00';
            let endTime = parsedEnd?.time || '10:00';

            if (isAllDay) {
              startTime = '09:00';
              endTime = '18:00';
              if (parsedEnd?.date) {
                // RFC 5545 VALUE=DATE DTEND는 배타적(다음날)이므로 하루 차감
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

            const title = summaryProp ? unescapeIcsText(summaryProp.value) || '일정' : '일정';
            const descProp = getFirst('DESCRIPTION');
            const rawDesc = descProp ? unescapeIcsText(descProp.value) : '';
            const { cleanContent, checklist, extractedCategory } =
              extractDescriptionAndMetadata(rawDesc);

            const locProp = getFirst('LOCATION');
            const rawLoc = locProp ? unescapeIcsText(locProp.value) : undefined;
            const { location, locationAddress } = normalizePlaceAndAddress(rawLoc, undefined);

            let locationLat: number | undefined;
            let locationLng: number | undefined;
            const geoProp = getFirst('GEO');
            if (geoProp) {
              const [latPart, lngPart] = geoProp.value.split(';');
              const normGeo = normalizeCoordinates(latPart, lngPart);
              locationLat = normGeo.locationLat;
              locationLng = normGeo.locationLng;
            }

            const catProp = getFirst('CATEGORIES');
            const rawCategories = catProp ? unescapeIcsText(catProp.value) : undefined;
            const category =
              extractedCategory || inferCategoryFromIcs(rawCategories, title);

            const rruleProp = getFirst('RRULE');
            const recurrence = rruleProp
              ? parseRruleToRecurrenceRule(rruleProp.value)
              : undefined;

            const excludedDates: string[] = [];
            for (const exProp of getAll('EXDATE')) {
              for (const token of exProp.value.split(',')) {
                const parsedEx = parseIcsDateTimeValue(token, exProp.params, safeViewerZone);
                if (parsedEx?.date && !excludedDates.includes(parsedEx.date)) {
                  excludedDates.push(parsedEx.date);
                }
              }
            }

            const resolvedTz =
              !isAllDay
                ? parsedStart.timeZone ||
                  inferTimeZoneFromLocation(location) ||
                  inferTimeZoneFromLocation(locationAddress) ||
                  undefined
                : undefined;

            const signature = `${title.trim().toLowerCase()}|${parsedStart.date}|${
              isAllDay ? 'ALLDAY' : startTime
            }`;

            if (existingSignatures.has(signature)) {
              skippedDuplicates += 1;
            } else {
              existingSignatures.add(signature);
              importedEvents.push({
                id: `ics-evt-${batchNow}-${importedEvents.length}`,
                title,
                date: parsedStart.date,
                endDate,
                startTime,
                endTime,
                timeZone: resolvedTz,
                isAllDay,
                category,
                projectId: options.defaultProjectId,
                location,
                locationAddress,
                locationLat,
                locationLng,
                content: cleanContent,
                isCompleted: false,
                checklist,
                recurrence,
                excludedDates: excludedDates.length > 0 ? excludedDates : undefined,
              });
            }
          }
        }
      }
      inEvent = false;
      currentProps = [];
      continue;
    }

    if (inEvent) {
      const prop = parseIcsPropertyLine(line);
      if (prop) {
        currentProps.push(prop);
      }
    } else {
      const topProp = parseIcsPropertyLine(line);
      if (topProp && topProp.name === 'X-WR-CALNAME') {
        calendarName = unescapeIcsText(topProp.value) || undefined;
      }
    }
  }

  return {
    events: importedEvents,
    skippedDuplicates,
    calendarName,
  };
}

export interface WorkspaceBackupPayload {
  format: 'vibe-calendar-workspace-v1';
  exportedAt: string;
  projects: ProjectItem[];
  events: CalendarEventItem[];
}

export function createWorkspaceBackupJson(
  events: CalendarEventItem[],
  projects: ProjectItem[]
): string {
  const payload: WorkspaceBackupPayload = {
    format: 'vibe-calendar-workspace-v1',
    exportedAt: new Date().toISOString(),
    projects,
    events: stripVirtualOccurrences(events),
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadWorkspaceBackupFile(
  events: CalendarEventItem[],
  projects: ProjectItem[]
): void {
  const jsonContent = createWorkspaceBackupJson(events, projects);
  const todayStr = getTodayDateString();
  const filename = `vibe-workspace-backup-${todayStr}.json`;
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function parseWorkspaceBackupJson(jsonText: string): {
  projects: ProjectItem[];
  events: CalendarEventItem[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error('유효한 JSON 백업 파일 형식이 아닙니다.');
  }

  const rawProjects: unknown[] =
    Array.isArray((raw as Record<string, unknown>)?.projects)
      ? ((raw as Record<string, unknown>).projects as unknown[])
      : [];

  const rawEvents: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.events)
    ? ((raw as Record<string, unknown>).events as unknown[])
    : [];

  if (rawProjects.length === 0 && rawEvents.length === 0) {
    throw new Error('백업 파일에서 복원할 일정 또는 프로젝트 데이터를 찾지 못했습니다.');
  }

  const projects: ProjectItem[] = rawProjects
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .filter(
      (p) =>
        typeof p.id === 'string' &&
        p.id.trim().length > 0 &&
        typeof p.name === 'string' &&
        p.name.trim().length > 0
    )
    .map((p) => ({
      id: String(p.id).trim(),
      name: String(p.name).trim(),
      code: typeof p.code === 'string' && p.code.trim() ? p.code.trim() : undefined,
      description:
        typeof p.description === 'string' && p.description.trim()
          ? p.description.trim()
          : undefined,
      color:
        typeof p.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(p.color.trim())
          ? p.color.trim()
          : '#60a5fa',
      status:
        typeof p.status === 'string' && p.status in PROJECT_STATUS_MAP
          ? (p.status as ProjectItem['status'])
          : 'active',
      startDate:
        typeof p.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.startDate)
          ? p.startDate
          : undefined,
      endDate:
        typeof p.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.endDate)
          ? p.endDate
          : undefined,
      clientOrOrg:
        typeof p.clientOrOrg === 'string' && p.clientOrOrg.trim()
          ? p.clientOrOrg.trim()
          : undefined,
      createdAt:
        typeof p.createdAt === 'string' && p.createdAt
          ? p.createdAt
          : new Date().toISOString(),
    }));

  const events: CalendarEventItem[] = rawEvents
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .filter(
      (e) =>
        typeof e.id === 'string' &&
        e.id.trim().length > 0 &&
        !String(e.id).includes('__occ__') &&
        typeof e.title === 'string' &&
        e.title.trim().length > 0 &&
        typeof e.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.date)
    )
    .map((e) => {
      const date = String(e.date);
      const endDate =
        typeof e.endDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.endDate) &&
        e.endDate > date
          ? e.endDate
          : undefined;

      const { location, locationAddress } = normalizePlaceAndAddress(
        typeof e.location === 'string' ? e.location : undefined,
        typeof e.locationAddress === 'string' ? e.locationAddress : undefined
      );
      const { locationLat, locationLng } = normalizeCoordinates(e.locationLat, e.locationLng);
      const cat =
        typeof e.category === 'string' && VALID_CATEGORIES.has(e.category as CalendarCategory)
          ? (e.category as CalendarCategory)
          : '업무';

      const checklist = Array.isArray(e.checklist)
        ? e.checklist
            .filter(
              (c): c is Record<string, unknown> =>
                Boolean(c && typeof c === 'object' && typeof c.text === 'string' && c.text.trim())
            )
            .map((c, idx) => ({
              id: typeof c.id === 'string' && c.id ? c.id : `bchk-${Date.now()}-${idx}`,
              text: String(c.text).trim(),
              done: Boolean(c.done),
            }))
        : undefined;

      const excludedDates = Array.isArray(e.excludedDates)
        ? e.excludedDates.filter(
            (d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
          )
        : undefined;

      const completedDates = Array.isArray(e.completedDates)
        ? e.completedDates.filter(
            (d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
          )
        : undefined;

      return {
        id: String(e.id).trim(),
        title: String(e.title).trim(),
        date,
        endDate,
        startTime:
          typeof e.startTime === 'string' && /^\d{2}:\d{2}$/.test(e.startTime)
            ? e.startTime
            : '10:00',
        endTime:
          typeof e.endTime === 'string' && /^\d{2}:\d{2}$/.test(e.endTime)
            ? e.endTime
            : '11:00',
        timeZone:
          typeof e.timeZone === 'string' && isValidTimeZone(e.timeZone) ? e.timeZone : undefined,
        isAllDay: Boolean(e.isAllDay),
        category: cat,
        projectId: typeof e.projectId === 'string' && e.projectId ? e.projectId : undefined,
        location,
        locationAddress,
        locationLat,
        locationLng,
        content: typeof e.content === 'string' && e.content.trim() ? e.content.trim() : undefined,
        isCompleted: Boolean(e.isCompleted),
        checklist: checklist && checklist.length > 0 ? checklist : undefined,
        recurrence: normalizeRecurrenceRule(e.recurrence),
        excludedDates: excludedDates && excludedDates.length > 0 ? excludedDates : undefined,
        completedDates: completedDates && completedDates.length > 0 ? completedDates : undefined,
      };
    });

  return { projects, events };
}
