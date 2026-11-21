import { CalendarCategory, ProjectItem, RecurrenceRule } from '../types';
import { addDays, formatDateString, getTodayDateString, parseLocalDate, parseNaturalDateFromText } from '../shared/dateUtils';
import { formatPhoneDisplay, normalizePlaceAndAddress } from '../shared/locationUtils';
import { inferRecurrenceRuleFromPrompt } from '../shared/recurrenceUtils';
import { inferTimeZoneFromLocation, parseExplicitTimeZoneFromText } from '../shared/timeZoneUtils';

export interface ParseNaturalEventOptions {
  baseDate: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  defaultIsAllDay?: boolean;
  defaultCategory?: CalendarCategory;
  defaultProjectId?: string;
  defaultLocation?: string;
  defaultLocationAddress?: string;
  defaultLocationPhone?: string;
  defaultLocationMobilePhone?: string;
  viewerTimeZone: string;
  projects: ProjectItem[];
}

export interface ParsedExtractedFlags {
  date: boolean;
  time: boolean;
  timeZone: boolean;
  category: boolean;
  project: boolean;
  location: boolean;
  phone: boolean;
  checklist: boolean;
  recurrence: boolean;
}

export interface ParsedNaturalEvent {
  title: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  timeZone: string;
  category: CalendarCategory;
  projectId: string;
  location: string;
  locationAddress: string;
  locationPhone: string;
  locationMobilePhone: string;
  checklistItems: string[];
  recurrence?: RecurrenceRule;
  extractedFields: ParsedExtractedFlags;
}

export function computeNextHourSlot(startTime: string, addMinutes = 60): string {
  const [hStr, mStr] = startTime.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '11:00';
  const total = Math.min(23 * 60 + 55, Math.max(0, h * 60 + m + addMinutes));
  const nextH = Math.floor(total / 60);
  const nextM = total % 60;
  return `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`;
}

function toHHmm(hour24: number, minute: number): string {
  const clampedH = Math.max(0, Math.min(23, hour24));
  const clampedM = Math.max(0, Math.min(59, minute));
  return `${String(clampedH).padStart(2, '0')}:${String(clampedM).padStart(2, '0')}`;
}

function timeStrToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 600;
  return h * 60 + m;
}

function resolveKoreanHour(
  rawHour: number,
  meridiemRaw?: string,
  suffixAmPm?: string
): number {
  const m = (meridiemRaw || suffixAmPm || '').trim().toLowerCase();
  let h = rawHour;

  if (m === '오후' || m === '저녁' || m === '밤' || m === 'pm') {
    if (h >= 1 && h <= 11) h += 12;
  } else if (m === '낮') {
    if (h >= 1 && h <= 5) h += 12;
  } else if (m === '오전' || m === '아침' || m === '새벽' || m === 'am') {
    if (h === 12) h = 0;
  } else if (h >= 1 && h <= 7) {
    // 모호한 1시~7시 단독 표기는 업무 시간대 휴리스틱(13:00~19:00) 적용
    h += 12;
  }
  return Math.max(0, Math.min(23, h));
}

function parseMinutesPart(minStr?: string, hasHalf?: boolean): number {
  if (hasHalf) return 30;
  if (!minStr) return 0;
  const parsed = parseInt(minStr, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 59) return 0;
  return parsed;
}

const WEEKDAY_CHAR_TO_INDEX: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

function resolveWeekdayDate(
  todayStr: string,
  weekModifier: string | undefined,
  dayChar: string
): string {
  const targetDow = WEEKDAY_CHAR_TO_INDEX[dayChar];
  if (targetDow === undefined) return todayStr;

  const todayDt = parseLocalDate(todayStr);
  const todayDow = todayDt.getDay();
  const mod = (weekModifier || '').replace(/\s+/g, '');

  if (mod === '이번주' || mod === '금주') {
    const sunday = new Date(todayDt);
    sunday.setDate(todayDt.getDate() - todayDow);
    sunday.setDate(sunday.getDate() + targetDow);
    return formatDateString(sunday);
  }
  if (mod === '다음주' || mod === '차주') {
    const sunday = new Date(todayDt);
    sunday.setDate(todayDt.getDate() - todayDow + 7 + targetDow);
    return formatDateString(sunday);
  }
  if (mod === '다다음주') {
    const sunday = new Date(todayDt);
    sunday.setDate(todayDt.getDate() - todayDow + 14 + targetDow);
    return formatDateString(sunday);
  }

  // 수식어 없이 '금요일' 등만 있는 경우 가장 가까운 다가오는 해당 요일(오늘 포함)
  const diff = (targetDow - todayDow + 7) % 7;
  return addDays(todayStr, diff);
}

function extractChecklistFromText(text: string): { items: string[]; cleaned: string } {
  const items: string[] = [];
  let working = text;

  const addRawList = (rawList: string) => {
    const split = rawList
      .split(/[,·/;+\n]+/)
      .map((s) => s.trim().replace(/^[-*•]\s*/, ''))
      .filter(Boolean);
    for (const item of split) {
      if (!items.includes(item)) {
        items.push(item);
      }
    }
  };

  // 1) 괄호형: (준비물: A, B) / (체크리스트: A, B) / (준비: A)
  working = working.replace(
    /\(\s*(?:준비물|준비사항|준비|체크리스트|지참물?|checklist)\s*[:：]\s*([^)]+)\)/gi,
    (_m, inner: string) => {
      addRawList(inner);
      return ' ';
    }
  );

  // 2) 비괄호형 줄 끝: 준비물: A, B / 체크리스트: A, B
  working = working.replace(
    /(?:^|\s)(?:준비물|준비사항|체크리스트|지참물?)\s*[:：]\s*([^\n]+)$/gim,
    (_m, inner: string) => {
      addRawList(inner);
      return ' ';
    }
  );

  return { items, cleaned: working };
}

function extractPhonesFromText(text: string): {
  mobile: string;
  landline: string;
  cleaned: string;
} {
  let working = text;
  let mobile = '';
  let landline = '';

  const mobileRe =
    /(?:(?:전화|연락처|핸드폰|휴대폰|모바일|tel|hp)\s*[:：]?\s*)?((?:\+?82[-\s.]?)?01[016789][-\s.]?\d{3,4}[-\s.]?\d{4})/gi;
  working = working.replace(mobileRe, (_m, phoneRaw: string) => {
    if (!mobile) {
      mobile = formatPhoneDisplay(phoneRaw.replace(/\s+/g, ''));
    }
    return ' ';
  });

  const landlineRe =
    /(?:(?:대표번호|대표전화|유선|전화|연락처|tel)\s*[:：]?\s*)?((?:\+?82[-\s.]?)?(?:02|0[3-6]\d|070)[-\s.]?\d{3,4}[-\s.]?\d{4}|\b1[568]\d{2}[-\s.]?\d{4}\b)/gi;
  working = working.replace(landlineRe, (_m, phoneRaw: string) => {
    if (!landline) {
      landline = formatPhoneDisplay(phoneRaw.replace(/\s+/g, ''));
    }
    return ' ';
  });

  return { mobile, landline, cleaned: working };
}

function inferCategoryFromText(text: string, fallback: CalendarCategory): {
  category: CalendarCategory;
  detected: boolean;
} {
  const lower = text.toLowerCase();
  if (
    /(?:점심|저녁|조식|만찬|회식|티타임|커피|브런치|식사|오찬|디너|뒤풀이|다과|\blunch\b|\bdinner\b|\bcoffee\b|\bbrunch\b|\bmeal\b)/i.test(
      lower
    )
  ) {
    return { category: '식사·모임', detected: true };
  }
  if (
    /(?:출장|방문|답사|외근|공항|비행|항공|탑승|체크인|미니투어|견학|실사|site\s*visit|\btrip\b|\bflight\b)/i.test(
      lower
    )
  ) {
    return { category: '방문·출장', detected: true };
  }
  if (
    /(?:세미나|컨퍼런스|박람회|전시|포럼|심포지엄|개막식|페어|엑스포|공연|웨비나|발표회|워크숍|\bseminar\b|\bconference\b|\bexpo\b|\bforum\b|\bworkshop\b)/i.test(
      lower
    )
  ) {
    return { category: '행사·세미나', detected: true };
  }
  if (
    /(?:병원|치과|검진|운동|헬스|요가|휴가|연차|반차|생일|가족|미용실|개인일정|\bdentist\b|\bdoctor\b|\bgym\b|\bvacation\b|\bholiday\b)/i.test(
      lower
    )
  ) {
    return { category: '개인', detected: true };
  }
  if (
    /(?:미팅|회의|보고|브리핑|점검|리뷰|면담|인터뷰|계약|체결|mou|스탠드업|스크럼|기획|개발|배포|테스트|리허설|킥오프|\bmeeting\b|\bkickoff\b|\bsync\b|\breview\b|\bstandup\b)/i.test(
      lower
    )
  ) {
    return { category: '업무', detected: true };
  }
  return { category: fallback, detected: false };
}

function extractLocationCandidate(text: string): {
  rawLocation: string;
  rawAddress: string;
  cleaned: string;
} {
  let working = text;

  // 1) 명시적 장소/위치 키워드 (예: 장소: 코엑스 3층)
  const explicitLocMatch = working.match(
    /(?:^|\s)(?:장소|위치)\s*[:：]\s*([^,\n]+?)(?=$|,|\n)/i
  );
  if (explicitLocMatch) {
    const candidate = explicitLocMatch[1].trim();
    working = working.replace(explicitLocMatch[0], ' ');
    const norm = normalizePlaceAndAddress(candidate);
    return {
      rawLocation: norm.location || candidate,
      rawAddress: norm.locationAddress || '',
      cleaned: working,
    };
  }

  // 2) 한국어 상세 도로명/지번 주소 우선 추출
  const addressRe =
    /(?:서울특별시|서울시|서울|경기도|인천광역시|부산광역시|대구광역시|대전광역시|광주광역시|울산광역시|세종특별자치시|제주특별자치도|[가-힣]{2,5}(?:도|시))\s+[가-힣]{1,8}(?:시|군|구)\s+[가-힣0-9]+(?:대로|로|길|번길|동|읍|면)\s*\d+(?:-\d+)?(?:\s*\d+(?:층|호))?/i;
  let extractedAddress = '';
  const addrMatch = working.match(addressRe);
  if (addrMatch) {
    extractedAddress = addrMatch[0].trim();
    working = working.replace(addrMatch[0], ' ');
  }

  // 3) "~에서" 조사 구문 추출 (최대 4어절 장소)
  const eseoMatch = working.match(
    /((?:[가-힣A-Za-z0-9·-]+\s+){0,3}[가-힣A-Za-z0-9·-]+)에서(?=\s|$|,)/
  );
  if (eseoMatch && eseoMatch[1]) {
    const cand = eseoMatch[1].trim();
    // 동사/추상명사 오인 방지: 2자 이상이고 위치/건물/역/실/카페 등이거나 짧은 고유 장소명
    if (cand.length >= 2 && cand.length <= 40) {
      working = working.replace(eseoMatch[0], ' ');
      const norm = normalizePlaceAndAddress(cand, extractedAddress);
      return {
        rawLocation: norm.location || cand,
        rawAddress: norm.locationAddress || extractedAddress,
        cleaned: working,
      };
    }
  }

  // 4) 역/랜드마크 + 건물/시설 + 층/호수 복합 패턴 (예: "강남역 코엑스 3층", "판교 본사 대회의실 A", "Zoom")
  const floorRoomRe = '(?:지하\\s*\\d+층|[B]?\\d+층|\\d+F|\\d{1,4}호|[A-Z가-힣]\\s?(?:홀|룸|관|회의실))';
  const venueSuffixRe =
    '(?:코엑스|킨텍스|벡스코|엑스코|롯데월드타워|롯데타워|파크하얏트|그랜드하얏트|신라호텔|조선팰리스|콘래드|포시즌스|인터컨티넨탈|페어몬트|메리어트|워커힐|스타벅스|투썸플레이스|블루보틀|본사|지사|사옥|캠퍼스|테크노밸리|센터|타워|빌딩|플라자|스퀘어|오디토리움|아트리움|전시장|컨벤션|라운지|스튜디오|대회의실|중회의실|소회의실|회의실|임원실|보드룸|공항|터미널|호텔|리조트|카페|식당|레스토랑|구청|시청|병원)';
  const stationOrAreaRe =
    '(?:[가-힣]{2,6}역|[가-힣]{2,5}(?:구|동)|강남|서초|송파|잠실|성수|여의도|광화문|종로|을지로|명동|서울|용산|한남|청담|역삼|삼성|판교|분당|수원|광교|송도|부산|해운대|대전|대구|광주|제주|도쿄|싱가포르|자카르타|발리|뉴욕|런던|파리)';

  const compoundVenueRe = new RegExp(
    `((?:${stationOrAreaRe}\\s+)?(?:[가-힣A-Za-z0-9·-]+\\s+)?${venueSuffixRe}(?:\\s+${floorRoomRe})*|${stationOrAreaRe}(?:\\s+${floorRoomRe})+)`
  );
  const compoundMatch = working.match(compoundVenueRe);
  if (compoundMatch && compoundMatch[1]) {
    const cand = compoundMatch[1].replace(/\s+/g, ' ').trim();
    working = working.replace(compoundMatch[0], ' ');
    const norm = normalizePlaceAndAddress(cand, extractedAddress);
    return {
      rawLocation: norm.location || cand,
      rawAddress: norm.locationAddress || extractedAddress,
      cleaned: working,
    };
  }

  // 5) 온라인 화상회의 키워드
  const virtualMatch = working.match(
    /\b(Google\s*Meet|Microsoft\s*Teams|Zoom|Webex|Teams|구글\s*밋|화상\s*회의|온라인\s*미팅)\b/i
  );
  if (virtualMatch) {
    const cand = virtualMatch[1].trim();
    if (/^(?:Google|Microsoft|Zoom|Webex|Teams)/i.test(cand)) {
      working = working.replace(virtualMatch[0], ' ');
      return {
        rawLocation: cand,
        rawAddress: extractedAddress,
        cleaned: working,
      };
    }
  }

  // 6) @장소 표기
  const atMatch = working.match(/(?:^|\s)@([^\s,]+(?:\s+[^\s,]+){0,2})/);
  if (atMatch) {
    const cand = atMatch[1].trim();
    working = working.replace(atMatch[0], ' ');
    return {
      rawLocation: cand,
      rawAddress: extractedAddress,
      cleaned: working,
    };
  }

  return {
    rawLocation: '',
    rawAddress: extractedAddress,
    cleaned: working,
  };
}

export function parseNaturalEventText(
  rawText: string,
  options: ParseNaturalEventOptions
): ParsedNaturalEvent {
  const safeBaseDate =
    options.baseDate && /^\d{4}-\d{2}-\d{2}$/.test(options.baseDate)
      ? options.baseDate
      : getTodayDateString();
  const todayStr = getTodayDateString();
  const baseYear = parseInt(safeBaseDate.slice(0, 4), 10) || new Date().getFullYear();

  const defaultStart = options.defaultStartTime || '10:00';
  const defaultEnd = options.defaultEndTime || computeNextHourSlot(defaultStart, 60);
  const defaultCategory = options.defaultCategory || '업무';
  const defaultProjectId = options.defaultProjectId || '';

  const extractedFields: ParsedExtractedFlags = {
    date: false,
    time: false,
    timeZone: false,
    category: false,
    project: false,
    location: false,
    phone: false,
    checklist: false,
    recurrence: false,
  };

  if (!rawText || !rawText.trim()) {
    return {
      title: '',
      date: safeBaseDate,
      startTime: defaultStart,
      endTime: defaultEnd,
      isAllDay: Boolean(options.defaultIsAllDay),
      timeZone: options.viewerTimeZone,
      category: defaultCategory,
      projectId: defaultProjectId,
      location: options.defaultLocation || '',
      locationAddress: options.defaultLocationAddress || '',
      locationPhone: options.defaultLocationPhone || '',
      locationMobilePhone: options.defaultLocationMobilePhone || '',
      checklistItems: [],
      recurrence: undefined,
      extractedFields,
    };
  }

  let working = rawText.replace(/\r\n/g, '\n');

  // 1) 체크리스트 (준비물: ...) 먼저 분리하여 숫자/콤마 충돌 방지
  const checklistRes = extractChecklistFromText(working);
  working = checklistRes.cleaned;
  if (checklistRes.items.length > 0) {
    extractedFields.checklist = true;
  }

  // 2) 전화번호 분리 (날짜/시간 숫자와 충돌 방지)
  const phoneRes = extractPhonesFromText(working);
  working = phoneRes.cleaned;
  if (phoneRes.mobile || phoneRes.landline) {
    extractedFields.phone = true;
  }

  // 3) 반복 주기 추론
  const recurrence = inferRecurrenceRuleFromPrompt(working);
  if (recurrence) {
    extractedFields.recurrence = true;
    working = working
      .replace(/(?:격주|2\s*주\s*마다|이주\s*마다|매주|매일|하루\s*마다|매월|매달|매년|해마다)(?:\s*\d{1,3}\s*(?:회|번))?/g, ' ')
      .trim();
  }

  // 4) 명시적 타임존 추출
  let resolvedTimeZone = options.viewerTimeZone;
  const explicitTz = parseExplicitTimeZoneFromText(working);
  if (explicitTz) {
    resolvedTimeZone = explicitTz;
    extractedFields.timeZone = true;
    working = working
      .replace(
        /(?:한국|서울|국내|자카르타|인니|인도네시아(?:\s*서부|\s*중부)?|발리|싱가포르|일본|도쿄|동경|방콕|태국|베트남|호치민|하노이|다낭|홍콩|중국|상하이|상해|베이징|북경|대만|타이베이|타이페이|두바이|아부다비|UAE|런던|영국|파리|프랑스|독일|베를린|프랑크푸르트|유럽(?:\s*중부)?|스위스|제네바|취리히|뉴욕|워싱턴|보스턴|미국\s*동부|미\s*동부|동부|시카고|댈러스|텍사스|미국\s*중부|미\s*중부|LA|로스앤젤레스|샌프란시스코|실리콘밸리|미국\s*서부|미\s*서부|태평양|하와이|호놀룰루|시드니|멜버른|호주|협정세계시|세계표준시)\s*(?:시간|시각|기준)|\b(?:KST|WIB|WITA|SGT|JST|ICT|HKT|CST|GST|GMT|BST|CET|CEST|EST|EDT|ET|CDT|PST|PDT|PT|HST|AEST|AEDT|UTC)\b/gi,
        ' '
      )
      .trim();
  }

  // 5) 날짜 및 다일 범위 추출
  let resolvedDate = safeBaseDate;
  let resolvedEndDate: string | undefined;

  const dateRangeRe =
    /(\d{4}[-./년\s]+\d{1,2}[-./월\s]+\d{1,2}\s*일?|\d{1,2}월\s*\d{1,2}\s*일?|\d{1,2}[/.]\d{1,2})\s*(?:~|부터|-|–)\s*(\d{4}[-./년\s]+\d{1,2}[-./월\s]+\d{1,2}\s*일?|\d{1,2}월\s*\d{1,2}\s*일?|\d{1,2}[/.]\d{1,2})/;
  const rangeMatch = working.match(dateRangeRe);
  if (rangeMatch) {
    const startParsed = parseNaturalDateFromText(rangeMatch[1], baseYear);
    const endParsed = parseNaturalDateFromText(rangeMatch[2], baseYear);
    if (startParsed) {
      resolvedDate = startParsed;
      if (endParsed && endParsed > startParsed) {
        resolvedEndDate = endParsed;
      }
      extractedFields.date = true;
      working = working.replace(rangeMatch[0], ' ');
    }
  }

  if (!extractedFields.date) {
    // 주 + 요일 또는 독립 요일명
    const weekdayMatch = working.match(
      /(?:(이번\s*주|금주|다음\s*주|차주|다다음\s*주)\s*([월화수목금토일])(?:요일|욜)?|([월화수목금토일])요일)(?=[은는이가의를에\s,]|$)/
    );
    if (weekdayMatch) {
      const mod = weekdayMatch[1];
      const dayChar = weekdayMatch[2] || weekdayMatch[3];
      resolvedDate = resolveWeekdayDate(todayStr, mod, dayChar);
      extractedFields.date = true;
      working = working.replace(weekdayMatch[0], ' ');
    }
  }

  if (!extractedFields.date) {
    const relMatch = working.match(
      /(?<![가-힣A-Za-z])(오늘|금일|내일|명일|모레|글피|어제|tomorrow|today)(?=[은는이가의를에\s,]|$)/i
    );
    if (relMatch) {
      const token = relMatch[1].toLowerCase();
      if (token === '오늘' || token === '금일' || token === 'today') {
        resolvedDate = todayStr;
      } else if (token === '내일' || token === '명일' || token === 'tomorrow') {
        resolvedDate = addDays(todayStr, 1);
      } else if (token === '모레') {
        resolvedDate = addDays(todayStr, 2);
      } else if (token === '글피') {
        resolvedDate = addDays(todayStr, 3);
      } else if (token === '어제') {
        resolvedDate = addDays(todayStr, -1);
      }
      extractedFields.date = true;
      working = working.replace(relMatch[0], ' ');
    }
  }

  if (!extractedFields.date) {
    const fullDateMatch = working.match(
      /(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})(?:\s*일)?/
    );
    if (fullDateMatch) {
      const y = parseInt(fullDateMatch[1], 10);
      const m = parseInt(fullDateMatch[2], 10);
      const d = parseInt(fullDateMatch[3], 10);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        resolvedDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        extractedFields.date = true;
        working = working.replace(fullDateMatch[0], ' ');
      }
    }
  }

  if (!extractedFields.date) {
    const mdMatch = working.match(/(\d{1,2})월\s*(\d{1,2})(?:\s*일)?(?![명인개시분초\w])/);
    if (mdMatch) {
      const m = parseInt(mdMatch[1], 10);
      const d = parseInt(mdMatch[2], 10);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        resolvedDate = `${baseYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        extractedFields.date = true;
        working = working.replace(mdMatch[0], ' ');
      }
    }
  }

  if (!extractedFields.date) {
    const slashMatch = working.match(/(?:^|\s)(\d{1,2})\/([0-3]?\d)(?=[은는이가의를에\s,]|$)/);
    if (slashMatch) {
      const m = parseInt(slashMatch[1], 10);
      const d = parseInt(slashMatch[2], 10);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        resolvedDate = `${baseYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        extractedFields.date = true;
        working = working.replace(slashMatch[0], ' ');
      }
    }
  }

  // 6) 종일 & 시간 범위 & 소요 시간 추출
  let resolvedStartTime = defaultStart;
  let resolvedEndTime = defaultEnd;
  let resolvedIsAllDay = Boolean(options.defaultIsAllDay);

  const allDayRe = /(?<![가-힣A-Za-z])(?:하루\s*종일|종일|올데이|all[-\s]?day)(?=[은는이가을를\s,]|$)/i;
  if (allDayRe.test(working)) {
    resolvedIsAllDay = true;
    extractedFields.time = true;
    working = working.replace(allDayRe, ' ');
  }

  // 소요시간 추출 (예: 2시간, 1시간 30분, 1시간 반, 90분)
  let explicitDurationMins: number | null = null;
  const durationMatch = working.match(
    /(?:(\d+(?:\.\d+)?)\s*시간(?:\s*(\d{1,2})\s*분|\s*(반))?(?:\s*동안)?|(\d{1,3})\s*분(?:\s*간|\s*동안))/
  );
  if (durationMatch) {
    if (durationMatch[1]) {
      const hrs = parseFloat(durationMatch[1]);
      const extraMins = durationMatch[3] ? 30 : durationMatch[2] ? parseInt(durationMatch[2], 10) : 0;
      const total = Math.round(hrs * 60 + extraMins);
      if (total > 0 && total <= 12 * 60) {
        explicitDurationMins = total;
        working = working.replace(durationMatch[0], ' ');
      }
    } else if (durationMatch[4]) {
      const mins = parseInt(durationMatch[4], 10);
      if (mins >= 5 && mins <= 720) {
        explicitDurationMins = mins;
        working = working.replace(durationMatch[0], ' ');
      }
    }
  }

  if (!resolvedIsAllDay) {
    // 6-a) 시간 범위: HH:mm ~ HH:mm, 오전 10시 30분 ~ 오후 12시, 2시부터 4시까지, 2pm - 4pm
    const timePart =
      '(?:(오전|오후|새벽|아침|저녁|밤|낮|am|pm)\\s*)?(\\d{1,2})(?::(\\d{2})|\\s*시(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?)(?:\\s*(am|pm))?';
    const timeRangeRe = new RegExp(
      `${timePart}\\s*(?:~|-|–|부터)\\s*${timePart}(?:\\s*까지)?`,
      'i'
    );
    const tRangeMatch = working.match(timeRangeRe);
    if (tRangeMatch) {
      const sMeridiem = tRangeMatch[1] || tRangeMatch[6];
      const sHourRaw = parseInt(tRangeMatch[2], 10);
      const sMin = parseMinutesPart(tRangeMatch[3] || tRangeMatch[4], Boolean(tRangeMatch[5]));

      const eMeridiemRaw = tRangeMatch[7] || tRangeMatch[12];
      const eHourRaw = parseInt(tRangeMatch[8], 10);
      const eMin = parseMinutesPart(tRangeMatch[9] || tRangeMatch[10], Boolean(tRangeMatch[11]));

      const isColonStart = Boolean(tRangeMatch[3]) && !sMeridiem;
      const sHour = isColonStart ? sHourRaw : resolveKoreanHour(sHourRaw, sMeridiem);

      // 종료 시각 오전/오후 미지정 시 시작 시각 이후가 되도록 추론
      const isColonEnd = Boolean(tRangeMatch[9]) && !eMeridiemRaw;
      let eHour: number;
      if (isColonEnd) {
        eHour = eHourRaw;
      } else if (eMeridiemRaw) {
        eHour = resolveKoreanHour(eHourRaw, eMeridiemRaw);
      } else if (eHourRaw <= 12 && sHour >= 12 && eHourRaw < (sHour - 12 || 12)) {
        eHour = eHourRaw + 12;
      } else if (eHourRaw <= 12 && sHour <= 12 && eHourRaw < sHour) {
        eHour = eHourRaw + 12;
      } else if (eHourRaw <= 12 && sHour >= 12) {
        eHour = eHourRaw === 12 ? 12 : eHourRaw + 12;
      } else {
        eHour = resolveKoreanHour(eHourRaw, undefined);
      }

      if (sHour <= 23 && eHour <= 23) {
        const sStr = toHHmm(sHour, sMin);
        const eStr = toHHmm(eHour, eMin);
        if (timeStrToMinutes(eStr) > timeStrToMinutes(sStr)) {
          resolvedStartTime = sStr;
          resolvedEndTime = eStr;
          resolvedIsAllDay = false;
          extractedFields.time = true;
          working = working.replace(tRangeMatch[0], ' ');
        }
      }
    }

    // 6-b) 정오 / 자정
    if (!extractedFields.time) {
      const noonMatch = working.match(/(?<![가-힣])(정오|자정)(?=[에\s,]|$)/);
      if (noonMatch) {
        resolvedStartTime = noonMatch[1] === '정오' ? '12:00' : '00:00';
        resolvedEndTime = computeNextHourSlot(resolvedStartTime, explicitDurationMins || 60);
        resolvedIsAllDay = false;
        extractedFields.time = true;
        working = working.replace(noonMatch[0], ' ');
      }
    }

    // 6-c) 단일 시각 (오후 2시, 오후 2시 30분, 14:30, 2pm, 9시 반)
    if (!extractedFields.time) {
      const singleWithMeridiemRe =
        /(오전|오후|새벽|아침|저녁|밤|낮)\s*(\d{1,2})(?::(\d{2})|\s*시(?:\s*(\d{1,2})\s*분|\s*(반))?)(?:\s*에)?/i;
      const mMatch = working.match(singleWithMeridiemRe);
      if (mMatch) {
        const hRaw = parseInt(mMatch[2], 10);
        const minVal = parseMinutesPart(mMatch[3] || mMatch[4], Boolean(mMatch[5]));
        const h24 = resolveKoreanHour(hRaw, mMatch[1]);
        resolvedStartTime = toHHmm(h24, minVal);
        resolvedEndTime = computeNextHourSlot(resolvedStartTime, explicitDurationMins || 60);
        resolvedIsAllDay = false;
        extractedFields.time = true;
        working = working.replace(mMatch[0], ' ');
      }
    }

    if (!extractedFields.time) {
      const ampmRe = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
      const apMatch = working.match(ampmRe);
      if (apMatch) {
        const hRaw = parseInt(apMatch[1], 10);
        const minVal = parseMinutesPart(apMatch[2]);
        const h24 = resolveKoreanHour(hRaw, apMatch[3]);
        resolvedStartTime = toHHmm(h24, minVal);
        resolvedEndTime = computeNextHourSlot(resolvedStartTime, explicitDurationMins || 60);
        resolvedIsAllDay = false;
        extractedFields.time = true;
        working = working.replace(apMatch[0], ' ');
      }
    }

    if (!extractedFields.time) {
      const colonRe = /(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s*에)?(?=\s|$|,)/;
      const cMatch = working.match(colonRe);
      if (cMatch) {
        const h24 = parseInt(cMatch[1], 10);
        const minVal = parseInt(cMatch[2], 10);
        resolvedStartTime = toHHmm(h24, minVal);
        resolvedEndTime = computeNextHourSlot(resolvedStartTime, explicitDurationMins || 60);
        resolvedIsAllDay = false;
        extractedFields.time = true;
        working = working.replace(cMatch[0], ' ');
      }
    }

    if (!extractedFields.time) {
      const bareSiRe = /(?:^|\s)(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*(반))?(?:\s*에)?(?=\s|$|,)/;
      const bMatch = working.match(bareSiRe);
      if (bMatch) {
        const hRaw = parseInt(bMatch[1], 10);
        if (hRaw >= 0 && hRaw <= 23) {
          const minVal = parseMinutesPart(bMatch[2], Boolean(bMatch[3]));
          const h24 = resolveKoreanHour(hRaw);
          resolvedStartTime = toHHmm(h24, minVal);
          resolvedEndTime = computeNextHourSlot(resolvedStartTime, explicitDurationMins || 60);
          resolvedIsAllDay = false;
          extractedFields.time = true;
          working = working.replace(bMatch[0], ' ');
        }
      }
    }

    if (!extractedFields.time && explicitDurationMins) {
      resolvedEndTime = computeNextHourSlot(resolvedStartTime, explicitDurationMins);
      extractedFields.time = true;
    }
  }

  // 7) 프로젝트 매칭 (긴 이름 우선, #태그 또는 본문 매칭)
  let resolvedProjectId = defaultProjectId;
  if (options.projects.length > 0) {
    const sortedProjects = [...options.projects].sort((a, b) => b.name.length - a.name.length);
    const lowerRaw = rawText.toLowerCase();
    for (const proj of sortedProjects) {
      const nameTrim = proj.name.trim();
      const codeTrim = (proj.code || '').trim();
      if (nameTrim && lowerRaw.includes(nameTrim.toLowerCase())) {
        resolvedProjectId = proj.id;
        extractedFields.project = true;
        // #프로젝트명 / [프로젝트명] 형태만 본문에서 제거하고 일반 문맥 단어는 제목 보존
        const escaped = nameTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        working = working.replace(new RegExp(`(?:#|\\[)\\s*${escaped}\\s*\\]?`, 'gi'), ' ');
        break;
      }
      if (codeTrim && codeTrim.length >= 2 && new RegExp(`\\b${codeTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(rawText)) {
        resolvedProjectId = proj.id;
        extractedFields.project = true;
        break;
      }
    }
  }

  // 8) 장소 및 도로명 주소 추출
  const locRes = extractLocationCandidate(working);
  working = locRes.cleaned;
  let finalLocation = locRes.rawLocation || options.defaultLocation || '';
  let finalAddress = locRes.rawAddress || options.defaultLocationAddress || '';
  if (locRes.rawLocation || locRes.rawAddress) {
    extractedFields.location = true;
    const normalizedPair = normalizePlaceAndAddress(finalLocation, finalAddress);
    finalLocation = normalizedPair.location || finalLocation;
    finalAddress = normalizedPair.locationAddress || '';
  }

  // 명시적 타임존이 없고 장소에서 해외 도시가 감지된 경우 자동 타임존 설정
  if (!extractedFields.timeZone) {
    const inferredLocTz =
      inferTimeZoneFromLocation(finalLocation) ||
      inferTimeZoneFromLocation(finalAddress) ||
      inferTimeZoneFromLocation(working);
    if (inferredLocTz && inferredLocTz !== options.viewerTimeZone) {
      resolvedTimeZone = inferredLocTz;
      extractedFields.timeZone = true;
    }
  }

  // 9) 카테고리 추론
  const catRes = inferCategoryFromText(rawText, defaultCategory);
  if (catRes.detected) {
    extractedFields.category = true;
  }

  // 10) 잔여 문자열을 깔끔한 일정 제목으로 정제
  const cleanedTitle = working
    .replace(/\s+/g, ' ')
    .replace(/^[\s,·:/\-~]+|[\s,·:/\-~]+$/g, '')
    .trim();

  const resolvedTitle = cleanedTitle || rawText.trim();

  return {
    title: resolvedTitle,
    date: resolvedDate,
    ...(resolvedEndDate ? { endDate: resolvedEndDate } : {}),
    startTime: resolvedStartTime,
    endTime: resolvedEndTime,
    isAllDay: resolvedIsAllDay,
    timeZone: resolvedTimeZone,
    category: catRes.category,
    projectId: resolvedProjectId,
    location: finalLocation,
    locationAddress: finalAddress,
    locationPhone: phoneRes.landline || options.defaultLocationPhone || '',
    locationMobilePhone: phoneRes.mobile || options.defaultLocationMobilePhone || '',
    checklistItems: checklistRes.items,
    ...(recurrence ? { recurrence } : {}),
    extractedFields,
  };
}
