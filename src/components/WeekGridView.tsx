import React, { useMemo, useState } from 'react';
import { CalendarEventItem, ProjectItem } from '../types';
import { getEventDateSpan, getWeekDays, WeekDayItem } from '../shared/dateUtils';
import {
  areShallowArraysEqual,
  useCalendarEventViewModels,
} from '../hooks/useCalendarEventViewModels';
import { useCalendarDragAndDrop } from '../hooks/useCalendarDragAndDrop';
import { LuxuryEventChip } from './common/LuxuryEventChip';
import { TimeGridCanvas, TimeGridColumn } from './TimeGridCanvas';

interface WeekGridViewProps {
  selectedDate: string;
  events: CalendarEventItem[];
  selectedEvent: CalendarEventItem | null;
  viewerTimeZone: string;
  viewerShortCode?: string;
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
  emptyGuideText?: string;
  isWorkspaceEmpty?: boolean;
  onLoadSampleData?: () => void;
}

const WeekGridViewComponent: React.FC<WeekGridViewProps> = ({
  selectedDate,
  events,
  selectedEvent,
  viewerTimeZone,
  viewerShortCode,
  onSelectDate,
  onSelectEvent,
  onMoveEventDate,
  onOpenCreateEvent,
  projects = [],
  comparedProjectIds = [],
  emptyGuideText,
  isWorkspaceEmpty = false,
  onLoadSampleData,
}) => {
  const weekDays: WeekDayItem[] = useMemo(() => getWeekDays(selectedDate), [selectedDate]);
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

  const { byEventId, getViewModel } = useCalendarEventViewModels({
    events,
    projects,
    viewerTimeZone,
  });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const d of weekDays) {
      map.set(d.date, []);
    }
    for (const ev of events) {
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
  }, [events, weekDays, byEventId, getViewModel]);

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

  const isWeekEmpty = useMemo(
    () => !hasAnyAllDay && columns.every((col) => col.events.length === 0),
    [hasAnyAllDay, columns]
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden select-none bg-[#0c0e14]">
      {/* 1. 주간 요일 헤더 */}
      <div className="h-10 flex bg-[#101218] border-b border-white/[0.06] shrink-0 z-10 items-stretch">
        <div className="w-14 sm:w-16 border-r border-white/[0.06] flex items-center justify-center shrink-0 px-1">
          <span className="text-[10.5px] text-white/38 tabular-nums tracking-tight truncate">
            {viewerShortCode || '시간'}
          </span>
        </div>

        <div className="flex-1 grid grid-cols-7 divide-x divide-white/[0.06]">
          {weekDays.map((day) => {
            const isSelected = day.date === selectedDate;
            const isWeekend = day.dayOfWeek === '일' || day.dayOfWeek === '토';
            const isDropTarget =
              timelineHoverDate === day.date || allDayDropDate === day.date;

            return (
              <div
                key={day.date}
                onClick={() => onSelectDate(day.date)}
                onDoubleClick={() => {
                  onSelectDate(day.date);
                  onOpenCreateEvent?.(day.date);
                }}
                onDragOver={(e) => handleCellDragOver(e, day.date)}
                onDragLeave={(e) => handleCellDragLeave(e, day.date)}
                onDrop={(e) => handleCellDrop(e, day.date)}
                className={`flex items-center justify-center px-1 text-center transition-colors duration-150 cursor-pointer ${
                  isDropTarget
                    ? 'bg-white/[0.07] ring-1 ring-inset ring-white/25'
                    : isSelected
                    ? 'bg-white/[0.035]'
                    : 'hover:bg-white/[0.018]'
                }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span
                    className={`text-[11px] tracking-[0.02em] ${
                      isDropTarget
                        ? 'text-white font-[460]'
                        : isWeekend
                        ? 'text-white/34 font-[360]'
                        : 'text-white/52 font-[420]'
                    }`}
                  >
                    {day.dayOfWeek}
                  </span>
                  <span
                    className={`min-w-[22px] h-[22px] px-1.5 rounded-full flex items-center justify-center text-[11.5px] tabular-nums tracking-[0.02em] transition-colors ${
                      day.isToday
                        ? 'bg-white/[0.11] text-[#f5f7fb] ring-1 ring-inset ring-white/[0.26] font-[460]'
                        : isDropTarget
                        ? 'bg-white/[0.15] text-white font-[460]'
                        : isSelected
                        ? 'bg-white/[0.07] text-white/90 ring-1 ring-inset ring-white/[0.12] font-[450]'
                        : 'text-white/60 font-[380]'
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
          <div className="w-14 sm:w-16 border-r border-white/[0.07] p-1.5 text-center text-[10px] font-medium text-neutral-500 flex items-center justify-center shrink-0">
            종일
          </div>
          <div className="flex-1 grid grid-cols-7 divide-x divide-white/[0.06]">
            {weekDays.map((day) => {
              const allDayList = allDayEventsByDate.get(day.date) || [];
              const isCellDropOver = allDayDropDate === day.date;

              return (
                <div
                  key={day.date}
                  onDoubleClick={(e) => {
                    const targetEl = e.target as HTMLElement | null;
                    if (targetEl?.closest('.luxury-event-chip, .luxury-event-card, button')) {
                      return;
                    }
                    onSelectDate(day.date);
                    onOpenCreateEvent?.(day.date);
                  }}
                  onDragOver={(e) => handleCellDragOver(e, day.date)}
                  onDragLeave={(e) => handleCellDragLeave(e, day.date)}
                  onDrop={(e) => handleCellDrop(e, day.date)}
                  className={`px-1.5 py-1.5 space-y-1.5 min-h-[34px] transition-colors ${
                    isCellDropOver
                      ? 'bg-white/[0.07] ring-1 ring-inset ring-white/25'
                      : ''
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
                        titleAttr={`${ev.title} (드래그하여 다른 날짜로 이동)`}
                        onDragStart={(e) => handleCellDragStart(e, ev.id)}
                        onDragEnd={handleCellDragEnd}
                        onClick={() => {
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
        showEmptyGuide={isWeekEmpty && !draggedAllDayId}
        emptyGuideText={emptyGuideText}
        isWorkspaceEmpty={isWorkspaceEmpty}
        onLoadSampleData={onLoadSampleData}
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
    prev.emptyGuideText === next.emptyGuideText &&
    prev.isWorkspaceEmpty === next.isWorkspaceEmpty &&
    prev.onSelectDate === next.onSelectDate &&
    prev.onSelectEvent === next.onSelectEvent &&
    prev.onMoveEventDate === next.onMoveEventDate &&
    prev.onOpenCreateEvent === next.onOpenCreateEvent &&
    prev.onLoadSampleData === next.onLoadSampleData &&
    areShallowArraysEqual(prev.events, next.events) &&
    areShallowArraysEqual(prev.projects, next.projects) &&
    areShallowArraysEqual(prev.comparedProjectIds, next.comparedProjectIds)
  );
}

export const WeekGridView = React.memo(WeekGridViewComponent, areWeekGridViewPropsEqual);
