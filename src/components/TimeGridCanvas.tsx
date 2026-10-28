import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { Calendar, MapPin, CheckCircle, AlertTriangle, Sparkles } from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import { layoutTimeEvents, PositionedEvent } from '../utils/timeGridLayout';
import { minutesToTime } from '../shared/scheduleUtils';
import {
  formatClockInTimeZone,
  projectEventToViewerTimeZone,
  ResolvedEventTiming,
  toViewerProjectedEvent,
} from '../shared/timeZoneUtils';
import { useTimelineInteractions } from '../hooks/useTimelineInteractions';
import { resolveEventLuxuryTheme } from '../utils/eventTheme';

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

export const TimeGridCanvas: React.FC<TimeGridCanvasProps> = ({
  columns,
  variant,
  viewerTimeZone,
  startHour = 7,
  endHour = 23,
  pxPerHour = 64,
  selectedEvent,
  projects = [],
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

  const columnDates = useMemo(() => columns.map((c) => c.date), [columns]);

  const { rawEventsById, timingById } = useMemo(() => {
    const rawMap = new Map<string, CalendarEventItem>();
    const timingMap = new Map<string, ResolvedEventTiming>();
    for (const col of columns) {
      for (const ev of col.events) {
        rawMap.set(ev.id, ev);
        timingMap.set(ev.id, projectEventToViewerTimeZone(ev, viewerTimeZone));
      }
    }
    return { rawEventsById: rawMap, timingById: timingMap };
  }, [columns, viewerTimeZone]);

  const handleSelectProjectedEvent = useCallback(
    (projectedEv: CalendarEventItem) => {
      onSelectEvent(rawEventsById.get(projectedEv.id) || projectedEv);
    },
    [onSelectEvent, rawEventsById]
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
      const projectedList = col.events.map((ev) => toViewerProjectedEvent(ev, viewerTimeZone));
      map.set(col.date, layoutTimeEvents(projectedList, startHour, pxPerHour));
    }
    return map;
  }, [columns, viewerTimeZone, startHour, pxPerHour]);

  const viewerNowClock = formatClockInTimeZone(new Date(), viewerTimeZone);
  const nowMinutes = viewerNowClock.hour24 * 60 + viewerNowClock.minute;
  const isNowInGrid = nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60;
  const nowTopPx = ((nowMinutes - startHour * 60) * pxPerHour) / 60;

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
        {/* 좌측 현재 위치 기준 단일 시간 축 */}
        <div
          className={`${
            isDayMode ? 'w-16 sm:w-20' : 'w-14 sm:w-16'
          } border-r border-white/[0.07] shrink-0 bg-[#0f1118]/80 select-none`}
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
                    isDayMode ? 'pr-3' : 'pr-2'
                  } text-right pointer-events-none`}
                >
                  <span
                    className={`${
                      isDayMode ? 'text-[11px]' : 'text-[10px]'
                    } text-neutral-500 font-mono font-medium block tabular-nums leading-tight`}
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
            isDayMode ? '' : 'grid grid-cols-7 divide-x divide-white/[0.06]'
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
                    ? 'bg-white/[0.035] ring-1 ring-inset ring-white/[0.14]'
                    : !isDayMode && col.isSelected
                    ? 'bg-white/[0.015]'
                    : !isDayMode
                    ? 'hover:bg-white/[0.01]'
                    : ''
                }`}
              >
                {/* 1시간 실선 + 30분 점선 가이드 */}
                {hours.map((h, i) => (
                  <div
                    key={h}
                    style={{ top: `${i * pxPerHour}px` }}
                    className="absolute left-0 right-0 border-t border-white/[0.05] pointer-events-none"
                  >
                    <div
                      style={{ top: `${pxPerHour / 2}px` }}
                      className="absolute left-0 right-0 border-t border-dashed border-white/[0.022]"
                    />
                  </div>
                ))}

                {/* 타 날짜로 드래그 이동 중일 때 대상 컬럼에 표시되는 럭셔리 글래스 프리뷰 카드 */}
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
                        isDayMode ? 'left-2.5 right-2.5 px-3 py-1.5' : 'left-1 right-1 px-2 py-1'
                      } rounded-lg z-40 pointer-events-none flex flex-col justify-center overflow-hidden ${
                        activeInteraction.currentDate !== activeInteraction.originalEvent.date
                          ? 'luxury-glass-border bg-gradient-to-b from-[#1e2332]/92 via-[#141824]/90 to-[#0e111a]/95 backdrop-blur-xl shadow-[0_18px_40px_-10px_rgba(0,0,0,0.85)]'
                          : 'bg-white/[0.05] border border-white/25 border-dashed backdrop-blur-xs'
                      }`}
                    >
                      {activeInteraction.currentDate !== activeInteraction.originalEvent.date && (
                        <span className="text-[11px] font-semibold text-neutral-100 truncate leading-tight">
                          {activeInteraction.originalEvent.title}
                        </span>
                      )}
                      <span className="text-[10px] font-mono font-medium text-neutral-300 tabular-nums truncate">
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
                    <div className="flex-1 h-px bg-rose-500/85" />
                  </div>
                )}

                {/* 일간 뷰 빈 상태 안내 */}
                {isDayMode && positioned.length === 0 && !activeInteraction && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6">
                    <div className="pointer-events-auto text-center p-6 bg-[#131620]/90 backdrop-blur-md rounded-2xl border border-white/[0.08] max-w-sm space-y-3">
                      <Calendar className="w-7 h-7 text-neutral-500 mx-auto" strokeWidth={1.6} />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-neutral-200">
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

                {/* 배치된 시간제 이벤트 블록 (Smoked Obsidian + Zero-Pill + 2단 장소/주소 위계) */}
                {positioned.map((pos) => {
                  const ev = pos.event; // projected event in viewerTimeZone
                  const rawEv = rawEventsById.get(ev.id) || ev;
                  const timing = timingById.get(ev.id);
                  const isEvSelected = selectedEvent?.id === ev.id;
                  const isInteracting = activeInteraction?.eventId === ev.id;
                  const isInteractingAndMoved = Boolean(
                    isInteracting && activeInteraction?.hasMoved
                  );

                  const theme = resolveEventLuxuryTheme(rawEv, projects);
                  const proj = theme.project;

                  const widthPercent = 100 / pos.totalColumns;
                  const leftPercent = pos.column * widthPercent;
                  const padPx = isDayMode ? 6 : 2.5;

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

                  const isCompactBlock = heightPx < 44 || (!isDayMode && durationMin < 40);
                  const isTallBlock = heightPx >= 78;

                  const shortTimeLabel =
                    !isMovedInSameDate && timing ? timing.compactStartLabel : displayStart;
                  const fullRangeLabel =
                    !isMovedInSameDate && timing
                      ? timing.rangeLabel
                      : `${displayStart} – ${displayEnd}`;

                  const checklistTotal = rawEv.checklist?.length || 0;
                  const checklistDone = rawEv.checklist?.filter((c) => c.done).length || 0;

                  return (
                    <div
                      key={ev.id}
                      onMouseDown={(e) => {
                        onSelectDate?.(col.date);
                        startInteraction(e, ev, 'drag', col.date);
                      }}
                      style={{
                        top: `${topPx}px`,
                        height: `${heightPx}px`,
                        left: `calc(${leftPercent}% + ${padPx}px)`,
                        width: `calc(${widthPercent}% - ${padPx * 2}px)`,
                      }}
                      className={`group absolute ${
                        isDayMode ? 'rounded-xl px-3.5 py-2' : 'rounded-lg px-2.5 py-1.5'
                      } transition-[box-shadow,border-color,background-color,opacity] duration-150 cursor-grab active:cursor-grabbing z-10 flex flex-col justify-between overflow-hidden select-none border ${
                        theme.blockSurfaceClass
                      } ${
                        isEvSelected && !isMovedToOtherDate
                          ? `${theme.selectedSurfaceClass} z-30`
                          : ''
                      } ${
                        isMovedToOtherDate
                          ? 'opacity-25 border-dashed pointer-events-none'
                          : isMovedInSameDate
                          ? 'z-50 shadow-2xl ring-1 ring-white/40 opacity-95'
                          : ''
                      } ${rawEv.isCompleted && !isMovedToOtherDate ? 'opacity-65' : ''}`}
                    >
                      {/* 상단 리사이즈 핸들 */}
                      <div
                        onMouseDown={(e) => {
                          onSelectDate?.(col.date);
                          startInteraction(e, ev, 'resize-top', col.date);
                        }}
                        className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/[0.12] transition-opacity duration-150"
                        title="위로 당겨 시작 시간 조정"
                      >
                        <div className="w-6 h-0.5 rounded-full bg-white/40" />
                      </div>

                      {isCompactBlock ? (
                        <div className="flex items-center gap-1.5 w-full overflow-hidden leading-tight my-auto">
                          <span
                            className={`w-[5px] h-[5px] rounded-full shrink-0 ${theme.dotClass}`}
                          />
                          {pos.hasConflict && (
                            <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                          )}
                          {rawEv.isCompleted && (
                            <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                          )}
                          <span className="text-[10px] font-mono text-neutral-400 shrink-0 tabular-nums">
                            {shortTimeLabel}
                          </span>
                          <span
                            className={`text-[11px] font-medium truncate tracking-[0.005em] ${
                              rawEv.isCompleted
                                ? 'line-through text-neutral-500'
                                : 'text-neutral-100'
                            }`}
                          >
                            {rawEv.title}
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col h-full overflow-hidden justify-start min-w-0">
                          {/* 1열: 무박스 에디토리얼 메타데이터 킥커 (Zero-Pill) */}
                          <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums text-neutral-400 leading-none min-w-0">
                            <span
                              className={`w-[5px] h-[5px] rounded-full shrink-0 ${theme.dotClass}`}
                            />
                            {proj && (
                              <>
                                <span
                                  className={`font-medium shrink-0 tracking-tight ${theme.accentTextClass}`}
                                  title={proj.name}
                                >
                                  {proj.code || proj.name.slice(0, 5)}
                                </span>
                                <span aria-hidden="true" className="text-neutral-600 shrink-0">
                                  ·
                                </span>
                              </>
                            )}
                            <span className="truncate">
                              {fullRangeLabel}
                              {isDayMode ? ` · ${durationMin}분` : ''}
                            </span>
                            {(pos.hasConflict || rawEv.isCompleted) && (
                              <span className="ml-auto flex items-center gap-1 shrink-0 pl-1">
                                {pos.hasConflict && (
                                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                                )}
                                {rawEv.isCompleted && (
                                  <CheckCircle className="w-3 h-3 text-emerald-400" />
                                )}
                              </span>
                            )}
                          </div>

                          {/* 2열: 일정 제목 */}
                          <div
                            className={`${
                              isDayMode ? 'text-xs sm:text-sm' : 'text-[11.5px]'
                            } font-semibold leading-snug truncate mt-1 tracking-[0.005em] ${
                              rawEv.isCompleted
                                ? 'line-through text-neutral-500'
                                : 'text-neutral-100'
                            }`}
                          >
                            {rawEv.title}
                          </div>

                          {/* 3열: 중형 블록(62~77px) 1줄 공식 장소명 / 대형 블록(78px+) 2단 공식 장소명 + 상세 주소 */}
                          {!isTallBlock &&
                            heightPx >= 62 &&
                            (rawEv.location || rawEv.locationAddress) && (
                              <div className="flex items-center gap-1 text-[10px] text-neutral-400 mt-0.5 truncate">
                                <MapPin className="w-2.5 h-2.5 text-neutral-500 shrink-0" />
                                <span className="truncate">
                                  {rawEv.location || rawEv.locationAddress}
                                </span>
                              </div>
                            )}

                          {isTallBlock && (rawEv.location || rawEv.locationAddress) && (
                            <div className="mt-1.5 space-y-0.5 min-w-0">
                              {rawEv.location && (
                                <div
                                  className={`flex items-center gap-1 ${
                                    isDayMode ? 'text-xs' : 'text-[10.5px]'
                                  } text-neutral-300 font-medium truncate`}
                                >
                                  <MapPin className="w-3 h-3 text-neutral-500 shrink-0" />
                                  <span className="truncate">{rawEv.location}</span>
                                </div>
                              )}
                              {rawEv.locationAddress &&
                                (heightPx >= 94 || isDayMode || !rawEv.location) && (
                                  <p
                                    className={`${
                                      rawEv.location ? 'pl-4' : ''
                                    } text-[10px] text-neutral-500 truncate leading-tight`}
                                  >
                                    {rawEv.locationAddress}
                                  </p>
                                )}
                            </div>
                          )}

                          {/* 하단 보조: 여유 높이가 충분할 때 체크리스트 완료 수 표기 */}
                          {checklistTotal > 0 && heightPx >= 112 && (
                            <div className="mt-auto pt-1 flex items-center justify-end text-[10px] font-mono tabular-nums text-neutral-500">
                              <span>
                                체크리스트 {checklistDone}/{checklistTotal}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 하단 리사이즈 핸들 */}
                      <div
                        onMouseDown={(e) => {
                          onSelectDate?.(col.date);
                          startInteraction(e, ev, 'resize-bottom', col.date);
                        }}
                        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/[0.12] transition-opacity duration-150"
                        title="아래로 당겨 종료 시간 조정"
                      >
                        <div className="w-6 h-0.5 rounded-full bg-white/40" />
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
