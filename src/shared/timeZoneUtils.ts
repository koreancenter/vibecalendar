import { CalendarEventItem } from '../types';
import { addDays } from './dateUtils';
import { minutesToTime, timeToMinutes } from './scheduleUtils';

export type TimeZoneFocusMode = 'home' | 'event';

export interface TimeZoneOption {
  iana: string;
  cityKo: string;
  cityEn: string;
  countryKo: string;
  shortCode: string;
}

export interface FormattedZoneClock {
  time24: string; // HH:mm
  dateShort: string; // YYYY.MM.DD
  weekdayKo: string; // 일 ~ 토
  utcOffsetLabel: string; // UTC+9, UTC-7, UTC+5:30
  offsetMinutes: number;
  hour24: number;
  minute: number;
}

/**
 * 글로벌 주요 비즈니스 및 MICE 행사 도시 표준 시간대 목록
 */
export const GLOBAL_EVENT_TIMEZONES: TimeZoneOption[] = [
  {
    iana: 'Asia/Seoul',
    cityKo: '서울',
    cityEn: 'Seoul',
    countryKo: '대한민국',
    shortCode: 'KST',
  },
  {
    iana: 'Asia/Jakarta',
    cityKo: '자카르타',
    cityEn: 'Jakarta',
    countryKo: '인도네시아',
    shortCode: 'WIB',
  },
  {
    iana: 'Asia/Makassar',
    cityKo: '발리',
    cityEn: 'Bali',
    countryKo: '인도네시아',
    shortCode: 'WITA',
  },
  {
    iana: 'Asia/Singapore',
    cityKo: '싱가포르',
    cityEn: 'Singapore',
    countryKo: '싱가포르',
    shortCode: 'SGT',
  },
  {
    iana: 'Asia/Tokyo',
    cityKo: '도쿄',
    cityEn: 'Tokyo',
    countryKo: '일본',
    shortCode: 'JST',
  },
  {
    iana: 'Asia/Bangkok',
    cityKo: '방콕',
    cityEn: 'Bangkok',
    countryKo: '태국',
    shortCode: 'ICT',
  },
  {
    iana: 'Asia/Ho_Chi_Minh',
    cityKo: '호치민',
    cityEn: 'Ho Chi Minh',
    countryKo: '베트남',
    shortCode: 'ICT',
  },
  {
    iana: 'Asia/Hong_Kong',
    cityKo: '홍콩',
    cityEn: 'Hong Kong',
    countryKo: '홍콩',
    shortCode: 'HKT',
  },
  {
    iana: 'Asia/Shanghai',
    cityKo: '상하이',
    cityEn: 'Shanghai',
    countryKo: '중국',
    shortCode: 'CST',
  },
  {
    iana: 'Asia/Taipei',
    cityKo: '타이베이',
    cityEn: 'Taipei',
    countryKo: '대만',
    shortCode: 'CST',
  },
  {
    iana: 'Asia/Dubai',
    cityKo: '두바이',
    cityEn: 'Dubai',
    countryKo: 'UAE',
    shortCode: 'GST',
  },
  {
    iana: 'Europe/London',
    cityKo: '런던',
    cityEn: 'London',
    countryKo: '영국',
    shortCode: 'GMT',
  },
  {
    iana: 'Europe/Paris',
    cityKo: '파리',
    cityEn: 'Paris',
    countryKo: '프랑스',
    shortCode: 'CET',
  },
  {
    iana: 'Europe/Berlin',
    cityKo: '프랑크푸르트',
    cityEn: 'Frankfurt',
    countryKo: '독일',
    shortCode: 'CET',
  },
  {
    iana: 'Europe/Zurich',
    cityKo: '제네바',
    cityEn: 'Geneva',
    countryKo: '스위스',
    shortCode: 'CET',
  },
  {
    iana: 'America/New_York',
    cityKo: '뉴욕',
    cityEn: 'New York',
    countryKo: '미국 동부',
    shortCode: 'ET',
  },
  {
    iana: 'America/Chicago',
    cityKo: '시카고',
    cityEn: 'Chicago',
    countryKo: '미국 중부',
    shortCode: 'CT',
  },
  {
    iana: 'America/Los_Angeles',
    cityKo: '로스앤젤레스',
    cityEn: 'Los Angeles',
    countryKo: '미국 서부',
    shortCode: 'PT',
  },
  {
    iana: 'Pacific/Honolulu',
    cityKo: '호놀룰루',
    cityEn: 'Honolulu',
    countryKo: '하와이',
    shortCode: 'HST',
  },
  {
    iana: 'Australia/Sydney',
    cityKo: '시드니',
    cityEn: 'Sydney',
    countryKo: '호주',
    shortCode: 'AEST',
  },
  {
    iana: 'UTC',
    cityKo: '협정세계시',
    cityEn: 'UTC',
    countryKo: '글로벌 표준',
    shortCode: 'UTC',
  },
];

const WEEKDAY_EN_TO_KO: Record<string, string> = {
  Sun: '일',
  Mon: '월',
  Tue: '화',
  Wed: '수',
  Thu: '목',
  Fri: '금',
  Sat: '토',
};

export function isValidTimeZone(iana: string): boolean {
  if (!iana) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: iana });
    return true;
  } catch {
    return false;
  }
}

export function detectBrowserTimeZone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved && isValidTimeZone(resolved)) {
      return resolved;
    }
  } catch {
    // ignore
  }
  return 'Asia/Seoul';
}

export function getDefaultSecondaryTimeZone(homeIana: string): string {
  if (homeIana === 'Asia/Seoul') {
    return 'Asia/Jakarta';
  }
  return 'Asia/Seoul';
}

export function getTimeZoneMeta(iana: string): TimeZoneOption {
  const matched = GLOBAL_EVENT_TIMEZONES.find((tz) => tz.iana === iana);
  if (matched) return matched;

  const segments = (iana || 'UTC').split('/');
  const rawCity = (segments[segments.length - 1] || iana).replace(/_/g, ' ');
  const region = segments.length > 1 ? segments[0] : 'Global';

  return {
    iana: isValidTimeZone(iana) ? iana : 'Asia/Seoul',
    cityKo: rawCity,
    cityEn: rawCity,
    countryKo: region,
    shortCode: rawCity.slice(0, 3).toUpperCase(),
  };
}

/**
 * 특정 기준 시각(Date)에서 IANA 타임존의 UTC 대비 분 단위 오프셋(예: KST = +540, PDT = -420) 계산
 */
export function getTimeZoneOffsetMinutes(iana: string, refDate: Date = new Date()): number {
  const safeZone = isValidTimeZone(iana) ? iana : 'Asia/Seoul';
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = dtf.formatToParts(refDate);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = parseInt(p.value, 10);
    }
  }

  const hourVal = map.hour === 24 ? 0 : map.hour || 0;
  const asUtcMs = Date.UTC(
    map.year || refDate.getUTCFullYear(),
    (map.month || 1) - 1,
    map.day || 1,
    hourVal,
    map.minute || 0,
    map.second || 0
  );

  const refSecondsFloored = Math.floor(refDate.getTime() / 1000) * 1000;
  return Math.round((asUtcMs - refSecondsFloored) / 60000);
}

export function formatUtcOffsetLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'UTC±0';
  const sign = offsetMinutes > 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (mins === 0) {
    return `UTC${sign}${hours}`;
  }
  return `UTC${sign}${hours}:${String(mins).padStart(2, '0')}`;
}

export function formatClockInTimeZone(
  date: Date,
  iana: string
): FormattedZoneClock {
  const safeZone = isValidTimeZone(iana) ? iana : 'Asia/Seoul';
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = dtf.formatToParts(date);
  let year = '2026';
  let month = '01';
  let day = '01';
  let hour = '00';
  let minute = '00';
  let weekdayEn = 'Mon';

  for (const p of parts) {
    if (p.type === 'year') year = p.value;
    else if (p.type === 'month') month = p.value;
    else if (p.type === 'day') day = p.value;
    else if (p.type === 'hour') hour = p.value === '24' ? '00' : p.value;
    else if (p.type === 'minute') minute = p.value;
    else if (p.type === 'weekday') weekdayEn = p.value;
  }

  const offsetMinutes = getTimeZoneOffsetMinutes(safeZone, date);

  return {
    time24: `${hour}:${minute}`,
    dateShort: `${year}.${month}.${day}`,
    weekdayKo: WEEKDAY_EN_TO_KO[weekdayEn] || '',
    utcOffsetLabel: formatUtcOffsetLabel(offsetMinutes),
    offsetMinutes,
    hour24: parseInt(hour, 10) || 0,
    minute: parseInt(minute, 10) || 0,
  };
}

export function formatHourDiffShort(
  fromIana: string,
  toIana: string,
  refDate: Date = new Date()
): string {
  const diffMins =
    getTimeZoneOffsetMinutes(toIana, refDate) -
    getTimeZoneOffsetMinutes(fromIana, refDate);
  if (diffMins === 0) return '±0h';
  const sign = diffMins > 0 ? '+' : '-';
  const abs = Math.abs(diffMins);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (mins === 0) return `${sign}${hours}h`;
  return `${sign}${hours}:${String(mins).padStart(2, '0')}`;
}

export function formatHourDiffVerbose(
  fromIana: string,
  toIana: string,
  refDate: Date = new Date()
): string {
  const diffMins =
    getTimeZoneOffsetMinutes(toIana, refDate) -
    getTimeZoneOffsetMinutes(fromIana, refDate);
  if (diffMins === 0) return '동일 시간대';
  const sign = diffMins > 0 ? '+' : '-';
  const abs = Math.abs(diffMins);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (mins === 0) return `시차 ${sign}${hours}시간`;
  return `시차 ${sign}${hours}시간 ${mins}분`;
}

/**
 * 일정 시작·종료 시각(홈 시간 기준)을 대상 행사지 시간대로 변환
 */
export function convertEventTimeBetweenZones(
  dateStr: string,
  startTime: string,
  endTime: string,
  fromIana: string,
  toIana: string
): {
  startTime: string;
  endTime: string;
  dayShiftLabel: string;
} {
  const [y, m, d] = dateStr.split('-').map(Number);
  const refUtc = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1, 12, 0, 0));
  const diffMins =
    getTimeZoneOffsetMinutes(toIana, refUtc) -
    getTimeZoneOffsetMinutes(fromIana, refUtc);

  const rawStart = timeToMinutes(startTime) + diffMins;
  const rawEnd = timeToMinutes(endTime) + diffMins;

  const dayShift = Math.floor(rawStart / 1440);
  const wrappedStart = ((rawStart % 1440) + 1440) % 1440;
  const wrappedEnd = ((rawEnd % 1440) + 1440) % 1440;

  const dayShiftLabel =
    dayShift > 0 ? `+${dayShift}일` : dayShift < 0 ? `${dayShift}일` : '';

  return {
    startTime: minutesToTime(wrappedStart),
    endTime: minutesToTime(wrappedEnd),
    dayShiftLabel,
  };
}

const LOCATION_TIMEZONE_PATTERNS: Array<{ pattern: RegExp; iana: string }> = [
  {
    pattern: /발리|덴파사르|누사두아|우붓|bali|denpasar|nusa\s*dua/i,
    iana: 'Asia/Makassar',
  },
  {
    pattern: /자카르타|인도네시아|수라바야|반둥|jakarta|indonesia|surabaya|bandung/i,
    iana: 'Asia/Jakarta',
  },
  {
    pattern: /싱가포르|마리나\s*베이|센토사|singapore|marina\s*bay/i,
    iana: 'Asia/Singapore',
  },
  {
    pattern: /도쿄|동경|오사카|교토|후쿠오카|요코하마|삿포로|나고야|일본|tokyo|osaka|kyoto|fukuoka|yokohama|japan/i,
    iana: 'Asia/Tokyo',
  },
  {
    pattern: /방콕|푸켓|치앙마이|태국|bangkok|phuket|chiang\s*mai|thailand/i,
    iana: 'Asia/Bangkok',
  },
  {
    pattern: /호치민|하노이|다낭|베트남|ho\s*chi\s*minh|saigon|hanoi|danang|vietnam/i,
    iana: 'Asia/Ho_Chi_Minh',
  },
  {
    pattern: /홍콩|구룡|코즈웨이|hong\s*kong|kowloon/i,
    iana: 'Asia/Hong_Kong',
  },
  {
    pattern: /상하이|상해|베이징|북경|선전|광저우|중국|shanghai|beijing|shenzhen|guangzhou|china/i,
    iana: 'Asia/Shanghai',
  },
  {
    pattern: /타이베이|타이페이|가오슝|대만|taipei|kaohsiung|taiwan/i,
    iana: 'Asia/Taipei',
  },
  {
    pattern: /두바이|아부다비|dubai|abu\s*dhabi|uae/i,
    iana: 'Asia/Dubai',
  },
  {
    pattern: /런던|맨체스터|에든버러|영국|london|manchester|edinburgh|\buk\b/i,
    iana: 'Europe/London',
  },
  {
    pattern: /파리|니스|칸|리옹|프랑스|paris|nice|cannes|lyon|france/i,
    iana: 'Europe/Paris',
  },
  {
    pattern: /프랑크푸르트|베를린|뮌헨|하노버|뒤셀도르프|독일|frankfurt|berlin|munich|hannover|germany/i,
    iana: 'Europe/Berlin',
  },
  {
    pattern: /제네바|취리히|다보스|바젤|스위스|geneva|zurich|davos|basel|switzerland/i,
    iana: 'Europe/Zurich',
  },
  {
    pattern: /뉴욕|맨해튼|보스턴|워싱턴|마이애미|애틀랜타|올랜도|new\s*york|\bnyc\b|manhattan|boston|washington|miami|atlanta/i,
    iana: 'America/New_York',
  },
  {
    pattern: /시카고|댈러스|휴스턴|오스틴|텍사스|chicago|dallas|houston|austin|texas/i,
    iana: 'America/Chicago',
  },
  {
    pattern: /로스앤젤레스|샌프란시스코|라스베이거스|시애틀|산호세|애너하임|실리콘밸리|캘리포니아|los\s*angeles|\bsfo\b|san\s*francisco|las\s*vegas|seattle|san\s*jose|silicon\s*valley/i,
    iana: 'America/Los_Angeles',
  },
  {
    pattern: /호놀룰루|하와이|와이키키|honolulu|hawaii|waikiki/i,
    iana: 'Pacific/Honolulu',
  },
  {
    pattern: /시드니|멜버른|브리즈번|호주|sydney|melbourne|brisbane|australia/i,
    iana: 'Australia/Sydney',
  },
  {
    pattern: /서울|의정부|판교|분당|성남|용산|성동|강남|여의도|광화문|종로|잠실|코엑스|킨텍스|벡스코|송도|인천|부산|제주|대전|대구|광주|수원|세종|대한민국|한국|seoul|incheon|busan|jeju|pangyo|coex|kintex|korea/i,
    iana: 'Asia/Seoul',
  },
];

/**
 * 일정의 장소명이나 제목 텍스트에서 행사지 표준 시간대(IANA)를 추론
 */
export function inferTimeZoneFromLocation(text?: string | null): string | null {
  if (!text || !text.trim()) return null;
  for (const rule of LOCATION_TIMEZONE_PATTERNS) {
    if (rule.pattern.test(text)) {
      return rule.iana;
    }
  }
  return null;
}

const EXPLICIT_TIMEZONE_PHRASE_PATTERNS: Array<{ pattern: RegExp; iana: string }> = [
  { pattern: /(?:한국|서울|국내)\s*(?:시간|시각|기준)|\bKST\b/i, iana: 'Asia/Seoul' },
  {
    pattern: /(?:자카르타|인니|인도네시아(?:\s*서부)?)\s*(?:시간|시각|기준)|\bWIB\b/i,
    iana: 'Asia/Jakarta',
  },
  {
    pattern: /(?:발리|인도네시아\s*중부)\s*(?:시간|시각|기준)|\bWITA\b/i,
    iana: 'Asia/Makassar',
  },
  { pattern: /싱가포르\s*(?:시간|시각|기준)|\bSGT\b/i, iana: 'Asia/Singapore' },
  { pattern: /(?:일본|도쿄|동경)\s*(?:시간|시각|기준)|\bJST\b/i, iana: 'Asia/Tokyo' },
  { pattern: /(?:방콕|태국)\s*(?:시간|시각|기준)/i, iana: 'Asia/Bangkok' },
  {
    pattern: /(?:베트남|호치민|하노이|다낭)\s*(?:시간|시각|기준)/i,
    iana: 'Asia/Ho_Chi_Minh',
  },
  { pattern: /홍콩\s*(?:시간|시각|기준)|\bHKT\b/i, iana: 'Asia/Hong_Kong' },
  { pattern: /(?:중국|상하이|상해|베이징|북경)\s*(?:시간|시각|기준)/i, iana: 'Asia/Shanghai' },
  { pattern: /(?:대만|타이베이|타이페이)\s*(?:시간|시각|기준)/i, iana: 'Asia/Taipei' },
  { pattern: /(?:두바이|아부다비|UAE)\s*(?:시간|시각|기준)|\bGST\b/i, iana: 'Asia/Dubai' },
  { pattern: /(?:런던|영국)\s*(?:시간|시각|기준)|\b(?:GMT|BST)\b/i, iana: 'Europe/London' },
  {
    pattern: /(?:파리|프랑스|독일|베를린|프랑크푸르트|유럽(?:\s*중부)?)\s*(?:시간|시각|기준)|\b(?:CET|CEST)\b/i,
    iana: 'Europe/Paris',
  },
  { pattern: /(?:제네바|취리히|스위스)\s*(?:시간|시각|기준)/i, iana: 'Europe/Zurich' },
  {
    pattern: /(?:뉴욕|워싱턴|보스턴|미국\s*동부|미\s*동부|동부)\s*(?:시간|시각|기준)|\b(?:EST|EDT|ET)\b/i,
    iana: 'America/New_York',
  },
  {
    pattern: /(?:시카고|댈러스|텍사스|미국\s*중부|미\s*중부)\s*(?:시간|시각|기준)|\b(?:CDT)\b/i,
    iana: 'America/Chicago',
  },
  {
    pattern: /(?:LA|로스앤젤레스|샌프란시스코|실리콘밸리|미국\s*서부|미\s*서부|태평양)\s*(?:시간|시각|기준)|\b(?:PST|PDT|PT)\b/i,
    iana: 'America/Los_Angeles',
  },
  { pattern: /(?:하와이|호놀룰루)\s*(?:시간|시각|기준)|\bHST\b/i, iana: 'Pacific/Honolulu' },
  { pattern: /(?:시드니|멜버른|호주)\s*(?:시간|시각|기준)|\b(?:AEST|AEDT)\b/i, iana: 'Australia/Sydney' },
  { pattern: /(?:협정세계시|세계표준시)|\bUTC\b/i, iana: 'UTC' },
];

/**
 * 프롬프트나 제목 내 명시적 시간대 표현(예: "한국 시간 10시", "10:00 KST", "자카르타 시간") 추출
 */
export function parseExplicitTimeZoneFromText(text?: string | null): string | null {
  if (!text || !text.trim()) return null;
  for (const rule of EXPLICIT_TIMEZONE_PHRASE_PATTERNS) {
    if (rule.pattern.test(text)) {
      return rule.iana;
    }
  }
  return null;
}

/**
 * 개별 일정의 권위 있는 원천 시간대(IANA) 결정:
 * 1) 일정에 명시된 timeZone -> 2) 제목/장소의 명시적 시간대 코드 -> 3) 장소/제목의 도시 추론 -> 4) 사용자 현재 위치 시간대
 */
export function resolveEventTimeZone(
  event: Pick<CalendarEventItem, 'timeZone' | 'location' | 'locationAddress' | 'title'>,
  viewerTimeZone: string
): string {
  const safeViewer = isValidTimeZone(viewerTimeZone) ? viewerTimeZone : detectBrowserTimeZone();
  if (event.timeZone && isValidTimeZone(event.timeZone)) {
    return event.timeZone;
  }
  const explicit =
    parseExplicitTimeZoneFromText(event.title) ||
    parseExplicitTimeZoneFromText(event.location) ||
    parseExplicitTimeZoneFromText(event.locationAddress);
  if (explicit) return explicit;

  const fromLocation =
    inferTimeZoneFromLocation(event.location) ||
    inferTimeZoneFromLocation(event.locationAddress) ||
    inferTimeZoneFromLocation(event.title);
  if (fromLocation) return fromLocation;

  return safeViewer;
}

export interface ResolvedEventTiming {
  sourceTimeZone: string;
  sourceMeta: TimeZoneOption;
  viewerTimeZone: string;
  viewerMeta: TimeZoneOption;
  isSameZone: boolean;
  hasOffsetDiff: boolean;
  localDate: string;
  localStartTime: string;
  localEndTime: string;
  dayShift: number;
  dayShiftLabel: string;
  compactStartLabel: string;
  rangeLabel: string;
  sourceRangeWithCode: string;
}

/**
 * 일정의 원천 시각을 사용자 현재 위치 시간대(viewerTimeZone)로 투영하고 미니멀 표기 문자열 생성
 * - 동일 시간대: "10:00" / "10:00 ~ 11:00"
 * - 타 도시이나 시차 0h (예: 발리 WITA에서 싱가포르 SGT): "10:00 SGT"
 * - 시차 발생 (예: 발리 WITA에서 한국 10:00 KST): "09:00 · 10:00 KST"
 */
export function projectEventToViewerTimeZone(
  event: CalendarEventItem,
  viewerTimeZone: string
): ResolvedEventTiming {
  const safeViewer = isValidTimeZone(viewerTimeZone) ? viewerTimeZone : detectBrowserTimeZone();
  const sourceTimeZone = resolveEventTimeZone(event, safeViewer);
  const sourceMeta = getTimeZoneMeta(sourceTimeZone);
  const viewerMeta = getTimeZoneMeta(safeViewer);
  const isSameZone = sourceTimeZone === safeViewer;

  if (event.isAllDay) {
    return {
      sourceTimeZone,
      sourceMeta,
      viewerTimeZone: safeViewer,
      viewerMeta,
      isSameZone,
      hasOffsetDiff: false,
      localDate: event.date,
      localStartTime: event.startTime,
      localEndTime: event.endTime,
      dayShift: 0,
      dayShiftLabel: '',
      compactStartLabel: '종일',
      rangeLabel: '종일',
      sourceRangeWithCode: '종일',
    };
  }

  const [y, m, d] = event.date.split('-').map(Number);
  const refUtc = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1, 12, 0, 0));
  const diffMins =
    getTimeZoneOffsetMinutes(safeViewer, refUtc) -
    getTimeZoneOffsetMinutes(sourceTimeZone, refUtc);

  const hasOffsetDiff = diffMins !== 0;
  const origStart = timeToMinutes(event.startTime);
  const origEnd = timeToMinutes(event.endTime);
  const duration = origEnd > origStart ? origEnd - origStart : 60;

  let localDate = event.date;
  let localStartTime = event.startTime;
  let localEndTime = event.endTime;
  let dayShift = 0;

  if (hasOffsetDiff) {
    const shiftedStartTotal = origStart + diffMins;
    dayShift = Math.floor(shiftedStartTotal / 1440);
    if (dayShift !== 0) {
      localDate = addDays(event.date, dayShift);
    }
    const wrappedStart = ((shiftedStartTotal % 1440) + 1440) % 1440;
    const wrappedEnd = ((wrappedStart + duration) % 1440 + 1440) % 1440;
    localStartTime = minutesToTime(wrappedStart);
    localEndTime = minutesToTime(wrappedEnd);
  }

  const dayShiftLabel = dayShift > 0 ? `+${dayShift}일` : dayShift < 0 ? `${dayShift}일` : '';
  const sourceRangeWithCode = `${event.startTime} – ${event.endTime} ${sourceMeta.shortCode}`;

  let compactStartLabel = event.startTime;
  let rangeLabel = `${event.startTime} – ${event.endTime}`;

  if (hasOffsetDiff) {
    compactStartLabel = `${localStartTime} · ${event.startTime} ${sourceMeta.shortCode}`;
    rangeLabel = `${localStartTime} – ${localEndTime} · ${event.startTime} ${sourceMeta.shortCode}`;
  } else if (!isSameZone) {
    compactStartLabel = `${event.startTime} ${sourceMeta.shortCode}`;
    rangeLabel = `${event.startTime} – ${event.endTime} ${sourceMeta.shortCode}`;
  }

  return {
    sourceTimeZone,
    sourceMeta,
    viewerTimeZone: safeViewer,
    viewerMeta,
    isSameZone,
    hasOffsetDiff,
    localDate,
    localStartTime,
    localEndTime,
    dayShift,
    dayShiftLabel,
    compactStartLabel,
    rangeLabel,
    sourceRangeWithCode,
  };
}

/**
 * 충돌 감지·타임라인 배치 계산을 위해 일정의 date/startTime/endTime을 사용자 현지 시간대 기준으로 투영
 */
export function toViewerProjectedEvent(
  event: CalendarEventItem,
  viewerTimeZone: string
): CalendarEventItem {
  if (event.isAllDay) return event;
  const timing = projectEventToViewerTimeZone(event, viewerTimeZone);
  if (!timing.hasOffsetDiff) return event;
  return {
    ...event,
    date: timing.localDate,
    startTime: timing.localStartTime,
    endTime: timing.localEndTime,
  };
}

export function mapEventsToViewerZone(
  events: CalendarEventItem[],
  viewerTimeZone: string
): CalendarEventItem[] {
  return events.map((ev) => toViewerProjectedEvent(ev, viewerTimeZone));
}

/**
 * 사용자 현지 타임그리드에서 드래그·리사이즈된 (localDate, localStartTime, localEndTime)을
 * 일정의 원천 시간대(eventSourceTimeZone) 시각으로 역변환
 */
export function convertLocalSlotToEventZone(
  localDate: string,
  localStartTime: string,
  localEndTime: string,
  viewerTimeZone: string,
  eventSourceTimeZone: string
): {
  date: string;
  startTime: string;
  endTime: string;
} {
  const safeViewer = isValidTimeZone(viewerTimeZone) ? viewerTimeZone : detectBrowserTimeZone();
  const safeSource = isValidTimeZone(eventSourceTimeZone) ? eventSourceTimeZone : safeViewer;
  if (safeViewer === safeSource) {
    return { date: localDate, startTime: localStartTime, endTime: localEndTime };
  }

  const [y, m, d] = localDate.split('-').map(Number);
  const refUtc = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1, 12, 0, 0));
  const diffMins =
    getTimeZoneOffsetMinutes(safeSource, refUtc) -
    getTimeZoneOffsetMinutes(safeViewer, refUtc);

  if (diffMins === 0) {
    return { date: localDate, startTime: localStartTime, endTime: localEndTime };
  }

  const localStartMin = timeToMinutes(localStartTime);
  const localEndMin = timeToMinutes(localEndTime);
  const duration = localEndMin > localStartMin ? localEndMin - localStartMin : 60;

  const shiftedStartTotal = localStartMin + diffMins;
  const dayShift = Math.floor(shiftedStartTotal / 1440);
  const targetDate = dayShift !== 0 ? addDays(localDate, dayShift) : localDate;
  const wrappedStart = ((shiftedStartTotal % 1440) + 1440) % 1440;
  const wrappedEnd = ((wrappedStart + duration) % 1440 + 1440) % 1440;

  return {
    date: targetDate,
    startTime: minutesToTime(wrappedStart),
    endTime: minutesToTime(wrappedEnd),
  };
}

