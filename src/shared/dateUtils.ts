export interface CalendarDayCell {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export interface WeekDayItem {
  date: string;
  dayNumber: number;
  dayOfWeek: string;
  dayOfWeekFull: string;
  isToday: boolean;
  isCurrentMonth: boolean;
  monthNumber: number;
}

const WEEKDAYS_SHORT = ['일', '월', '화', '수', '목', '금', '토'] as const;
const WEEKDAYS_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;

/**
 * 로컬 타임존 기준으로 Date 객체를 YYYY-MM-DD 문자열로 포맷
 */
export function formatDateString(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 로컬 타임존 기준 오늘 날짜 문자열(YYYY-MM-DD) 반환
 */
export function getTodayDateString(): string {
  return formatDateString(new Date());
}

/**
 * YYYY-MM-DD 문자열을 UTC 자정 오차 없이 로컬 타임존 Date 객체로 안전 파싱
 */
export function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split('-').map(Number);
  if (parts.length === 3 && !parts.some(Number.isNaN)) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date();
}

/**
 * 날짜 더하기 / 빼기 (YYYY-MM-DD 반환)
 */
export function addDays(dateStr: string, days: number): string {
  const dt = parseLocalDate(dateStr);
  dt.setDate(dt.getDate() + days);
  return formatDateString(dt);
}

/**
 * YYYY-MM-DD에 해당하는 한국어 요일 약어('일'~'토') 반환
 */
export function getDayOfWeekShort(dateStr: string): string {
  const dt = parseLocalDate(dateStr);
  return WEEKDAYS_SHORT[dt.getDay()] || '';
}

/**
 * YYYY-MM-DD를 "2026-10-22 (목)" 또는 "2026-10-22 (목요일)"로 포맷
 */
export function formatKoreanDateWithDay(dateStr: string, fullDay = false): string {
  const dt = parseLocalDate(dateStr);
  const label = fullDay ? WEEKDAYS_FULL[dt.getDay()] : WEEKDAYS_SHORT[dt.getDay()];
  return `${dateStr} (${label})`;
}

/**
 * 자연어 텍스트에서 날짜(YYYY-MM-DD) 추출 (프론트/백엔드 공용)
 */
export function parseNaturalDateFromText(text: string, currentYear = 2026): string | null {
  if (!text) return null;

  const fullMatch = text.match(/(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})(?:일)?/);
  if (fullMatch) {
    const y = parseInt(fullMatch[1], 10);
    const m = parseInt(fullMatch[2], 10);
    const d = parseInt(fullMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const monthDayMatch = text.match(/(\d{1,2})월\s*(\d{1,2})(?:\s*일)?(?![명인개시분초\w])/);
  if (monthDayMatch) {
    const m = parseInt(monthDayMatch[1], 10);
    const d = parseInt(monthDayMatch[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const slashMatch = text.match(/(?:\b|\s)(\d{1,2})[/.]([0-3]?\d)(?![명인개시분초\w])/);
  if (slashMatch) {
    const m = parseInt(slashMatch[1], 10);
    const d = parseInt(slashMatch[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${currentYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * 특정 연도와 월(0-11)의 캘린더 날짜 셀 그리드 생성
 */
export function getCalendarGrid(year: number, month: number): CalendarDayCell[] {
  const firstDay = new Date(year, month, 1);
  const startDayOfWeek = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const grid: CalendarDayCell[] = [];
  const todayStr = getTodayDateString();

  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    grid.push({
      date: dateStr,
      dayNumber: day,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    grid.push({
      date: dateStr,
      dayNumber: d,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
    });
  }

  const remaining = (7 - (grid.length % 7)) % 7;
  for (let nextDay = 1; nextDay <= remaining; nextDay++) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
    grid.push({
      date: dateStr,
      dayNumber: nextDay,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
    });
  }

  return grid;
}

/**
 * 특정 기준일(YYYY-MM-DD)이 속한 주의 일요일~토요일 7일 배열 반환
 */
export function getWeekDays(dateStr: string): WeekDayItem[] {
  const target = parseLocalDate(dateStr);
  const targetMonth = target.getMonth() + 1;
  const sunday = new Date(target);
  sunday.setDate(target.getDate() - target.getDay());

  const todayStr = getTodayDateString();
  const week: WeekDayItem[] = [];

  for (let i = 0; i < 7; i++) {
    const cur = new Date(sunday);
    cur.setDate(sunday.getDate() + i);
    const curM = cur.getMonth() + 1;
    const curD = cur.getDate();
    const curStr = formatDateString(cur);

    week.push({
      date: curStr,
      dayNumber: curD,
      dayOfWeek: WEEKDAYS_SHORT[i],
      dayOfWeekFull: WEEKDAYS_FULL[i],
      isToday: curStr === todayStr,
      isCurrentMonth: curM === targetMonth,
      monthNumber: curM,
    });
  }

  return week;
}

/**
 * 주간 표시 텍스트 생성 (예: "10월 18일 ~ 10월 24일")
 */
export function getWeekRangeLabel(dateStr: string): string {
  const week = getWeekDays(dateStr);
  const start = week[0];
  const end = week[6];
  return `${start.monthNumber}월 ${start.dayNumber}일 ~ ${end.monthNumber}월 ${end.dayNumber}일`;
}
