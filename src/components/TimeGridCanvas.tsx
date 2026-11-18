import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { CalendarEventItem, ProjectItem } from '../types';
import { layoutTimeEvents, PositionedEvent } from '../utils/timeGridLayout';
import { minutesToTime } from '../shared/scheduleUtils';
import {
  convertEventTimeBetweenZones,
  formatClockInTimeZone,
} from '../shared/timeZoneUtils';
import { useCalendarDragAndDrop } from '../hooks/useCalendarDragAndDrop';
import {
  areShallowArraysEqual,
  useCalendarEventViewModels,
} from '../hooks/useCalendarEventViewModels';
import {
  LuxuryBlockDragState,
  LuxuryEventBlock,
  LuxuryTimelineDragPreview,
} from './common/LuxuryEventBlock';

export interface TimeGridColumn {
  date: string;
  isSelected?: boolean;
  isToday: boolean;
  events: CalendarEventItem[];
}

interface TimeGridCanvasProps {
  columns: TimeGridColumn[];
  variant: 'week' | 'day';
  viewerTimeZone: string;
  secondaryTimeZone?: string | null;
  startHour?: number;
  endHour?: number;
  pxPerHour?: number;
  selectedEvent: CalendarEventItem | null;
  projects?: ProjectItem[];
  comparedProjectIds?: string[];
  scrollResetKey?: string;
  onSelectDate?: (date: string) => void;
  onSelectEvent: (event: CalendarEventItem) => void;
  onMoveEventDate?: (
    eventId: string,
    targetDate: string,
    targetStartTime?: string,
    targetEndTime?: string
  ) => void;
  onQuickCreateSlot?: (date: string, startTime?: string, endTime?: string) => void;
  onDragHoverDateChange?: (date: string | null) => void;
}

const TimeGridCanvasComponent: React.FC<TimeGridCanvasProps> = ({
  columns,
  variant,
  viewerTimeZone,
  secondaryTimeZone = null,
  startHour = 7,
  endHour = 23,
  pxPerHour = 64,
  selectedEvent,
  projects = [],
  comparedProjectIds = [],
  scrollResetKey,
  onSelectDate,
  onSelectEvent,
  onMoveEventDate,
  onQuickCreateSlot,
  onDragHoverDateChange,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const columnsGridRef = useRef<HTMLDivElement>(null);
  const totalHeight = (endHour - startHour) * pxPerHour;
  const isDayMode = variant === 'day';
  const isComparing = comparedProjectIds.length >= 2;

  const columnDates = useMemo(() => columns.map((c) => c.date), [columns]);
  const columnEvents = useMemo(
    () =>
      Array.from(
        new Map(columns.flatMap((col) => col.events).map((ev) => [ev.id, ev])).values()
      ),
    [columns]
  );

  const { byEventId, getViewModel } = useCalendarEventViewModels({
    events: columnEvents,
    projects,
    viewerTimeZone,
  });

  const handleSelectProjectedEvent = useCallback(
    (projectedEv: CalendarEventItem) => {
      const vm = byEventId.get(projectedEv.id);
      onSelectEvent(vm ? vm.event : projectedEv);
    },
    [onSelectEvent, byEventId]
  );

  useEffect(() => {
    if (scrollContainerRef.current) {
      const scrollPos = (8.5 - startHour) * pxPerHour;
      scrollContainerRef.current.scrollTop = Math.max(0, scrollPos - 20);
    }
  }, [scrollResetKey, startHour, pxPerHour]);

  const { activeInteraction, justDraggedRef, startTimelineInteraction } =
    useCalendarDragAndDrop({
      onMoveEventDate,
      timeline: {
        startHour,
        endHour,
        pxPerHour,
        columnDates,
        columnsGridRef,
        scrollContainerRef,
        onHoverDateChange: onDragHoverDateChange,
        onSelectEvent: handleSelectProjectedEvent,
      },
    });

  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = startHour; h <= endHour; h++) {
      arr.push(h);
    }
    return arr;
  }, [startHour, endHour]);

  const positionedByDate = useMemo(() => {
    const map = new Map<string, PositionedEvent[]>();
    for (const col of columns) {
      const projectedList = col.events.map(
        (ev) => (byEventId.get(ev.id) ?? getViewModel(ev)).projectedEvent
      );
      map.set(col.date, layoutTimeEvents(projectedList, startHour, pxPerHour));
    }
    return map;
  }, [columns, byEventId, getViewModel, startHour, pxPerHour]);

  const hasTodayColumn = useMemo(() => columns.some((col) => col.isToday), [columns]);
  const viewerNowClock = hasTodayColumn ? formatClockInTimeZone(new Date(), viewerTimeZone) : null;
  const nowMinutes = viewerNowClock ? viewerNowClock.hour24 * 60 + viewerNowClock.minute : -1;
  const isNowInGrid =
    viewerNowClock !== null && nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60;
  const nowTopPx = viewerNowClock ? ((nowMinutes - startHour * 60) * pxPerHour) / 60 : 0;

  return (
    <div className="flex-1 min-h-0 relative flex flex-col overflow-hidden bg-[#0c0e14]">

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative flex bg-[#0c0e14]"
      >
        {/* 좌측 시간 축 (단일 또는 글로벌 보조 시간대 듀얼 축, 정폭 숫자) */}
        <div
          className={`${
            secondaryTimeZone && secondaryTimeZone !== viewerTimeZone
              ? isDayMode
                ? 'w-28 sm:w-32'
                : 'w-24 sm:w-28'
              : isDayMode
              ? 'w-16 sm:w-20'
              : 'w-14 sm:w-16'
          } border-r border-white/[0.06] shrink-0 bg-[#0e1017]/85 select-none`}
        >
          <div style={{ height: `${totalHeight}px` }} className="relative">
            {hours.map((h, i) => {
              const top = i * pxPerHour;
              const hasDualAxis = Boolean(
                secondaryTimeZone && secondaryTimeZone !== viewerTimeZone
              );
              const displayHour = hasDualAxis
                ? `${String(h).padStart(2, '0')}:00`
                : h < 12
                ? `오전 ${h}시`
                : h === 12
                ? '낮 12시'
                : `오후 ${h - 12}시`;

              const secondaryHourLabel =
                hasDualAxis && secondaryTimeZone
                  ? convertEventTimeBetweenZones(
                      columns[0]?.date || '2026-01-01',
                      `${String(h).padStart(2, '0')}:00`,
                      `${String(h).padStart(2, '0')}:30`,
                      viewerTimeZone,
                      secondaryTimeZone
                    ).startTime
                  : null;

              return (
                <div
                  key={h}
                  style={{ top: `${top}px` }}
                  className={`absolute left-0 right-0 -translate-y-1/2 ${
                    hasDualAxis
                      ? 'px-2 flex items-center justify-between gap-1.5'
                      : `${isDayMode ? 'pr-3.5' : 'pr-2.5'} text-right`
                  } pointer-events-none`}
                >
                  {hasDualAxis && secondaryHourLabel && (
                    <span
                      className={`${
                        isDayMode ? 'text-[10.5px]' : 'text-[10px]'
                      } font-mono tabular-nums text-sky-300/90 leading-tight`}
                    >
                      {secondaryHourLabel}
                    </span>
                  )}
                  <span
                    className={`${
                      isDayMode ? 'text-[11px]' : 'text-[10.5px]'
                    } ${
                      hasDualAxis ? 'font-mono text-white/85' : 'text-white/72 font-normal block'
                    } tabular-nums tracking-[0.02em] leading-tight`}
                  >
                    {displayHour}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 일자별 타임그리드 컬럼 */}
        <div
          ref={columnsGridRef}
          className={`flex-1 relative ${
            isDayMode ? '' : 'grid grid-cols-7 divide-x divide-white/[0.055]'
          }`}
        >
          {columns.map((col) => {
            const positioned = positionedByDate.get(col.date) || [];
            const isDragTargetCol = Boolean(
              !isDayMode &&
                activeInteraction?.hasMoved &&
                activeInteraction.mode === 'drag' &&
                activeInteraction.currentDate === col.date
            );

            return (
              <div
                key={col.date}
                onClick={() => {
                  if (justDraggedRef.current) return;
                  onSelectDate?.(col.date);
                }}
                onDoubleClick={(e) => {
                  if (justDraggedRef.current || !onQuickCreateSlot) return;
                  const targetEl = e.target as HTMLElement | null;
                  if (
                    targetEl?.closest(
                      '.luxury-event-card, .luxury-event-chip, button, [role="button"]'
                    )
                  ) {
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  const offsetY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
                  const rawMinutes = startHour * 60 + (offsetY / pxPerHour) * 60;
                  const snappedStart = Math.max(
                    startHour * 60,
                    Math.min(endHour * 60 - 30, Math.floor(rawMinutes / 15) * 15)
                  );
                  const snappedEnd = Math.min(23 * 60 + 59, snappedStart + 60);
                  onSelectDate?.(col.date);
                  onQuickCreateSlot(
                    col.date,
                    minutesToTime(snappedStart),
                    minutesToTime(snappedEnd)
                  );
                }}
                style={{ height: `${totalHeight}px` }}
                className={`relative transition-colors duration-150 ${
                  isDragTargetCol
                    ? 'bg-white/[0.03] ring-1 ring-inset ring-white/[0.14]'
                    : !isDayMode && col.isSelected
                    ? 'bg-white/[0.014]'
                    : !isDayMode
                    ? 'hover:bg-white/[0.008]'
                    : ''
                }`}
              >
                {/* 1시간 실선 + 30분 점선 가이드 */}
                {hours.map((h, i) => (
                  <div
                    key={h}
                    style={{ top: `${i * pxPerHour}px` }}
                    className="absolute left-0 right-0 border-t border-white/[0.045] pointer-events-none"
                  >
                    <div
                      style={{ top: `${pxPerHour / 2}px` }}
                      className="absolute left-0 right-0 border-t border-dashed border-white/[0.02]"
                    />
                  </div>
                ))}

                {/* 드래그/리사이즈 중 대상 컬럼에 표시되는 쿨 옵시디언 글래스 프리뷰 카드 */}
                {activeInteraction &&
                  activeInteraction.hasMoved &&
                  activeInteraction.currentDate === col.date && (
                    <LuxuryTimelineDragPreview
                      isDayMode={isDayMode}
                      isCrossDate={
                        activeInteraction.currentDate !== activeInteraction.originalEvent.date
                      }
                      columnDate={col.date}
                      eventTitle={activeInteraction.originalEvent.title}
                      startTimeLabel={minutesToTime(activeInteraction.startMinutes)}
                      endTimeLabel={minutesToTime(activeInteraction.endMinutes)}
                      topPx={
                        ((activeInteraction.startMinutes - startHour * 60) * pxPerHour) / 60
                      }
                      heightPx={
                        ((activeInteraction.endMinutes - activeInteraction.startMinutes) *
                          pxPerHour) /
                        60
                      }
                    />
                  )}

                {/* 오늘 실시간 시간선 */}
                {col.isToday && isNowInGrid && (
                  <div
                    style={{ top: `${nowTopPx}px` }}
                    className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                  >
                    <div className="w-2 h-2 rounded-full bg-rose-500 -ml-1" />
                    <div className="flex-1 h-px bg-rose-500/80" />
                  </div>
                )}

                {/* 배치된 시간제 이벤트 블록 (공용 LuxuryEventBlock) */}
                {positioned.map((pos) => {
                  const ev = pos.event; // projected event in viewerTimeZone
                  const vm = byEventId.get(ev.id) ?? getViewModel(ev);
                  const rawEv = vm.event;
                  const isEvSelected = selectedEvent?.id === ev.id;
                  const isInteracting = activeInteraction?.eventId === ev.id;
                  const isInteractingAndMoved = Boolean(
                    isInteracting && activeInteraction?.hasMoved
                  );

                  const leftInsetPx = isDayMode ? 12 : pos.totalColumns > 1 ? 3.5 : 4.5;
                  const rightGutterPx = isDayMode ? 24 : pos.totalColumns > 1 ? 6.5 : 9;
                  const colGapPx = isDayMode ? 8 : 4.5;
                  const totalHorizontalDeduction =
                    leftInsetPx + rightGutterPx + (pos.totalColumns - 1) * colGapPx;
                  const columnWidthExpr = `(100% - ${totalHorizontalDeduction}px) / ${pos.totalColumns}`;
                  const leftExpr =
                    pos.column === 0
                      ? `${leftInsetPx}px`
                      : `calc(${leftInsetPx}px + ${pos.column} * (${columnWidthExpr} + ${colGapPx}px))`;
                  const widthExpr = `calc(${columnWidthExpr})`;

                  let topPx = pos.topPx;
                  let heightPx = pos.heightPx;
                  let displayStart = ev.startTime;
                  let displayEnd = ev.endTime;
                  let durationMin = pos.durationMinutes;

                  const isMovedToOtherDate = Boolean(
                    isInteractingAndMoved && activeInteraction?.currentDate !== col.date
                  );
                  const isMovedInSameDate = Boolean(
                    isInteractingAndMoved && activeInteraction?.currentDate === col.date
                  );

                  if (isMovedInSameDate && activeInteraction) {
                    topPx =
                      ((activeInteraction.startMinutes - startHour * 60) * pxPerHour) / 60;
                    durationMin =
                      activeInteraction.endMinutes - activeInteraction.startMinutes;
                    heightPx = (durationMin * pxPerHour) / 60;
                    displayStart = minutesToTime(activeInteraction.startMinutes);
                    displayEnd = minutesToTime(activeInteraction.endMinutes);
                  }

                  const renderTopPx = isMovedInSameDate ? topPx : topPx + 1.5;
                  const renderHeightPx = isMovedInSameDate
                    ? heightPx
                    : Math.max(20, heightPx - 3);

                  const dragState: LuxuryBlockDragState = isMovedToOtherDate
                    ? 'moved-other-date'
                    : isMovedInSameDate
                    ? 'moving-same-date'
                    : 'none';

                  return (
                    <LuxuryEventBlock
                      key={ev.id}
                      variant="timeline"
                      event={rawEv}
                      theme={vm.theme}
                      timing={vm.timing}
                      isSelected={isEvSelected}
                      hasConflict={pos.hasConflict}
                      showProjectBadge={isComparing}
                      isDayMode={isDayMode}
                      style={{
                        top: `${renderTopPx}px`,
                        height: `${renderHeightPx}px`,
                        left: leftExpr,
                        width: widthExpr,
                      }}
                      heightPx={heightPx}
                      durationMinutes={durationMin}
                      displayStartTime={displayStart}
                      displayEndTime={displayEnd}
                      dragState={dragState}
                      isAnyInteracting={Boolean(activeInteraction?.hasMoved)}
                      onDragMouseDown={(e) => {
                        onSelectDate?.(col.date);
                        if (rawEv.externalSync?.readOnly) {
                          e.stopPropagation();
                          handleSelectProjectedEvent(ev);
                          return;
                        }
                        startTimelineInteraction(e, ev, 'drag', col.date);
                      }}
                      onResizeTopMouseDown={
                        rawEv.externalSync?.readOnly
                          ? undefined
                          : (e) => {
                              onSelectDate?.(col.date);
                              startTimelineInteraction(e, ev, 'resize-top', col.date);
                            }
                      }
                      onResizeBottomMouseDown={
                        rawEv.externalSync?.readOnly
                          ? undefined
                          : (e) => {
                              onSelectDate?.(col.date);
                              startTimelineInteraction(e, ev, 'resize-bottom', col.date);
                            }
                      }
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function areTimeGridColumnsEqual(
  prevCols: readonly TimeGridColumn[],
  nextCols: readonly TimeGridColumn[]
): boolean {
  if (prevCols === nextCols) return true;
  if (prevCols.length !== nextCols.length) return false;
  for (let i = 0; i < prevCols.length; i++) {
    const a = prevCols[i];
    const b = nextCols[i];
    if (
      a.date !== b.date ||
      Boolean(a.isSelected) !== Boolean(b.isSelected) ||
      a.isToday !== b.isToday ||
      !areShallowArraysEqual(a.events, b.events)
    ) {
      return false;
    }
  }
  return true;
}

function areTimeGridCanvasPropsEqual(
  prev: TimeGridCanvasProps,
  next: TimeGridCanvasProps
): boolean {
  return (
    prev.variant === next.variant &&
    prev.viewerTimeZone === next.viewerTimeZone &&
    prev.secondaryTimeZone === next.secondaryTimeZone &&
    prev.startHour === next.startHour &&
    prev.endHour === next.endHour &&
    prev.pxPerHour === next.pxPerHour &&
    prev.selectedEvent === next.selectedEvent &&
    prev.scrollResetKey === next.scrollResetKey &&
    prev.onSelectDate === next.onSelectDate &&
    prev.onSelectEvent === next.onSelectEvent &&
    prev.onMoveEventDate === next.onMoveEventDate &&
    prev.onQuickCreateSlot === next.onQuickCreateSlot &&
    prev.onDragHoverDateChange === next.onDragHoverDateChange &&
    areTimeGridColumnsEqual(prev.columns, next.columns) &&
    areShallowArraysEqual(prev.projects, next.projects) &&
    areShallowArraysEqual(prev.comparedProjectIds, next.comparedProjectIds)
  );
}

export const TimeGridCanvas = React.memo(
  TimeGridCanvasComponent,
  areTimeGridCanvasPropsEqual
);
