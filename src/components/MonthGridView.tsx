import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import { getCalendarGrid, getEventDateSpan } from '../shared/dateUtils';
import {
  expandRecurringEventsForRange,
  formatRecurrenceLabel,
} from '../shared/recurrenceUtils';
import { hasEventConflict } from '../shared/scheduleUtils';
import {
  areShallowArraysEqual,
  useCalendarEventViewModels,
} from '../hooks/useCalendarEventViewModels';
import { useCalendarDragAndDrop } from '../hooks/useCalendarDragAndDrop';
import { getEventChecklistStats, LuxuryEventChip } from './common/LuxuryEventChip';

interface MonthGridViewProps {
  currentYear: number;
  currentMonth: number;
  selectedDate: string;
  selectedEvent?: CalendarEventItem | null;
  events: CalendarEventItem[];
  viewerTimeZone: string;
  onSelectDate: (date: string) => void;
  onSelectEvent: (event: CalendarEventItem) => void;
  onMoveEventDate: (eventId: string, targetDate: string) => void;
  onOpenCreateEvent?: (date: string) => void;
  projects?: ProjectItem[];
  comparedProjectIds?: string[];
  emptyGuideText?: string;
  isWorkspaceEmpty?: boolean;
  onLoadSampleData?: () => void;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 호버 요약 카드 위치 결정:
 * - 하단 2개 행(openUpward)에서는 셀 상단 경계 밖(bottom-full mb-1.5)으로 띄워 셀 내부 날짜(예: 28)와 호버된 칩을 전혀 가리지 않도록 설계
 * - 상단 행에서는 호버된 24px 칩 바로 아래에 6px 여유를 두고 배치
 */
function getTooltipPositionClasses(
  rowIdx: number,
  rowCount: number,
  colIdx: number,
  eventIdx: number
): string {
  const openUpward = rowIdx >= rowCount - 2;
  const alignRight = colIdx >= 5;
  const horizontalClass = alignRight ? 'right-2' : 'left-2';

  if (openUpward) {
    return `${horizontalClass} bottom-full mb-1.5`;
  }

  const downwardTopClass =
    eventIdx === 0
      ? 'top-[66px]'
      : eventIdx === 1
      ? 'top-[97px]'
      : 'top-[128px]';
  return `${horizontalClass} ${downwardTopClass}`;
}

const MonthGridViewComponent: React.FC<MonthGridViewProps> = ({
  currentYear,
  currentMonth,
  selectedDate,
  selectedEvent = null,
  events,
  viewerTimeZone,
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
  const grid = useMemo(
    () => getCalendarGrid(currentYear, currentMonth),
    [currentYear, currentMonth]
  );
  const rowCount = Math.ceil(grid.length / 7) || 5;
  const isComparing = comparedProjectIds.length >= 2;

  const [hoveredTarget, setHoveredTarget] = useState<{
    event: CalendarEventItem;
    cellDate: string;
    eventIdx: number;
  } | null>(null);

  const handleCellDragStartCallback = useCallback(() => {
    setHoveredTarget(null);
  }, []);

  const {
    draggedEventId,
    dragOverDate,
    isCellDragging,
    handleCellDragStart,
    handleCellDragEnd,
    handleCellDragOver,
    handleCellDragLeave,
    handleCellDrop,
  } = useCalendarDragAndDrop({
    onMoveEventDate,
    onCellDragStart: handleCellDragStartCallback,
  });

  const expandedEvents = useMemo(
    () =>
      grid.length > 0
        ? expandRecurringEventsForRange(events, grid[0].date, grid[grid.length - 1].date)
        : events,
    [events, grid]
  );

  const { byEventId, projectThemesById, getViewModel } = useCalendarEventViewModels({
    events: expandedEvents,
    projects,
    viewerTimeZone,
  });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const ev of expandedEvents) {
      const timing = (byEventId.get(ev.id) ?? getViewModel(ev)).timing;
      const spanDates = getEventDateSpan(timing.localDate, ev.endDate);
      for (const cellDate of spanDates) {
        const list = map.get(cellDate);
        if (list) {
          list.push(ev);
        } else {
          map.set(cellDate, [ev]);
        }
      }
    }
    map.forEach((list) => {
      list.sort((a, b) => {
        if (a.isAllDay && !b.isAllDay) return -1;
        if (!a.isAllDay && b.isAllDay) return 1;
        const aStart = (byEventId.get(a.id) ?? getViewModel(a)).timing.localStartTime;
        const bStart = (byEventId.get(b.id) ?? getViewModel(b)).timing.localStartTime;
        return aStart.localeCompare(bStart);
      });
    });
    return map;
  }, [expandedEvents, byEventId, getViewModel]);

  const conflictingEventIds = useMemo(() => {
    const set = new Set<string>();
    eventsByDate.forEach((dayList) => {
      if (dayList.length < 2) return;
      const projectedDay = dayList.map(
        (ev) => (byEventId.get(ev.id) ?? getViewModel(ev)).projectedEvent
      );
      for (const projEv of projectedDay) {
        if (!projEv.isAllDay && hasEventConflict(projEv, projectedDay)) {
          set.add(projEv.id);
        }
      }
    });
    return set;
  }, [eventsByDate, byEventId, getViewModel]);

  const visibleEventCount = useMemo(
    () =>
      grid.reduce((sum, cell) => sum + (eventsByDate.get(cell.date)?.length || 0), 0),
    [grid, eventsByDate]
  );
  const isMonthEmpty = visibleEventCount === 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#111318] select-none min-h-0">
      {/* 1. 요일 헤더 */}
      <div className="h-10 grid grid-cols-7 border-b border-white/[0.06] bg-[#101218] text-center text-xs shrink-0 items-center z-10">
        {WEEKDAYS.map((day, idx) => (
          <div
            key={day}
            className={
              idx === 0 || idx === 6
                ? 'text-white/32 font-normal tracking-tight'
                : 'text-white/50 font-medium tracking-tight'
            }
          >
            {day}
          </div>
        ))}
      </div>

      {/* 2. 날짜 셀 그리드 */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        {isMonthEmpty && emptyGuideText && !draggedEventId && (
          <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center px-6">
            {isWorkspaceEmpty && onLoadSampleData ? (
              <div className="pointer-events-auto max-w-sm rounded-2xl bg-[#12151e]/92 backdrop-blur-md border border-white/[0.08] px-6 py-5 text-center space-y-3 shadow-[0_24px_56px_-16px_rgba(0,0,0,0.75)]">
                <div className="space-y-1">
                  <p className="text-xs sm:text-[13px] font-medium text-neutral-200 tracking-tight">
                    현재 등록된 일정이 없습니다
                  </p>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    좌측 컨시어지에 일정을 지시하거나, 사용법 학습을 위한 가상 샘플 일정을 불러와 체험해 보세요.
                  </p>
                </div>
                <div className="pt-0.5 flex flex-col items-center gap-2">
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {onOpenCreateEvent && (
                      <button
                        type="button"
                        onClick={() => onOpenCreateEvent(selectedDate)}
                        className="h-9 px-4 rounded-xl bg-white text-neutral-950 hover:bg-neutral-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5 shrink-0" />
                        <span>새 일정 직접 등록</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onLoadSampleData}
                      className="h-9 px-4 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.11] text-xs font-medium text-neutral-100 inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                      <span>학습용 샘플 데이터 불러오기</span>
                    </button>
                  </div>
                  <span className="text-[10.5px] text-neutral-500">
                    셀 더블클릭 또는 N 키로 즉시 등록 · 샘플은 언제든 비우기 가능
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
          className={`flex-1 min-h-0 grid grid-cols-7 ${
            rowCount === 6 ? 'grid-rows-6' : 'grid-rows-5'
          } gap-px bg-white/[0.055]`}
        >
          {grid.map((cell, cellIdx) => {
            const dayEvents = eventsByDate.get(cell.date) || [];
            const isSelected = cell.date === selectedDate;
            const isDragOver = dragOverDate === cell.date;
            const isHoveredCell =
              !draggedEventId && hoveredTarget?.cellDate === cell.date;

            const rowIdx = Math.floor(cellIdx / 7);
            const colIdx = cellIdx % 7;

            const activeTooltipEvent = isHoveredCell ? hoveredTarget.event : null;
            const activeTooltipVm = activeTooltipEvent
              ? byEventId.get(activeTooltipEvent.id) ?? getViewModel(activeTooltipEvent)
              : undefined;
            const tooltipTiming = activeTooltipVm?.timing;
            const tooltipTheme = activeTooltipVm?.theme;
            const tooltipProject = tooltipTheme?.project;
            const {
              total: totalChecks,
              done: doneChecks,
              rate: checkRate,
            } = getEventChecklistStats(activeTooltipEvent);

            return (
              <div
                key={cell.date}
                onClick={() => onSelectDate(cell.date)}
                onDoubleClick={(e) => {
                  const targetEl = e.target as HTMLElement | null;
                  if (
                    targetEl?.closest(
                      '.luxury-event-chip, .luxury-event-card, button, [role="button"]'
                    )
                  ) {
                    return;
                  }
                  onSelectDate(cell.date);
                  onOpenCreateEvent?.(cell.date);
                }}
                onDragOver={(e) => handleCellDragOver(e, cell.date)}
                onDragLeave={(e) => handleCellDragLeave(e, cell.date)}
                onDrop={(e) => handleCellDrop(e, cell.date)}
                className={`min-w-0 min-h-0 px-2.5 py-2 flex flex-col transition-colors duration-150 cursor-pointer relative group h-full ${
                  cell.isCurrentMonth ? 'bg-[#12141b]' : 'bg-[#0e1015] text-white/22'
                } ${
                  isDragOver
                    ? 'ring-1 ring-inset ring-white/30 bg-white/[0.05] z-30'
                    : isHoveredCell
                    ? isSelected
                      ? 'ring-1 ring-inset ring-white/[0.14] bg-[#161923] z-40'
                      : 'bg-[#151821] z-40'
                    : isSelected
                    ? 'ring-1 ring-inset ring-white/[0.14] bg-[#161923] z-10'
                    : 'hover:bg-[#141720]'
                }`}
              >
                {/* 드래그 오버 시 가이드 텍스트 */}
                {isDragOver && (
                  <div className="absolute top-2 right-2.5 z-30 pointer-events-none">
                    <span className="text-[10px] font-medium text-white/75 tracking-tight">
                      여기로 이동
                    </span>
                  </div>
                )}

                {/* 날짜 번호(절제된 글래스 링 마커) 및 우측 상단 카운트 · 빠른 추가 버튼 */}
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <span
                    className={`min-w-[22px] h-[22px] px-1.5 rounded-full inline-flex items-center justify-center text-[11.5px] tabular-nums tracking-[0.02em] transition-colors ${
                      cell.isToday
                        ? 'bg-white/[0.11] text-[#f5f7fb] ring-1 ring-inset ring-white/[0.26] font-[460]'
                        : isSelected
                        ? 'bg-white/[0.06] text-white/90 ring-1 ring-inset ring-white/[0.12] font-[450]'
                        : cell.isCurrentMonth
                        ? 'text-white/58 font-[380]'
                        : 'text-white/22 font-[360]'
                    }`}
                  >
                    {cell.dayNumber}
                  </span>

                  {!isDragOver && (
                    <div className="flex items-center gap-1 pr-0.5">
                      {dayEvents.length > 0 && (
                        <>
                          {isComparing &&
                            (() => {
                              const distinctProjIds = Array.from(
                                new Set(dayEvents.map((e) => e.projectId).filter(Boolean))
                              );
                              if (distinctProjIds.length < 2) return null;
                              return (
                                <span
                                  className="flex items-center gap-0.5 mr-0.5"
                                  title="비교 중인 프로젝트 간 일정 중첩일"
                                >
                                  {distinctProjIds.slice(0, 4).map((pid) => {
                                    const dotClass =
                                      (pid ? projectThemesById.get(pid)?.dotClass : undefined) ||
                                      'bg-[#94a3b8]';
                                    return (
                                      <span
                                        key={pid}
                                        className={`w-1.5 h-1.5 rounded-full ${dotClass}`}
                                      />
                                    );
                                  })}
                                </span>
                              );
                            })()}
                          <span className="text-[10.5px] font-[360] text-white/28 tabular-nums tracking-[0.03em]">
                            {dayEvents.length}
                          </span>
                        </>
                      )}
                      {onOpenCreateEvent && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectDate(cell.date);
                            onOpenCreateEvent(cell.date);
                          }}
                          className="w-5 h-5 rounded-md flex items-center justify-center text-white/32 hover:text-white hover:bg-white/[0.09] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150 cursor-pointer shrink-0"
                          title={`${cell.date} 새 일정 등록`}
                        >
                          <Plus className="w-3 h-3" strokeWidth={1.85} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* 일정 목록 (최대 3개 표시: 25px 여유 높이 + 미세 웨이트 450/370 + 복합 부양 레이어) */}
                <div className="flex-1 min-h-0 flex flex-col gap-1.5 pt-0.5 overflow-visible">
                  {!isMonthEmpty && isSelected && dayEvents.length === 0 && !isDragOver && (
                    <div className="flex-1 flex items-center justify-center pointer-events-none">
                      <span className="text-[11px] font-[350] text-white/24 tracking-[0.025em] select-none">
                        일정 없음
                      </span>
                    </div>
                  )}
                  {dayEvents.slice(0, 3).map((ev, eventIdx) => {
                    const vm = byEventId.get(ev.id) ?? getViewModel(ev);
                    const isBeingDragged = draggedEventId === ev.id;
                    const isEvSelected = selectedEvent?.id === ev.id;
                    const chipTimeLabel = ev.isAllDay
                      ? '종일'
                      : vm.timing.localStartTime || ev.startTime;

                    return (
                      <LuxuryEventChip
                        key={ev.id}
                        event={ev}
                        theme={vm.theme}
                        size="sm"
                        timeLabel={chipTimeLabel}
                        showProjectBadge={isComparing}
                        hasConflict={conflictingEventIds.has(ev.id)}
                        isSelected={isEvSelected}
                        isDragging={isBeingDragged}
                        isAnyDragging={isCellDragging}
                        draggable
                        onDragStart={(e) => handleCellDragStart(e, ev.id)}
                        onDragEnd={handleCellDragEnd}
                        onMouseEnter={() => {
                          if (!isCellDragging) {
                            setHoveredTarget({
                              event: ev,
                              cellDate: cell.date,
                              eventIdx,
                            });
                          }
                        }}
                        onMouseLeave={() => {
                          setHoveredTarget((prev) =>
                            prev?.event.id === ev.id && prev?.cellDate === cell.date
                              ? null
                              : prev
                          );
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setHoveredTarget(null);
                          onSelectDate(cell.date);
                          onSelectEvent(ev);
                        }}
                      />
                    );
                  })}

                  {dayEvents.length > 3 && (
                    <span className="text-[10.5px] font-[360] text-white/34 tabular-nums pl-2.5 shrink-0 tracking-[0.025em]">
                      +{dayEvents.length - 3}건 더보기
                    </span>
                  )}
                </div>

                {/* 초 럭셔리 에디토리얼 요약 호버 카드 (여유로운 행간·자간 및 미세 웨이트 조판) */}
                {activeTooltipEvent && hoveredTarget && (
                  <div
                    role="tooltip"
                    className={`luxury-glass-border pointer-events-none absolute ${getTooltipPositionClasses(
                      rowIdx,
                      rowCount,
                      colIdx,
                      hoveredTarget.eventIdx
                    )} w-[292px] rounded-xl bg-gradient-to-b from-[#171b25]/96 via-[#12151e]/96 to-[#0e1118]/98 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.86),0_8px_20px_-4px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(255,255,255,0.07)] p-4 z-50 overflow-hidden`}
                  >
                    {/* 상단: 주얼 인레이 + 일정 제목 */}
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className={`w-[2px] h-4 mt-0.5 rounded-full shrink-0 ${
                          tooltipTheme?.inlayClass || 'bg-neutral-300'
                        }`}
                      />
                      <div className="flex-1 min-w-0 flex items-start justify-between gap-2.5">
                        <p
                          className={`text-[13px] font-[460] leading-[1.54] tracking-[0.015em] line-clamp-2 break-keep ${
                            activeTooltipEvent.isCompleted
                              ? 'text-white/40 line-through'
                              : 'text-[#f2f4f8]'
                          }`}
                        >
                          {activeTooltipEvent.title}
                        </p>
                        {activeTooltipEvent.isCompleted && (
                          <span className="text-[10px] font-[380] tracking-[0.025em] text-white/42 shrink-0 mt-0.5">
                            완료
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 미세 중성 헤어라인 구분선 */}
                    <div className="h-px my-3 bg-white/[0.065]" />

                    {/* 좌측 고정 라벨 + 단일 좌측 정렬 값 그리드 (여유로운 층간 호흡 gap-y-2.5) */}
                    <div className="grid grid-cols-[58px_1fr] gap-x-3.5 gap-y-2.5 text-[11px] items-baseline">
                      <span className="font-[360] text-white/38 tracking-[0.025em]">시간</span>
                      <span className="font-[400] tabular-nums text-[#f1f3f7] tracking-[0.032em] leading-[1.5] whitespace-nowrap">
                        {activeTooltipEvent.isAllDay
                          ? '종일'
                          : tooltipTiming
                          ? `${tooltipTiming.localStartTime} – ${tooltipTiming.localEndTime}`
                          : `${activeTooltipEvent.startTime} – ${activeTooltipEvent.endTime}`}
                      </span>

                      {activeTooltipEvent.recurrence && (
                        <>
                          <span className="font-[360] text-white/38 tracking-[0.025em]">반복</span>
                          <span className="font-[380] tabular-nums text-white/74 tracking-[0.02em] leading-[1.5] truncate">
                            {formatRecurrenceLabel(activeTooltipEvent.recurrence)}
                          </span>
                        </>
                      )}

                      {!activeTooltipEvent.isAllDay &&
                        tooltipTiming &&
                        !tooltipTiming.isSameZone && (
                          <>
                            <span className="font-[360] text-white/38 tracking-[0.025em]">원천</span>
                            <span className="font-[370] tabular-nums text-white/60 tracking-[0.025em] leading-[1.5] truncate">
                              {tooltipTiming.sourceRangeWithCode} · {tooltipTiming.sourceMeta.cityKo}
                            </span>
                          </>
                        )}

                      <span className="font-[360] text-white/38 tracking-[0.025em]">프로젝트</span>
                      {tooltipProject ? (
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-[5px] h-[5px] rounded-full shrink-0 ${
                              tooltipTheme?.dotClass || 'bg-neutral-300'
                            }`}
                          />
                          <span className="font-[400] text-white/78 truncate tracking-[0.015em] leading-[1.5]">
                            {tooltipProject.name}
                          </span>
                        </div>
                      ) : (
                        <span className="font-[360] text-white/34 tracking-[0.02em]">미지정</span>
                      )}

                      {(activeTooltipEvent.location ||
                        activeTooltipEvent.locationAddress) && (
                        <>
                          <span className="font-[360] text-white/38 tracking-[0.025em]">장소</span>
                          <div className="min-w-0 space-y-1 text-left">
                            <p className="font-[400] text-white/80 leading-[1.54] tracking-[0.015em] line-clamp-2 break-keep">
                              {activeTooltipEvent.location ||
                                activeTooltipEvent.locationAddress}
                            </p>
                            {activeTooltipEvent.location &&
                              activeTooltipEvent.locationAddress && (
                                <p className="text-[10.5px] font-[350] text-white/38 leading-[1.5] tracking-[0.02em] line-clamp-2 break-keep">
                                  {activeTooltipEvent.locationAddress}
                                </p>
                              )}
                          </div>
                        </>
                      )}

                      <span className="font-[360] text-white/38 tracking-[0.025em]">체크리스트</span>
                      {totalChecks > 0 ? (
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2 tabular-nums whitespace-nowrap">
                            <span className="text-[#f1f3f7] font-[450] tracking-[0.03em]">
                              {checkRate}%
                            </span>
                            <span className="text-[10.5px] font-[360] text-white/38 tracking-[0.035em]">
                              {doneChecks}/{totalChecks}
                            </span>
                          </div>
                          <div className="mt-2 w-full h-[1.5px] rounded-full bg-white/[0.08] overflow-hidden">
                            <div
                              style={{
                                width: `${Math.max(checkRate > 0 ? 5 : 0, checkRate)}%`,
                              }}
                              className="h-full rounded-full bg-white/80"
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="font-[360] text-white/34 tracking-[0.02em]">항목 없음</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function areMonthGridViewPropsEqual(
  prev: MonthGridViewProps,
  next: MonthGridViewProps
): boolean {
  return (
    prev.currentYear === next.currentYear &&
    prev.currentMonth === next.currentMonth &&
    prev.selectedDate === next.selectedDate &&
    prev.selectedEvent === next.selectedEvent &&
    prev.viewerTimeZone === next.viewerTimeZone &&
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

export const MonthGridView = React.memo(MonthGridViewComponent, areMonthGridViewPropsEqual);
