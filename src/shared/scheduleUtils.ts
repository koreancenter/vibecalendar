import { CalendarEventItem, FreeTimeSlot } from '../types';

export interface ConflictResult {
  hasConflict: boolean;
  conflictingEvents: CalendarEventItem[];
  suggestedSlots: FreeTimeSlot[];
  message: string;
}

export const WORK_DAY_START_MINUTES = 9 * 60; // 09:00
export const WORK_DAY_END_MINUTES = 19 * 60; // 19:00

/**
 * "HH:MM" 문자열을 0시 기준 분 단위 정수로 변환
 */
export function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':');
  const h = parseInt(parts[0] || '0', 10) || 0;
  const m = parseInt(parts[1] || '0', 10) || 0;
  return h * 60 + m;
}

/**
 * 분 단위 정수를 "HH:MM" 문자열로 변환
 */
export function minutesToTime(minutes: number): string {
  const safeMin = Math.max(0, Math.min(24 * 60 - 1, minutes));
  const h = Math.floor(safeMin / 60);
  const m = safeMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 두 시간 구간이 겹치는지 판별 (경계 맞닿음은 허용)
 */
export function isOverlapping(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);

  const actualEnd1 = e1 <= s1 ? s1 + 60 : e1;
  const actualEnd2 = e2 <= s2 ? s2 + 60 : e2;

  return s1 < actualEnd2 && actualEnd1 > s2;
}

/**
 * 특정 일정이 전체 일정 목록 내 동일 일자의 다른 시간제 일정과 겹치는지 판별
 */
export function hasEventConflict(
  target: CalendarEventItem | null | undefined,
  allEvents: CalendarEventItem[]
): boolean {
  if (!target || target.isAllDay) return false;
  return allEvents.some(
    (other) =>
      other.id !== target.id &&
      other.date === target.date &&
      !other.isAllDay &&
      isOverlapping(target.startTime, target.endTime, other.startTime, other.endTime)
  );
}

/**
 * 일정 목록의 달성률 통계 계산
 */
export function calculateCompletionStats(events: CalendarEventItem[]): {
  total: number;
  completed: number;
  rate: number;
} {
  const total = events.length;
  const completed = events.filter((e) => e.isCompleted).length;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, rate };
}

function formatDurationLabel(diffMins: number): string {
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  const durText = hours > 0 ? (mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`) : `${mins}분`;
  return `${durText} 여유`;
}

/**
 * 일일 비어 있는 여유 시간대 계산 (09:00 ~ 19:00 단일 기준, 서버/클라이언트 공용)
 */
export function calculateFreeTimeSlots(
  events: CalendarEventItem[],
  minDurationMins = 30
): FreeTimeSlot[] {
  const slots: FreeTimeSlot[] = [];
  const sorted = [...events]
    .filter((e) => e && !e.isAllDay && e.startTime && e.endTime)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  let currentPointer = WORK_DAY_START_MINUTES;

  for (const ev of sorted) {
    const evStart = timeToMinutes(ev.startTime);
    const evEnd = Math.max(evStart + 15, timeToMinutes(ev.endTime));

    if (evStart > currentPointer) {
      const gapEnd = Math.min(evStart, WORK_DAY_END_MINUTES);
      const diffMins = gapEnd - currentPointer;
      if (diffMins >= minDurationMins) {
        slots.push({
          startTime: minutesToTime(currentPointer),
          endTime: minutesToTime(gapEnd),
          durationMinutes: diffMins,
          label: formatDurationLabel(diffMins),
        });
      }
    }
    if (evEnd > currentPointer) {
      currentPointer = evEnd;
    }
  }

  if (currentPointer < WORK_DAY_END_MINUTES) {
    const diffMins = WORK_DAY_END_MINUTES - currentPointer;
    if (diffMins >= minDurationMins) {
      slots.push({
        startTime: minutesToTime(currentPointer),
        endTime: minutesToTime(WORK_DAY_END_MINUTES),
        durationMinutes: diffMins,
        label: formatDurationLabel(diffMins),
      });
    }
  }

  return slots;
}

/**
 * 신규/변경 일정의 시간 충돌 감지 및 최적 대체 시간대 최대 3개 제안
 */
export function detectConflictAndSuggest(
  targetDate: string,
  startTime: string,
  endTime: string,
  existingEvents: CalendarEventItem[],
  excludeEventId?: string
): ConflictResult {
  const dayEvents = existingEvents.filter(
    (ev) =>
      ev.date === targetDate &&
      !ev.isAllDay &&
      ev.startTime &&
      ev.endTime &&
      ev.id !== excludeEventId
  );

  const conflictingEvents = dayEvents.filter((ev) =>
    isOverlapping(startTime, endTime, ev.startTime, ev.endTime)
  );

  if (conflictingEvents.length === 0) {
    return {
      hasConflict: false,
      conflictingEvents: [],
      suggestedSlots: [],
      message: `${targetDate} ${startTime} ~ ${endTime} 시간대에 충돌하는 일정이 없습니다.`,
    };
  }

  const reqStartMin = timeToMinutes(startTime);
  const reqEndMin = timeToMinutes(endTime);
  const duration = Math.max(30, reqEndMin > reqStartMin ? reqEndMin - reqStartMin : 60);

  const freeGaps = calculateFreeTimeSlots(dayEvents, duration);
  const suggestedSlots: FreeTimeSlot[] = [];

  for (const gap of freeGaps) {
    const gapStart = timeToMinutes(gap.startTime);
    const gapEnd = timeToMinutes(gap.endTime);

    suggestedSlots.push({
      startTime: minutesToTime(gapStart),
      endTime: minutesToTime(gapStart + duration),
      durationMinutes: duration,
      label:
        gapStart < 12 * 60
          ? '오전 여유 시간대'
          : gapStart < 14 * 60
          ? '점심 직후 시간대'
          : '오후 여유 시간대',
    });

    if (suggestedSlots.length >= 3) break;

    if (gapEnd - (gapStart + 60) >= duration && suggestedSlots.length < 3) {
      const nextStart = gapStart + 60;
      suggestedSlots.push({
        startTime: minutesToTime(nextStart),
        endTime: minutesToTime(nextStart + duration),
        durationMinutes: duration,
        label: '추가 여유 시간대',
      });
    }

    if (suggestedSlots.length >= 3) break;
  }

  if (suggestedSlots.length === 0) {
    const latestConflictEnd = Math.max(
      ...conflictingEvents.map((c) => timeToMinutes(c.endTime))
    );
    const fallbackStart = Math.min(22 * 60 - duration, latestConflictEnd + 10);
    suggestedSlots.push({
      startTime: minutesToTime(fallbackStart),
      endTime: minutesToTime(fallbackStart + duration),
      durationMinutes: duration,
      label: '충돌 일정 직후 시간대',
    });
  }

  const conflictNames = conflictingEvents
    .map((c) => `'${c.title}'(${c.startTime}~${c.endTime})`)
    .join(', ');

  return {
    hasConflict: true,
    conflictingEvents,
    suggestedSlots,
    message: `해당 시간에 기존 일정 ${conflictNames}과 시간이 겹칩니다.`,
  };
}

/**
 * 자연어 프롬프트가 실시간 웹 검색(공휴일·업계 주요 행사·최적 개최 후보일 탐색)이 필요한 기획 질의인지 판별
 */
export function shouldUseSearchGroundingForPlanning(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;

  // 1. 단순 로컬 일정 수정/삭제 및 당일·익일 단순 브리핑 명령 제외
  if (
    /^(방금|그 일정|이 일정).*(수정|삭제|취소|미뤄|당겨|변경)/.test(text) ||
    /^(오늘|내일)\s*(일정|스케줄)\s*(뭐야|알려줘|보여줘|확인|브리핑)\??$/.test(text)
  ) {
    return false;
  }

  // 2. 공휴일·후보일 탐색 의도 없는 순수 식당/장소 추천 질의 제외 (RECOMMEND_VENUE 라우팅 유지)
  const isVenueOnlyQuery =
    /(식당|맛집|레스토랑|회식\s*장소|오찬\s*장소|만찬\s*장소|모임\s*장소).*추천/.test(text) &&
    !/(공휴일|연휴|개최일|후보일|업계\s*일정|날짜\s*추천)/.test(text);
  if (isVenueOnlyQuery) {
    return false;
  }

  // 3. 특정 월·일이 명시된 단일 일정 즉시 등록 명령 제외 (CREATE_EVENT 라우팅 유지)
  const isExplicitSingleEventCreate =
    /\d{1,2}\s*월\s*\d{1,2}\s*일/.test(text) &&
    /(등록|추가|생성|넣어|배치해|잡아\s*줘|잡아줘)/.test(text) &&
    !/(피해서|겹치지|공휴일|대체공휴일|연휴|탐색|후보일|개최일\s*추천|날짜\s*추천)/.test(text);
  if (isExplicitSingleEventCreate) {
    return false;
  }

  // 4. 공휴일·대체공휴일·연휴 및 외부 업계 일정 탐색 의도
  const holidayPattern =
    /(공휴일|대체공휴일|대체휴일|연휴|국경일|빨간날|법정\s*휴일|징검다리\s*휴일|휴일\s*일정|holiday)/i;

  const industryDiscoveryPattern =
    /(업계\s*행사|업계\s*주요\s*일정|업계\s*일정|산업\s*행사|산업\s*일정|외부\s*행사|공식\s*일정|시즌\s*일정|일정\s*탐색|행사\s*탐색)/i;

  const eventTypeWithExplorationPattern =
    /(박람회|전시회|컨퍼런스|학술대회|학회|심포지엄|엑스포|페어|컨벤션|서밋|포럼|세미나|워크숍|쇼케이스|conference|expo|summit).*(일정|스케줄|탐색|동향|언제|조회|확인|알려|검색|있어|겹치|피해|후보|개최)/i;

  const dateRecommendationPattern =
    /(날짜\s*추천|일정\s*추천|개최일|후보일|개최\s*시기|개최\s*시점|언제가\s*(좋을|무난|적절|괜찮)|언제쯤이?\s*(좋을|무난|적절|괜찮)|피해서\s*(날짜|일정|잡|추천)|겹치지\s*않는?\s*(날짜|일정|후보|개최)|겹치지\s*않게.*(추천|잡|알려))/i;

  return (
    holidayPattern.test(text) ||
    industryDiscoveryPattern.test(text) ||
    eventTypeWithExplorationPattern.test(text) ||
    dateRecommendationPattern.test(text)
  );
}

/**
 * 자연어 프롬프트에서 탐색 기간(개월 수, 1~12개월)을 추론 (명시 없으면 기본 3개월)
 */
export function extractPlanningRangeMonths(prompt: string, selectedDate: string): number {
  const text = prompt.trim();
  const [yStr, mStr] = selectedDate.split('-');
  const baseYear = Number(yStr) || new Date().getFullYear();
  const baseMonth = Number(mStr) || new Date().getMonth() + 1;

  const clampMonths = (n: number) => Math.min(12, Math.max(1, Math.round(n)));

  // 1. 명시적 숫자 개월/달 (예: "향후 6개월", "2달 동안", "4개월간")
  const explicitMonthsMatch = text.match(/(\d{1,2})\s*(?:개월|달)/);
  if (explicitMonthsMatch) {
    return clampMonths(Number(explicitMonthsMatch[1]));
  }

  // 2. 한글 수사 및 연간·반기·분기 표현
  if (/(?:1\s*년|일\s*년|연간|내년\s*전체)/.test(text)) return 12;
  if (/(?:반년|육\s*개월|6\s*개월)/.test(text)) return 6;
  if (/(?:내년\s*하반기)/.test(text)) return 12;

  if (/내년\s*상반기/.test(text)) {
    const monthsUntilNextJune = (baseYear + 1 - baseYear) * 12 + (6 - baseMonth) + 1;
    return clampMonths(Math.max(3, monthsUntilNextJune));
  }

  if (/상반기/.test(text)) {
    if (baseMonth <= 6) {
      return clampMonths(6 - baseMonth + 1);
    }
    return clampMonths(12 - baseMonth + 6 + 1);
  }

  if (/(?:하반기|연말까지|올해\s*안|금년\s*내|올해\s*말)/.test(text)) {
    return clampMonths(Math.max(2, 12 - baseMonth + 1));
  }

  if (/(?:세\s*달|석\s*달|삼\s*개월|다음\s*분기|이번\s*분기|1\s*분기\s*동안)/.test(text)) {
    return 3;
  }
  if (/(?:두\s*달|이\s*개월|다음\s*달|내달)/.test(text)) {
    return 2;
  }
  if (/(?:한\s*달|일\s*개월|이번\s*달|이달)/.test(text)) {
    return 1;
  }

  // 3. 특정 목표 월 언급 (예: "내년 3월쯤", "12월에 세미나")
  const targetMonthMatch = text.match(/(?:(내년)\s*)?(\d{1,2})\s*월/);
  if (targetMonthMatch) {
    const isNextYear = Boolean(targetMonthMatch[1]);
    const targetMonth = Number(targetMonthMatch[2]);
    if (targetMonth >= 1 && targetMonth <= 12) {
      let delta = targetMonth - baseMonth + 1;
      if (isNextYear || delta <= 0) {
        delta += 12;
      }
      return clampMonths(delta);
    }
  }

  return 3;
}

