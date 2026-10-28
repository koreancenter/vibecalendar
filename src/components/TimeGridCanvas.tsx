import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { Calendar, Sparkles } from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import { layoutTimeEvents, PositionedEvent } from '../utils/timeGridLayout';
import { minutesToTime } from '../shared/scheduleUtils';
import { formatClockInTimeZone } from '../shared/timeZoneUtils';
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
  onDragHoverDateChange?: (date: string | null) => void;
  showEmptyGuide?: boolean;
  emptyGuideText?: string;
  isWorkspaceEmpty?: boolean;
  onLoadSampleData?: () => void;
}

const TimeGridCanvasComponent: React.FC<TimeGridCanvasProps> = ({
  columns,
  variant,
  viewerTimeZone,
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
  onDragHoverDateChange,
  showEmptyGuide = false,
  emptyGuideText,
  isWorkspaceEmpty = false,
  onLoadSampleData,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const columnsGridRef = useRef<HTMLDivElement>(null);
  const totalHeight = (endHour - startHour) * pxPerHour;
  const isDayMode = variant === 'day';
  const isComparing = comparedProjectIds.length >= 2;

  const columnDates = useMemo(() => columns.map((c) => c.date), [columns]);
  const columnEvents = useMemo(() => columns.flatMap((col) => col.events), [columns]);

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
      {!isDayMode && showEmptyGuide && emptyGuideText && !activeInteraction && (
        <div className="absolute inset-0 pl-14 sm:pl-16 pointer-events-none flex items-center justify-center z-20 px-6">
          {isWorkspaceEmpty && onLoadSampleData ? (
            <div className="pointer-events-auto max-w-sm rounded-2xl bg-[#12151e]/92 backdrop-blur-md border border-white/[0.08] px-6 py-5 text-center space-y-3 shadow-[0_24px_56px_-16px_rgba(0,0,0,0.75)]">
              <div className="space-y-1">
                <p className="text-xs sm:text-[13px] font-medium text-neutral-200 tracking-tight">
                  현재 등록된 일정이 없습니다
                </p>
                <p className="text-[11px] text-neutral-400 leading-relaxed">
                  좌측 컨시어지에 일정을 지시하거나, 사용법 학습을 위한 가상 샘플 일정을 불러와 보세요.
                </p>
              </div>
              <div className="pt-0.5 flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={onLoadSampleData}
                  className="h-9 px-4 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.11] text-xs font-medium text-neutral-100 inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                  <span>학습용 샘플 데이터 불러오기</span>
                </button>
                <span className="text-[10.5px] text-neutral-500">
                  100% 가상 장소 예시 · 언제든 비우기 가능
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[13px] sm:text-sm font-light text-neutral-500 tracking-wide text-center select-none">
              {emptyGuideText}
            </p>
          )}
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden relative flex bg-[#0c0e14]"
      >
        {/* 좌측 현재 위치 기준 단일 시간 축 (Pretendard 정폭 숫자) */}
        <div
          className={`${
            isDayMode ? 'w-16 sm:w-20' : 'w-14 sm:w-16'
          } border-r border-white/[0.06] shrink-0 bg-[#0e1017]/85 select-none`}
        >
          <div style={{ height: `${totalHeight}px` }} className="relative">
            {hours.map((h, i) => {
              const top = i * pxPerHour;
              const displayHour =
                h < 12 ? `오전 ${h}시` : h === 12 ? '낮 12시' : `오후 ${h - 12}시`;

              return (
                <div
                  key={h}
                  style={{ top: `${top}px` }}
                  className={`absolute left-0 right-0 -translate-y-1/2 ${
                    isDayMode ? 'pr-3.5' : 'pr-2.5'
                  } text-right pointer-events-none`}
                >
                  <span
                    className={`${
                      isDayMode ? 'text-[11px]' : 'text-[10.5px]'
                    } text-white/36 font-[360] block tabular-nums tracking-[0.02em] leading-tight`}
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
                      inlayClass={byEventId.get(activeInteraction.eventId)?.theme.inlayClass}
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

                {/* 일간 뷰 빈 상태 안내 */}
                {isDayMode && positioned.length === 0 && !activeInteraction && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6">
                    <div className="pointer-events-auto text-center p-6 bg-[#131620]/90 backdrop-blur-md rounded-2xl border border-white/[0.08] max-w-sm space-y-3">
                      <Calendar className="w-7 h-7 text-neutral-500 mx-auto" strokeWidth={1.6} />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-neutral-200 tracking-tight">
                          등록된 시간제 일정이 없습니다
                        </p>
                        <p className="text-xs text-neutral-400 leading-relaxed">
                          좌측 컨시어지 패널에 시작 시간과 정확한 장소를 함께 지시해 보세요.
                        </p>
                      </div>
                      {isWorkspaceEmpty && onLoadSampleData && (
                        <div className="pt-1 flex flex-col items-center gap-1.5">
                          <button
                            type="button"
                            onClick={onLoadSampleData}
                            className="h-8.5 px-3.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.11] text-xs font-medium text-neutral-100 inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                            <span>학습용 샘플 데이터 불러오기</span>
                          </button>
                          <span className="text-[10.5px] text-neutral-500">
                            100% 가상 장소 예시 · 언제든 비우기 가능
                          </span>
                        </div>
                      )}
                    </div>
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
                        startTimelineInteraction(e, ev, 'drag', col.date);
                      }}
                      onResizeTopMouseDown={(e) => {
                        onSelectDate?.(col.date);
                        startTimelineInteraction(e, ev, 'resize-top', col.date);
                      }}
                      onResizeBottomMouseDown={(e) => {
                        onSelectDate?.(col.date);
                        startTimelineInteraction(e, ev, 'resize-bottom', col.date);
                      }}
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
    prev.startHour === next.startHour &&
    prev.endHour === next.endHour &&
    prev.pxPerHour === next.pxPerHour &&
    prev.selectedEvent === next.selectedEvent &&
    prev.scrollResetKey === next.scrollResetKey &&
    prev.showEmptyGuide === next.showEmptyGuide &&
    prev.emptyGuideText === next.emptyGuideText &&
    prev.isWorkspaceEmpty === next.isWorkspaceEmpty &&
    prev.onSelectDate === next.onSelectDate &&
    prev.onSelectEvent === next.onSelectEvent &&
    prev.onMoveEventDate === next.onMoveEventDate &&
    prev.onDragHoverDateChange === next.onDragHoverDateChange &&
    prev.onLoadSampleData === next.onLoadSampleData &&
    areTimeGridColumnsEqual(prev.columns, next.columns) &&
    areShallowArraysEqual(prev.projects, next.projects) &&
    areShallowArraysEqual(prev.comparedProjectIds, next.comparedProjectIds)
  );
}

export const TimeGridCanvas = React.memo(
  TimeGridCanvasComponent,
  areTimeGridCanvasPropsEqual
);
