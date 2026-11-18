import { CalendarEventItem, CalendarViewMode, ProjectItem } from '../types';
import { addDays, getEventDateSpan, getTodayDateString } from '../shared/dateUtils';
import { expandRecurringEventsForRange } from '../shared/recurrenceUtils';
import { toViewerProjectedEvent } from '../shared/timeZoneUtils';

export interface ResolveProjectFocusDateParams {
  projectId: string;
  projects: ProjectItem[];
  events: CalendarEventItem[];
  viewerTimeZone: string;
  viewMode: CalendarViewMode;
  currentYear: number;
  currentMonth: number;
  selectedDate: string;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 특정 프로젝트를 선택했을 때 캘린더가 자동으로 포커스할 최적의 날짜(YYYY-MM-DD)를 계산합니다.
 * 1) 해당 프로젝트 일정(반복·다일 일정 포함)이 현재 선택된 날짜에 이미 있으면 이동하지 않습니다.
 * 2) 월간/공정 뷰에서 현재 보고 있는 월에 일정이 있으면 해당 월의 가장 가까운 일정을 선택합니다.
 * 3) 현재 월에 일정이 없거나 주간/일간 뷰에서 다른 날짜에 일정이 있으면,
 *    오늘 이후 가장 가까운 예정 일정 → 없다면 가장 최근 지난 일정 순으로 선택합니다.
 * 4) 등록된 일정이 전혀 없을 때는 프로젝트의 시작일(startDate) → 종료일(endDate) 순으로 폴백합니다.
 */
export function resolveProjectFocusDate({
  projectId,
  projects,
  events,
  viewerTimeZone,
  viewMode,
  currentYear,
  currentMonth,
  selectedDate,
}: ResolveProjectFocusDateParams): string | null {
  if (!projectId || projectId === 'all') return null;

  const project = projects.find((p) => p.id === projectId);
  const projectEvents = events.filter((ev) => ev.projectId === projectId);

  if (projectEvents.length > 0) {
    const todayStr = getTodayDateString();
    const dateSet = new Set<string>();

    const hasRecurring = projectEvents.some((ev) => Boolean(ev.recurrence));
    const expandedEvents = hasRecurring
      ? expandRecurringEventsForRange(
          projectEvents,
          addDays(todayStr, -90),
          addDays(todayStr, 365)
        )
      : projectEvents;

    for (const ev of expandedEvents) {
      const projected = toViewerProjectedEvent(ev, viewerTimeZone);
      const span = getEventDateSpan(projected.date, projected.endDate);
      for (const d of span) {
        if (ISO_DATE_REGEX.test(d)) {
          dateSet.add(d);
        }
      }
    }

    // 반복 시리즈가 범위를 벗어난 극단적 케이스에 대비해 원본 마스터 날짜도 포함
    if (dateSet.size === 0) {
      for (const ev of projectEvents) {
        const projected = toViewerProjectedEvent(ev, viewerTimeZone);
        if (ISO_DATE_REGEX.test(projected.date)) {
          dateSet.add(projected.date);
        }
      }
    }

    const sortedDates = Array.from(dateSet).sort((a, b) => a.localeCompare(b));
    if (sortedDates.length > 0) {
      // 이미 현재 선택 날짜에 해당 프로젝트 일정이 있으면 그대로 유지
      if (dateSet.has(selectedDate)) {
        return selectedDate;
      }

      const currentMonthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-`;
      const inCurrentMonth =
        viewMode === 'month' || viewMode === 'ops'
          ? sortedDates.filter((d) => d.startsWith(currentMonthPrefix))
          : [];

      const pool = inCurrentMonth.length > 0 ? inCurrentMonth : sortedDates;
      const upcoming = pool.find((d) => d >= todayStr);
      if (upcoming) {
        return upcoming;
      }
      return pool[pool.length - 1];
    }
  }

  if (project?.startDate && ISO_DATE_REGEX.test(project.startDate)) {
    return project.startDate;
  }
  if (project?.endDate && ISO_DATE_REGEX.test(project.endDate)) {
    return project.endDate;
  }

  return null;
}
