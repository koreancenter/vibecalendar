import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarEventItem, ProjectItem } from '../types';
import { getEventDateSpan, getWeekDays, WeekDayItem } from '../shared/dateUtils';
import { expandRecurringEventsForRange } from '../shared/recurrenceUtils';
import {
  areShallowArraysEqual,
  useCalendarEventViewModels,
} from '../hooks/useCalendarEventViewModels';
import { useCalendarDragAndDrop } from '../hooks/useCalendarDragAndDrop';
import { LuxuryEventChip } from './common/LuxuryEventChip';
import { TimeGridCanvas, TimeGridColumn } from './TimeGridCanvas';
import { formatLocalizedEventTitle } from '../utils/eventLocalization';

interface WeekGridViewProps {
  selectedDate: string;
  events: CalendarEventItem[];
  selectedEvent: CalendarEventItem | null;
  viewerTimeZone: string;
  viewerShortCode?: string;
  secondaryTimeZone?: string | null;
  secondaryShortCode?: string | null;
  onSelectDate: (date: string) => void;
  onSelectEvent: (event: CalendarEventItem) => void;
  onMoveEventDate: (
    eventId: string,
    targetDate: string,
    targetStartTime?: string,
    targetEndTime?: string
  ) => void;
  onOpenCreateEvent?: (date: string, startTime?: string, endTime?: string) => void;
  projects?: ProjectItem[];
  comparedProjectIds?: string[];
}

const WeekGridViewComponent: React.FC<WeekGridViewProps> = ({
  selectedDate,
  events,
  selectedEvent,
  viewerTimeZone,
  viewerShortCode,
  secondaryTimeZone = null,
  secondaryShortCode = null,
  onSelectDate,
  onSelectEvent,
  onMoveEventDate,
  onOpenCreateEvent,
  projects = [],
  comparedProjectIds = [],
}) => {
  const { t, i18n } = useTranslation();
  const weekDays: WeekDayItem[] = useMemo(
    () => getWeekDays(selectedDate, i18n.language),
    [selectedDate, i18n.language]
  );
  const isComparing = comparedProjectIds.length >= 2;

  const [timelineHoverDate, setTimelineHoverDate] = useState<string | null>(null);

  const {
    draggedEventId: draggedAllDayId,
    dragOverDate: allDayDropDate,
    isCellDragging,
    handleCellDragStart,
    handleCellDragEnd,
    handleCellDragOver,
    handleCellDragLeave,
    handleCellDrop,
  } = useCalendarDragAndDrop({
    onMoveEventDate,
    requireActiveCellDrag: true,
  });

  const expandedEvents = useMemo(
    () =>
      weekDays.length === 7
        ? expandRecurringEventsForRange(events, weekDays[0].date, weekDays[6].date)
        : events,
    [events, weekDays]
  );

  const { byEventId, getViewModel } = useCalendarEventViewModels({
    events: expandedEvents,
    projects,
    viewerTimeZone,
  });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const d of weekDays) {
      map.set(d.date, []);
    }
    for (const ev of expandedEvents) {
      const localDate = (byEventId.get(ev.id) ?? getViewModel(ev)).timing.localDate;
      const spanDates = getEventDateSpan(localDate, ev.endDate);
      for (const dStr of spanDates) {
        const list = map.get(dStr);
        if (list) {
          list.push(ev);
        }
      }
    }
    return map;
  }, [expandedEvents, weekDays, byEventId, getViewModel]);

  const allDayEventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    eventsByDate.forEach((list, date) => {
      map.set(
        date,
        list.filter((e) => e.isAllDay)
      );
    });
    return map;
  }, [eventsByDate]);

  const hasAnyAllDay = useMemo(() => {
    let count = 0;
    allDayEventsByDate.forEach((list) => {
      count += list.length;
    });
    return count > 0;
  }, [allDayEventsByDate]);

  const columns: TimeGridColumn[] = useMemo(
    () =>
      weekDays.map((day) => ({
        date: day.date,
        isSelected: day.date === selectedDate,
        isToday: day.isToday,
        events: (eventsByDate.get(day.date) || []).filter((e) => !e.isAllDay),
      })),
    [weekDays, selectedDate, eventsByDate]
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden select-none bg-[#0c0e14]">
      {/* 1. 주간 요일 헤더 */}
      <div className="h-10 flex bg-[#101218] border-b border-white/[0.06] shrink-0 z-10 items-stretch">
        <div
          className={`${
            secondaryTimeZone && secondaryTimeZone !== viewerTimeZone
              ? 'w-24 sm:w-28 justify-between px-2'
              : 'w-14 sm:w-16 justify-center px-1'
          } border-r border-white/[0.06] flex items-center shrink-0`}
        >
          {secondaryTimeZone && secondaryTimeZone !== viewerTimeZone ? (
            <>
              <span className="text-[10px] font-mono text-sky-300 tabular-nums tracking-tight truncate">
                {secondaryShortCode || 'AUX'}
              </span>
              <span className="text-[10px] font-mono text-white/85 tabular-nums tracking-tight truncate">
                {viewerShortCode || 'LOC'}
              </span>
            </>
          ) : (
            <span className="text-[10.5px] font-medium text-white/75 tabular-nums tracking-tight truncate">
              {viewerShortCode || t('calendar.time', '시간')}
            </span>
          )}
        </div>

        <div className="flex-1 grid grid-cols-7 divide-x divide-white/[0.06]">
          {weekDays.map((day, idx) => {
            const isSelected = day.date === selectedDate;
            const isWeekend = idx === 0 || idx === 6;
            const isDropTarget =
              timelineHoverDate === day.date || allDayDropDate === day.date;

            return (
              <div
                key={day.date}
                onClick={() => {
                  onSelectDate(day.date);
                  onOpenCreateEvent?.(day.date);
                }}
                onDragOver={(e) => handleCellDragOver(e, day.date)}
                onDragLeave={(e) => handleCellDragLeave(e, day.date)}
                onDrop={(e) => handleCellDrop(e, day.date)}
                title={onOpenCreateEvent ? `${day.date} 새 일정 등록` : undefined}
                className={`flex items-center justify-center px-1 text-center transition-colors duration-150 cursor-pointer ${
                  isDropTarget
                    ? 'bg-white/[0.07] ring-1 ring-inset ring-white/25'
                    : isSelected
                    ? 'bg-white/[0.035]'
                    : 'hover:bg-white/[0.025]'
                }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span
                    className={`text-[11px] tracking-[0.02em] ${
                      isDropTarget
                        ? 'text-white font-semibold'
                        : isWeekend
                        ? 'text-white/68 font-medium'
                        : 'text-white/82 font-medium'
                    }`}
                  >
                    {day.dayOfWeek}
                  </span>
                  <span
                    className={`text-[11.5px] tabular-nums tracking-[0.02em] transition-colors ${
                      day.isToday
                        ? 'text-white font-semibold'
                        : isDropTarget
                        ? 'text-white font-semibold'
                        : isSelected
                        ? 'text-white font-medium'
                        : 'text-white/86 font-normal'
                    }`}
                  >
                    {day.dayNumber}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. 종일 일정 영역 */}
      {hasAnyAllDay && (
        <div className="flex bg-[#11141d] border-b border-white/[0.07] shrink-0 text-xs z-10">
          <div
            className={`${
              secondaryTimeZone && secondaryTimeZone !== viewerTimeZone
                ? 'w-24 sm:w-28'
                : 'w-14 sm:w-16'
            } border-r border-white/[0.07] p-1.5 text-center text-[10px] font-medium text-neutral-300 flex items-center justify-center shrink-0`}
          >
            {t('calendar.allDay', '종일')}
          </div>
          <div className="flex-1 grid grid-cols-7 divide-x divide-white/[0.06]">
            {weekDays.map((day) => {
              const allDayList = allDayEventsByDate.get(day.date) || [];
              const isCellDropOver = allDayDropDate === day.date;

              return (
                <div
                  key={day.date}
                  onClick={(e) => {
                    const targetEl = e.target as HTMLElement | null;
                    if (
                      targetEl?.closest(
                        '.luxury-event-chip, .luxury-event-card, button, [role="button"]'
                      )
                    ) {
                      return;
                    }
                    onSelectDate(day.date);
                    onOpenCreateEvent?.(day.date);
                  }}
                  onDragOver={(e) => handleCellDragOver(e, day.date)}
                  onDragLeave={(e) => handleCellDragLeave(e, day.date)}
                  onDrop={(e) => handleCellDrop(e, day.date)}
                  className={`px-1.5 py-1.5 space-y-1.5 min-h-[34px] transition-colors cursor-pointer ${
                    isCellDropOver
                      ? 'bg-white/[0.07] ring-1 ring-inset ring-white/25'
                      : 'hover:bg-white/[0.02]'
                  }`}
                >
                  {allDayList.map((ev) => {
                    const vm = byEventId.get(ev.id) ?? getViewModel(ev);
                    const isEvSelected = selectedEvent?.id === ev.id;
                    const isBeingDragged = draggedAllDayId === ev.id;

                    return (
                      <LuxuryEventChip
                        key={ev.id}
                        event={ev}
                        theme={vm.theme}
                        size="sm"
                        showProjectBadge={isComparing}
                        showCompletionIcon
                        isSelected={isEvSelected}
                        isDragging={isBeingDragged}
                        isAnyDragging={isCellDragging}
                        draggable
                        titleAttr={formatLocalizedEventTitle(ev, { locale: i18n.language })}
                        onDragStart={(e) => handleCellDragStart(e, ev.id)}
                        onDragEnd={handleCellDragEnd}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectDate(day.date);
                          onSelectEvent(ev);
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. 공용 타임그리드 캔버스 */}
      <TimeGridCanvas
        columns={columns}
        variant="week"
        viewerTimeZone={viewerTimeZone}
        secondaryTimeZone={secondaryTimeZone}
        startHour={7}
        endHour={23}
        pxPerHour={64}
        selectedEvent={selectedEvent}
        projects={projects}
        comparedProjectIds={comparedProjectIds}
        onSelectDate={onSelectDate}
        onSelectEvent={onSelectEvent}
        onMoveEventDate={onMoveEventDate}
        onQuickCreateSlot={onOpenCreateEvent}
        onDragHoverDateChange={setTimelineHoverDate}
      />
    </div>
  );
};

function areWeekGridViewPropsEqual(
  prev: WeekGridViewProps,
  next: WeekGridViewProps
): boolean {
  return (
    prev.selectedDate === next.selectedDate &&
    prev.selectedEvent === next.selectedEvent &&
    prev.viewerTimeZone === next.viewerTimeZone &&
    prev.viewerShortCode === next.viewerShortCode &&
    prev.secondaryTimeZone === next.secondaryTimeZone &&
    prev.secondaryShortCode === next.secondaryShortCode &&
    prev.onSelectDate === next.onSelectDate &&
    prev.onSelectEvent === next.onSelectEvent &&
    prev.onMoveEventDate === next.onMoveEventDate &&
    prev.onOpenCreateEvent === next.onOpenCreateEvent &&
    areShallowArraysEqual(prev.events, next.events) &&
    areShallowArraysEqual(prev.projects, next.projects) &&
    areShallowArraysEqual(prev.comparedProjectIds, next.comparedProjectIds)
  );
}

export const WeekGridView = React.memo(WeekGridViewComponent, areWeekGridViewPropsEqual);
