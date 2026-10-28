import { CalendarEventItem } from '../types';
import { addDays } from '../shared/dateUtils';
import { detectBrowserTimeZone, isValidTimeZone } from '../shared/timeZoneUtils';
import { formatCombinedLocation, hasValidCoordinates } from '../shared/locationUtils';

function formatIcsDateTime(dateStr: string, timeStr?: string, isAllDay = false): string {
  const [y, m, d] = dateStr.split('-');
  if (isAllDay || !timeStr) {
    return `${y}${m}${d}`;
  }
  const [hh, mm] = timeStr.split(':');
  return `${y}${m}${d}T${hh || '09'}${mm || '00'}00`;
}

function escapeIcsText(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * 일정 배열을 RFC 5545 표준 iCalendar (.ics) 문자열로 직렬화
 */
export function generateIcsContent(
  events: CalendarEventItem[],
  calName = '바이브 행사 캘린더'
): string {
  const now = new Date();
  const dtStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vibe Smart Calendar//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    `X-WR-TIMEZONE:${detectBrowserTimeZone()}`,
  ];

  for (const ev of events) {
    const isAllDay = ev.isAllDay || (!ev.startTime && !ev.endTime);
    const startStr = formatIcsDateTime(ev.date, ev.startTime, isAllDay);

    let endStr: string;
    if (isAllDay) {
      const nextDateStr = addDays(ev.endDate || ev.date, 1);
      endStr = formatIcsDateTime(nextDateStr, undefined, true);
    } else {
      endStr = formatIcsDateTime(ev.endDate || ev.date, ev.endTime || '10:00', false);
    }

    let description = ev.content || '';
    if (ev.checklist && ev.checklist.length > 0) {
      const checkText = ev.checklist
        .map((c) => `[${c.done ? 'v' : ' '}] ${c.text}`)
        .join('\n');
      description += `\n\n[체크리스트]\n${checkText}`;
    }
    if (ev.category) {
      description += `\n[분류: ${ev.category}]`;
    }

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@vibe-calendar.local`);
    lines.push(`DTSTAMP:${dtStamp}`);
    if (isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${startStr}`);
      lines.push(`DTEND;VALUE=DATE:${endStr}`);
    } else if (ev.timeZone && isValidTimeZone(ev.timeZone)) {
      lines.push(`DTSTART;TZID=${ev.timeZone}:${startStr}`);
      lines.push(`DTEND;TZID=${ev.timeZone}:${endStr}`);
    } else {
      lines.push(`DTSTART:${startStr}`);
      lines.push(`DTEND:${endStr}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(ev.title)}`);
    if (description.trim()) {
      lines.push(`DESCRIPTION:${escapeIcsText(description.trim())}`);
    }
    const combinedLocation = formatCombinedLocation(ev.location, ev.locationAddress, ', ');
    if (combinedLocation) {
      lines.push(`LOCATION:${escapeIcsText(combinedLocation)}`);
    }
    if (hasValidCoordinates(ev.locationLat, ev.locationLng)) {
      lines.push(`GEO:${ev.locationLat!.toFixed(6)};${ev.locationLng!.toFixed(6)}`);
    }
    if (ev.category) {
      lines.push(`CATEGORIES:${escapeIcsText(ev.category)}`);
    }
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * 브라우저에서 .ics 파일 다운로드 실행
 */
export function downloadIcsFile(filename: string, icsContent: string): void {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '_').trim() || 'calendar';
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', safeName.endsWith('.ics') ? safeName : `${safeName}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
