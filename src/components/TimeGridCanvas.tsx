import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { Calendar, CheckCircle, AlertTriangle, Sparkles } from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import { layoutTimeEvents, PositionedEvent } from '../utils/timeGridLayout';
import { minutesToTime } from '../shared/scheduleUtils';
import { formatClockInTimeZone } from '../shared/timeZoneUtils';
import { useTimelineInteractions } from '../hooks/useTimelineInteractions';
import {
  areShallowArraysEqual,
  useCalendarEventViewModels,
} from '../hooks/useCalendarEventViewModels';

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

  const { activeInteraction, justDraggedRef, startInteraction } = useTimelineInteractions({
    startHour,
    endHour,
    pxPerHour,
    columnDates,
    columnsGridRef,
    scrollContainerRef,
    onHoverDateChange: onDragHoverDateChange,
    onMoveEventDate,
    onSelectEvent: handleSelectProjectedEvent,
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

                {/* 타 날짜로 드래그 이동 중일 때 대상 컬럼에 표시되는 쿨 옵시디언 글래스 프리뷰 카드 */}
                {activeInteraction &&
                  activeInteraction.hasMoved &&
                  activeInteraction.currentDate === col.date && (
                    <div
                      style={{
                        top: `${
                          ((activeInteraction.startMinutes - startHour * 60) * pxPerHour) / 60
                        }px`,
                        height: `${Math.max(
                          24,
                          ((activeInteraction.endMinutes - activeInteraction.startMinutes) *
                            pxPerHour) /
                            60
                        )}px`,
                      }}
                      className={`absolute ${
                        isDayMode
                          ? 'left-3 right-6 px-4 py-2 rounded-[10px]'
                          : 'left-[4.5px] right-[9px] px-3 py-1.5 rounded-[9px]'
                      } z-40 pointer-events-none flex flex-col justify-center overflow-hidden ${
                        activeInteraction.currentDate !== activeInteraction.originalEvent.date
                          ? 'luxury-glass-border bg-gradient-to-b from-[#1a1f2c]/95 via-[#131722]/94 to-[#0e111a]/96 backdrop-blur-xl shadow-[0_18px_40px_-10px_rgba(0,0,0,0.85)]'
                          : 'bg-white/[0.04] border border-white/20 border-dashed backdrop-blur-xs'
                      }`}
                    >
                      {activeInteraction.currentDate !== activeInteraction.originalEvent.date && (
                        <span className="text-[11.5px] font-[450] text-[#f2f4f8] tracking-[0.014em] leading-[1.45] truncate">
                          {activeInteraction.originalEvent.title}
                        </span>
                      )}
                      <span className="text-[10.5px] font-[370] text-white/60 tabular-nums tracking-[0.032em] leading-[1.4] truncate">
                        {activeInteraction.currentDate !== activeInteraction.originalEvent.date
                          ? `${col.date.slice(5).replace('-', '.')} · `
                          : ''}
                        {minutesToTime(activeInteraction.startMinutes)} –{' '}
                        {minutesToTime(activeInteraction.endMinutes)}
                      </span>
                    </div>
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

                {/* 배치된 시간제 이벤트 블록 (쿨 옵시디언 글래스 + 2px 주얼 인레이 + 단일 좌측 수직 정렬축) */}
                {positioned.map((pos) => {
                  const ev = pos.event; // projected event in viewerTimeZone
                  const vm = byEventId.get(ev.id) ?? getViewModel(ev);
                  const rawEv = vm.event;
                  const timing = vm.timing;
                  const isEvSelected = selectedEvent?.id === ev.id;
                  const isInteracting = activeInteraction?.eventId === ev.id;
                  const isInteractingAndMoved = Boolean(
                    isInteracting && activeInteraction?.hasMoved
                  );

                  const theme = vm.theme;
                  const proj = theme.project;

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

                  const isCompactBlock = heightPx < 52 || (!isDayMode && durationMin < 40);
                  const isLargeBlock = heightPx >= 92;

                  const primaryRangeText = `${displayStart} – ${displayEnd}`;
                  const secondaryZoneText =
                    !isMovedInSameDate && timing && !timing.isSameZone
                      ? timing.hasOffsetDiff
                        ? `${timing.sourceMeta.cityKo} ${rawEv.startTime}`
                        : timing.sourceMeta.cityKo
                      : null;

                  const checklistTotal = rawEv.checklist?.length || 0;
                  const checklistDone = rawEv.checklist?.filter((c) => c.done).length || 0;

                  const paddingClasses = isCompactBlock
                    ? isDayMode
                      ? 'rounded-[9px] px-3.5 py-1'
                      : 'rounded-[8px] px-3 py-0.5'
                    : isLargeBlock
                    ? isDayMode
                      ? 'rounded-[11px] pl-[26px] pr-4 py-4'
                      : 'rounded-[10px] pl-[24px] pr-4 py-3.5'
                    : isDayMode
                    ? 'rounded-[10px] pl-[22px] pr-3.5 py-2.5'
                    : 'rounded-[9px] pl-[20px] pr-3 py-2';

                  const inlayGeometryClasses = isLargeBlock
                    ? isDayMode
                      ? 'left-[12px] top-4 bottom-4'
                      : 'left-[11px] top-3.5 bottom-3.5'
                    : isDayMode
                    ? 'left-[10px] top-2.5 bottom-2.5'
                    : 'left-[9px] top-2 bottom-2';

                  return (
                    <div
                      key={ev.id}
                      data-dragging={isInteracting ? 'true' : undefined}
                      data-selected={isEvSelected && !isMovedToOtherDate ? 'true' : undefined}
                      onMouseDown={(e) => {
                        onSelectDate?.(col.date);
                        startInteraction(e, ev, 'drag', col.date);
                      }}
                      style={{
                        top: `${renderTopPx}px`,
                        height: `${renderHeightPx}px`,
                        left: leftExpr,
                        width: widthExpr,
                      }}
                      className={`group absolute ${paddingClasses} luxury-event-card cursor-grab active:cursor-grabbing z-10 hover:z-20 flex flex-col justify-between overflow-hidden select-none border ${
                        theme.blockSurfaceClass
                      } ${
                        isEvSelected && !isMovedToOtherDate
                          ? `${theme.selectedSurfaceClass} !z-30`
                          : ''
                      } ${
                        isMovedToOtherDate
                          ? 'opacity-25 border-dashed pointer-events-none'
                          : isMovedInSameDate
                          ? '!z-50 shadow-2xl ring-1 ring-white/30 opacity-95'
                          : ''
                      } ${rawEv.isCompleted && !isMovedToOtherDate ? 'opacity-55' : ''}`}
                    >
                      {/* 상단 리사이즈 핸들 */}
                      <div
                        onMouseDown={(e) => {
                          onSelectDate?.(col.date);
                          startInteraction(e, ev, 'resize-top', col.date);
                        }}
                        className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/[0.05] transition-opacity duration-150"
                        title="위로 당겨 시작 시간 조정"
                      >
                        <div className="w-5 h-0.5 rounded-full bg-white/25" />
                      </div>

                      {isCompactBlock ? (
                        <div className="relative z-10 flex items-center gap-2.5 w-full overflow-hidden leading-[1.4] my-auto">
                          <span
                            aria-hidden="true"
                            className={`w-[2px] h-3 rounded-full shrink-0 ${theme.inlayClass}`}
                          />
                          {pos.hasConflict && (
                            <AlertTriangle className="w-3 h-3 text-amber-300/90 shrink-0" />
                          )}
                          {rawEv.isCompleted && (
                            <CheckCircle className="w-3 h-3 text-emerald-300/90 shrink-0" />
                          )}
                          <span className="text-[10.5px] font-[370] text-white/46 shrink-0 tabular-nums tracking-[0.032em]">
                            {displayStart}
                          </span>
                          <span
                            className={`text-[11.5px] font-[450] truncate tracking-[0.014em] ${
                              rawEv.isCompleted
                                ? 'line-through text-white/34'
                                : 'text-[#f2f4f8]'
                            }`}
                          >
                            {rawEv.title}
                          </span>
                        </div>
                      ) : (
                        <>
                          {/* 좌측 내경에 정밀 가공된 2px 수직 주얼 인레이 바 (모든 행의 단일 좌측 정렬축 기준선) */}
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none absolute z-10 w-[2px] rounded-full ${inlayGeometryClasses} ${theme.inlayClass}`}
                          />

                          <div className="relative z-10 flex flex-col h-full overflow-hidden justify-start min-w-0">
                            {/* 1행: 미세 웨이트(370/350) + 여유로운 정폭 자간(+0.035em) 시간 킥커 */}
                            <div className="flex items-center gap-2 text-[10.5px] sm:text-[11px] tabular-nums leading-[1.4] min-w-0 tracking-[0.035em]">
                              {isComparing && proj && (
                                <>
                                  <span
                                    className={`font-[440] tracking-[0.03em] shrink-0 ${theme.accentTextClass}`}
                                    title={proj.name}
                                  >
                                    {proj.code || proj.name.slice(0, 5)}
                                  </span>
                                  <span aria-hidden="true" className="text-white/22 shrink-0">
                                    ·
                                  </span>
                                </>
                              )}

                              <span className="font-[370] text-white/52 shrink-0">
                                {primaryRangeText}
                              </span>

                              {secondaryZoneText && (
                                <>
                                  <span aria-hidden="true" className="text-white/20 shrink-0">
                                    ·
                                  </span>
                                  <span className="font-[350] tracking-[0.025em] text-white/32 truncate">
                                    {secondaryZoneText}
                                  </span>
                                </>
                              )}

                              {(checklistTotal > 0 || pos.hasConflict || rawEv.isCompleted) && (
                                <span className="ml-auto flex items-center gap-1.5 shrink-0 pl-2">
                                  {checklistTotal > 0 && (
                                    <span
                                      className="text-[10.5px] font-[360] tracking-[0.04em] text-white/34 tabular-nums"
                                      title={`체크리스트 ${checklistDone}/${checklistTotal}`}
                                    >
                                      {checklistDone}/{checklistTotal}
                                    </span>
                                  )}
                                  {pos.hasConflict && (
                                    <AlertTriangle className="w-3 h-3 text-amber-300/90" />
                                  )}
                                  {rawEv.isCompleted && (
                                    <CheckCircle className="w-3 h-3 text-emerald-300/90" />
                                  )}
                                </span>
                              )}
                            </div>

                            {/* 2행: 빛 번짐을 억제한 미세 웨이트(450) + 여유로운 행간(1.52)·자간(+0.015em) 제목 */}
                            <div
                              className={`${
                                isDayMode ? 'text-[13px] sm:text-[13.5px]' : 'text-[12px]'
                              } font-[450] leading-[1.52] ${
                                isLargeBlock ? 'mt-2' : 'mt-1.5'
                              } tracking-[0.015em] ${
                                heightPx >= 140 ? 'line-clamp-2 break-keep' : 'truncate'
                              } ${
                                rawEv.isCompleted
                                  ? 'line-through text-white/34'
                                  : 'text-[#f2f4f8]'
                              }`}
                            >
                              {rawEv.title}
                            </div>

                            {/* 3행: 중형 블록(72~91px) 1줄 장소명 */}
                            {!isLargeBlock &&
                              heightPx >= 72 &&
                              (rawEv.location || rawEv.locationAddress) && (
                                <p className="text-[10.5px] font-[370] text-white/44 mt-1.5 truncate leading-[1.45] tracking-[0.016em]">
                                  {rawEv.location || rawEv.locationAddress}
                                </p>
                              )}

                            {/* 3·4행: 대형 블록(92px+) 여유로운 층간 호흡(mt-2.5, space-y-1) 장소명 + 상세 주소 */}
                            {isLargeBlock && (rawEv.location || rawEv.locationAddress) && (
                              <div className="mt-2.5 space-y-1 min-w-0">
                                {rawEv.location && (
                                  <p
                                    className={`${
                                      isDayMode ? 'text-[11.5px]' : 'text-[11px]'
                                    } text-white/58 font-[380] leading-[1.48] truncate tracking-[0.016em]`}
                                  >
                                    {rawEv.location}
                                  </p>
                                )}
                                {rawEv.locationAddress &&
                                  (heightPx >= 108 || isDayMode || !rawEv.location) && (
                                    <p
                                      className={`${
                                        isDayMode ? 'text-[11px]' : 'text-[10.5px]'
                                      } text-white/34 font-[350] truncate leading-[1.48] tracking-[0.02em]`}
                                    >
                                      {rawEv.locationAddress}
                                    </p>
                                  )}
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      {/* 하단 리사이즈 핸들 */}
                      <div
                        onMouseDown={(e) => {
                          onSelectDate?.(col.date);
                          startInteraction(e, ev, 'resize-bottom', col.date);
                        }}
                        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/[0.05] transition-opacity duration-150"
                        title="아래로 당겨 종료 시간 조정"
                      >
                        <div className="w-5 h-0.5 rounded-full bg-white/25" />
                      </div>
                    </div>
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
