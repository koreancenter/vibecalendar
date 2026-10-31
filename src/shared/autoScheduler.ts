import { CalendarEventItem } from '../types';
import { addDays } from './dateUtils';
import {
  WORK_DAY_END_MINUTES,
  WORK_DAY_START_MINUTES,
  minutesToTime,
  timeToMinutes,
} from './scheduleUtils';
import {
  convertLocalSlotToEventZone,
  projectEventToViewerTimeZone,
} from './timeZoneUtils';

export interface RebalanceSnapshot {
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
}

export interface RebalancePatchItem {
  id: string;
  title: string;
  before: RebalanceSnapshot;
  after: RebalanceSnapshot;
  localSummary: string;
  reason: 'overdue' | 'conflict';
}

export interface SmartScheduleRebalanceOptions {
  viewerTimeZone: string;
  todayDateStr: string;
  scopeDate?: string;
  projectIds?: string[];
  includeOverdue?: boolean;
}

export interface SmartScheduleRebalanceResult {
  patches: RebalancePatchItem[];
  movedOverdueCount: number;
  movedConflictCount: number;
  summaryMessage: string;
}

interface OccupiedInterval {
  startMin: number;
  endMin: number;
}

function alignUpToStep(mins: number, step = 15): number {
  return Math.ceil(mins / step) * step;
}

function hasIntervalOverlap(
  intervals: OccupiedInterval[],
  startMin: number,
  endMin: number
): boolean {
  return intervals.some((iv) => startMin < iv.endMin && endMin > iv.startMin);
}

function findAvailableSlotOnDay(
  occupied: OccupiedInterval[],
  durationMins: number,
  preferredStartMin: number
): { startMin: number; endMin: number } | null {
  const safeDuration = Math.max(15, Math.min(480, durationMins));
  const forwardStart = Math.max(
    WORK_DAY_START_MINUTES,
    alignUpToStep(preferredStartMin, 15)
  );

  // 1) 선호 시각 이후 ~ 19:00 탐색
  for (let start = forwardStart; start + safeDuration <= WORK_DAY_END_MINUTES; start += 15) {
    if (!hasIntervalOverlap(occupied, start, start + safeDuration)) {
      return { startMin: start, endMin: start + safeDuration };
    }
  }

  // 2) 당일 오전 09:00 ~ 선호 시각 이전 탐색
  for (
    let start = WORK_DAY_START_MINUTES;
    start < forwardStart && start + safeDuration <= WORK_DAY_END_MINUTES;
    start += 15
  ) {
    if (!hasIntervalOverlap(occupied, start, start + safeDuration)) {
      return { startMin: start, endMin: start + safeDuration };
    }
  }

  // 3) 주간 업무 시간이 가득 찬 경우 19:00 ~ 21:30 야간 연장 슬롯 탐색
  const extendedEnd = 21 * 60 + 30;
  for (
    let start = Math.max(WORK_DAY_END_MINUTES, forwardStart);
    start + safeDuration <= extendedEnd;
    start += 15
  ) {
    if (!hasIntervalOverlap(occupied, start, start + safeDuration)) {
      return { startMin: start, endMin: start + safeDuration };
    }
  }

  return null;
}

/**
 * 시간 충돌 공정 및 미완료 지연 공정을 감지하여 기존 고정 일정과 겹치지 않는
 * 최적 작업 슬롯(09:00~19:00 우선)으로 자동 재배치 패치를 계산합니다.
 */
export function computeSmartScheduleRebalance(
  allEvents: CalendarEventItem[],
  options: SmartScheduleRebalanceOptions
): SmartScheduleRebalanceResult {
  const {
    viewerTimeZone,
    todayDateStr,
    scopeDate,
    projectIds,
    includeOverdue = true,
  } = options;

  const projectFilterSet =
    projectIds && projectIds.length > 0 ? new Set(projectIds) : null;

  const isInTargetScope = (ev: CalendarEventItem): boolean => {
    if (!projectFilterSet) return true;
    return Boolean(ev.projectId && projectFilterSet.has(ev.projectId));
  };

  // 가상 전개된 반복 회차는 제외하고 원본 일정만 대상으로 계산
  const masterEvents = allEvents.filter((ev) => !ev.recurrenceMasterId);

  // 날짜별(viewerTimeZone 투영 기준) 점유 시간표 구축
  const occupiedByDate = new Map<string, OccupiedInterval[]>();
  const ensureDateIntervals = (dateStr: string): OccupiedInterval[] => {
    let list = occupiedByDate.get(dateStr);
    if (!list) {
      list = [];
      occupiedByDate.set(dateStr, list);
    }
    return list;
  };

  interface ProjectedCandidate {
    event: CalendarEventItem;
    sourceTimeZone: string;
    localDate: string;
    localStartMin: number;
    localEndMin: number;
    durationMins: number;
    isAnchored: boolean;
  }

  const overdueAllDayEvents: CalendarEventItem[] = [];
  const overdueTimedCandidates: ProjectedCandidate[] = [];
  const dayTimedCandidates = new Map<string, ProjectedCandidate[]>();

  for (const ev of masterEvents) {
    const isMultiDay = Boolean(ev.endDate && ev.endDate > ev.date);
    const isMovableScope =
      isInTargetScope(ev) &&
      !ev.isCompleted &&
      !ev.recurrence &&
      !isMultiDay;

    if (ev.isAllDay) {
      if (
        includeOverdue &&
        isMovableScope &&
        ev.date < todayDateStr &&
        (!scopeDate || scopeDate === todayDateStr)
      ) {
        overdueAllDayEvents.push(ev);
      }
      continue;
    }

    const timing = projectEventToViewerTimeZone(ev, viewerTimeZone);
    const startMin = timeToMinutes(timing.localStartTime);
    const rawEndMin = timeToMinutes(timing.localEndTime);
    const durationMins = rawEndMin > startMin ? rawEndMin - startMin : 60;
    const endMin = startMin + durationMins;

    const candidate: ProjectedCandidate = {
      event: ev,
      sourceTimeZone: timing.sourceTimeZone,
      localDate: timing.localDate,
      localStartMin: startMin,
      localEndMin: endMin,
      durationMins,
      isAnchored: !isMovableScope,
    };

    if (
      includeOverdue &&
      !candidate.isAnchored &&
      timing.localDate < todayDateStr &&
      (!scopeDate || scopeDate === todayDateStr)
    ) {
      overdueTimedCandidates.push(candidate);
      continue;
    }

    let list = dayTimedCandidates.get(timing.localDate);
    if (!list) {
      list = [];
      dayTimedCandidates.set(timing.localDate, list);
    }
    list.push(candidate);
  }

  const patches: RebalancePatchItem[] = [];
  let movedOverdueCount = 0;
  let movedConflictCount = 0;

  // 1. 각 날짜별로 고정 일정 먼저 배치 후, 겹치는 후순위 일정을 재배치 대기열로 분리
  const conflictRelocationQueue: ProjectedCandidate[] = [];

  const sortedDates = Array.from(dayTimedCandidates.keys()).sort();
  for (const dateStr of sortedDates) {
    const candidates = dayTimedCandidates.get(dateStr) || [];
    // 고정 일정(완료·반복·타 프로젝트) 우선 -> 시작 시각 오름차순 -> 소요 시간 내림차순
    candidates.sort((a, b) => {
      if (a.isAnchored !== b.isAnchored) return a.isAnchored ? -1 : 1;
      if (a.localStartMin !== b.localStartMin) return a.localStartMin - b.localStartMin;
      return b.durationMins - a.durationMins;
    });

    const occupied = ensureDateIntervals(dateStr);
    const shouldCheckConflictsOnDate = scopeDate
      ? dateStr === scopeDate
      : dateStr >= todayDateStr;

    for (const item of candidates) {
      if (item.isAnchored || !shouldCheckConflictsOnDate) {
        occupied.push({ startMin: item.localStartMin, endMin: item.localEndMin });
        continue;
      }

      if (!hasIntervalOverlap(occupied, item.localStartMin, item.localEndMin)) {
        occupied.push({ startMin: item.localStartMin, endMin: item.localEndMin });
      } else {
        conflictRelocationQueue.push(item);
      }
    }
  }

  // 2. 당일/향후 시간 충돌 공정 최적 슬롯 재배치
  for (const conflictItem of conflictRelocationQueue) {
    let placed = false;
    for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
      const targetLocalDate =
        dayOffset === 0 ? conflictItem.localDate : addDays(conflictItem.localDate, dayOffset);
      const occupied = ensureDateIntervals(targetLocalDate);
      const preferredStart =
        dayOffset === 0 ? conflictItem.localStartMin : WORK_DAY_START_MINUTES;
      const slot = findAvailableSlotOnDay(occupied, conflictItem.durationMins, preferredStart);

      if (slot) {
        occupied.push(slot);
        const localStartStr = minutesToTime(slot.startMin);
        const localEndStr = minutesToTime(slot.endMin);
        const converted = convertLocalSlotToEventZone(
          targetLocalDate,
          localStartStr,
          localEndStr,
          viewerTimeZone,
          conflictItem.sourceTimeZone
        );

        if (
          converted.date !== conflictItem.event.date ||
          converted.startTime !== conflictItem.event.startTime ||
          converted.endTime !== conflictItem.event.endTime
        ) {
          patches.push({
            id: conflictItem.event.id,
            title: conflictItem.event.title,
            before: {
              date: conflictItem.event.date,
              endDate: conflictItem.event.endDate,
              startTime: conflictItem.event.startTime,
              endTime: conflictItem.event.endTime,
            },
            after: {
              date: converted.date,
              endDate: undefined,
              startTime: converted.startTime,
              endTime: converted.endTime,
            },
            localSummary: `${targetLocalDate} ${localStartStr}–${localEndStr}`,
            reason: 'conflict',
          });
          movedConflictCount += 1;
        }
        placed = true;
        break;
      }
    }
    if (!placed) {
      // 모든 후보일이 포화 상태면 기존 시간 유지
      ensureDateIntervals(conflictItem.localDate).push({
        startMin: conflictItem.localStartMin,
        endMin: conflictItem.localEndMin,
      });
    }
  }

  // 3. 미완료 지연 종일 일정 -> 오늘로 이관
  for (const ev of overdueAllDayEvents) {
    const targetDate = scopeDate || todayDateStr;
    if (ev.date !== targetDate) {
      patches.push({
        id: ev.id,
        title: ev.title,
        before: {
          date: ev.date,
          endDate: ev.endDate,
          startTime: ev.startTime,
          endTime: ev.endTime,
        },
        after: {
          date: targetDate,
          endDate: undefined,
          startTime: ev.startTime,
          endTime: ev.endTime,
        },
        localSummary: `${targetDate} 종일`,
        reason: 'overdue',
      });
      movedOverdueCount += 1;
    }
  }

  // 4. 미완료 지연 시간제 일정 -> 오늘(또는 다음 가용 업무일) 빈 슬롯으로 이관
  overdueTimedCandidates.sort((a, b) => {
    if (a.localDate !== b.localDate) return a.localDate.localeCompare(b.localDate);
    return a.localStartMin - b.localStartMin;
  });

  const baseTargetDate = scopeDate || todayDateStr;
  for (const overdueItem of overdueTimedCandidates) {
    for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
      const targetLocalDate =
        dayOffset === 0 ? baseTargetDate : addDays(baseTargetDate, dayOffset);
      const occupied = ensureDateIntervals(targetLocalDate);
      const preferredStart = Math.max(WORK_DAY_START_MINUTES, overdueItem.localStartMin);
      const slot = findAvailableSlotOnDay(occupied, overdueItem.durationMins, preferredStart);
      if (slot) {
        occupied.push(slot);
        const localStartStr = minutesToTime(slot.startMin);
        const localEndStr = minutesToTime(slot.endMin);
        const converted = convertLocalSlotToEventZone(
          targetLocalDate,
          localStartStr,
          localEndStr,
          viewerTimeZone,
          overdueItem.sourceTimeZone
        );

        patches.push({
          id: overdueItem.event.id,
          title: overdueItem.event.title,
          before: {
            date: overdueItem.event.date,
            endDate: overdueItem.event.endDate,
            startTime: overdueItem.event.startTime,
            endTime: overdueItem.event.endTime,
          },
          after: {
            date: converted.date,
            endDate: undefined,
            startTime: converted.startTime,
            endTime: converted.endTime,
          },
          localSummary: `${targetLocalDate} ${localStartStr}–${localEndStr}`,
          reason: 'overdue',
        });
        movedOverdueCount += 1;
        break;
      }
    }
  }

  let summaryMessage = '조정이 필요한 시간 충돌이나 미완료 지연 공정이 없습니다.';
  if (patches.length > 0) {
    const parts: string[] = [];
    if (movedConflictCount > 0) parts.push(`시간 충돌 ${movedConflictCount}건`);
    if (movedOverdueCount > 0) parts.push(`지연 공정 ${movedOverdueCount}건`);
    summaryMessage = `${parts.join(' · ')}을 빈 업무 슬롯으로 자동 재배치했습니다.`;
  }

  return {
    patches,
    movedOverdueCount,
    movedConflictCount,
    summaryMessage,
  };
}
