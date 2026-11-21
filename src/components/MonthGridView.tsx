import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus, X } from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import { formatLocalizedDate, getCalendarGrid, getEventDateSpan } from '../shared/dateUtils';
import { expandRecurringEventsForRange } from '../shared/recurrenceUtils';
import { hasEventConflict, timeToMinutes } from '../shared/scheduleUtils';
import {
  areShallowArraysEqual,
  useCalendarEventViewModels,
} from '../hooks/useCalendarEventViewModels';
import { useCalendarDragAndDrop } from '../hooks/useCalendarDragAndDrop';
import { useTranslation } from 'react-i18next';
import { getEventChecklistStats, LuxuryEventChip } from './common/LuxuryEventChip';
import { formatLocalizedEventFields } from '../utils/eventLocalization';

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

function getExpandedPopoverPositionClasses(
  rowIdx: number,
  rowCount: number,
  colIdx: number
): string {
  const verticalClass = rowIdx >= rowCount - 2 ? 'bottom-1' : 'top-1';
  const horizontalClass =
    colIdx <= 1
      ? 'left-1'
      : colIdx >= 5
      ? 'right-1'
      : 'left-1/2 -translate-x-1/2';
  return `${verticalClass} ${horizontalClass}`;
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
}) => {
  const { t, i18n } = useTranslation();
  const grid = useMemo(
    () => getCalendarGrid(currentYear, currentMonth),
    [currentYear, currentMonth]
  );
  const rowCount = Math.ceil(grid.length / 7) || 5;
  const isComparing = comparedProjectIds.length >= 2;

  const weekdays = useMemo(() => {
    const list = t('calendar.daysOfWeekShort', { returnObjects: true });
    return Array.isArray(list) ? (list as string[]) : WEEKDAYS;
  }, [t]);

  const [hoveredTarget, setHoveredTarget] = useState<{
    event: CalendarEventItem;
    cellDate: string;
    eventIdx: number;
  } | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const expandedPopoverRef = useRef<HTMLDivElement | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);

  const clearHoverCloseTimer = useCallback(() => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(
    (expected?: { eventId: string; cellDate: string }) => {
      clearHoverCloseTimer();
      hoverCloseTimerRef.current = window.setTimeout(() => {
        hoverCloseTimerRef.current = null;
        setHoveredTarget((prev) => {
          if (!prev) return null;
          if (
            expected &&
            (prev.event.id !== expected.eventId || prev.cellDate !== expected.cellDate)
          ) {
            return prev;
          }
          return null;
        });
      }, 140);
    },
    [clearHoverCloseTimer]
  );

  useEffect(() => {
    return () => {
      if (hoverCloseTimerRef.current !== null) {
        window.clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    clearHoverCloseTimer();
    setHoveredTarget(null);
    setExpandedDate(null);
  }, [currentYear, currentMonth, clearHoverCloseTimer]);

  useEffect(() => {
    if (!expandedDate) return;

    const handlePointerDown = (e: MouseEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (!targetEl) return;
      if (expandedPopoverRef.current && expandedPopoverRef.current.contains(targetEl)) {
        return;
      }
      if (targetEl.closest('[data-month-more-btn]')) {
        return;
      }
      setExpandedDate(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpandedDate(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [expandedDate]);

  const handleCellDragStartCallback = useCallback(() => {
    clearHoverCloseTimer();
    setHoveredTarget(null);
  }, [clearHoverCloseTimer]);

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

        const aTiming = (byEventId.get(a.id) ?? getViewModel(a)).timing;
        const bTiming = (byEventId.get(b.id) ?? getViewModel(b)).timing;

        if (!a.isAllDay && !b.isAllDay) {
          const aStartMin = timeToMinutes(aTiming.localStartTime || a.startTime || '00:00');
          const bStartMin = timeToMinutes(bTiming.localStartTime || b.startTime || '00:00');
          if (aStartMin !== bStartMin) return aStartMin - bStartMin;

          const aEndMin = timeToMinutes(aTiming.localEndTime || a.endTime || '00:00');
          const bEndMin = timeToMinutes(bTiming.localEndTime || b.endTime || '00:00');
          if (aEndMin !== bEndMin) return aEndMin - bEndMin;
        }

        const titleDiff = (a.title || '').localeCompare(b.title || '', 'ko');
        if (titleDiff !== 0) return titleDiff;

        return a.id.localeCompare(b.id);
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

  return (
    <div className="flex-1 flex flex-col h-full bg-[#111318] select-none min-h-0">
      {/* 1. 요일 헤더 */}
      <div className="h-10 grid grid-cols-7 border-b border-white/[0.06] bg-[#101218] text-center text-xs shrink-0 items-center z-10">
        {weekdays.map((day, idx) => (
          <div
            key={day + idx}
            className={
              idx === 0 || idx === 6
                ? 'text-white/68 font-medium tracking-tight'
                : 'text-white/85 font-medium tracking-tight'
            }
          >
            {day}
          </div>
        ))}
      </div>

      {/* 2. 날짜 셀 그리드 */}
      <div className="flex-1 min-h-0 relative flex flex-col">

        <div
          className={`flex-1 min-h-0 grid grid-cols-7 ${
            rowCount === 6 ? 'grid-rows-6' : 'grid-rows-5'
          } gap-px bg-white/[0.055]`}
        >
          {grid.map((cell, cellIdx) => {
            const dayEvents = eventsByDate.get(cell.date) || [];
            const isSelected = cell.date === selectedDate;
            const isDragOver = dragOverDate === cell.date;
            const isExpanded = expandedDate === cell.date && dayEvents.length > 3;
            const isHoveredCell =
              !draggedEventId && !expandedDate && hoveredTarget?.cellDate === cell.date;

            const rowIdx = Math.floor(cellIdx / 7);
            const colIdx = cellIdx % 7;

            const activeTooltipEvent = isHoveredCell ? hoveredTarget.event : null;
            const activeTooltipVm = activeTooltipEvent
              ? byEventId.get(activeTooltipEvent.id) ?? getViewModel(activeTooltipEvent)
              : undefined;
            const tooltipTiming = activeTooltipVm?.timing;
            const tooltipTheme = activeTooltipVm?.theme;
            const tooltipProject = tooltipTheme?.project;
            const localizedTooltip = activeTooltipEvent
              ? formatLocalizedEventFields(activeTooltipEvent, {
                  locale: i18n.language,
                  projectedTiming: tooltipTiming,
                })
              : null;
            const {
              total: totalChecks,
              done: doneChecks,
              rate: checkRate,
            } = getEventChecklistStats(activeTooltipEvent);

            return (
              <div
                key={cell.date}
                onClick={(e) => {
                  const targetEl = e.target as HTMLElement | null;
                  if (
                    targetEl?.closest(
                      '.luxury-event-chip, .luxury-event-card, .month-expanded-popover, .luxury-hover-tooltip, button, [role="button"]'
                    )
                  ) {
                    return;
                  }
                  clearHoverCloseTimer();
                  setHoveredTarget(null);
                  setExpandedDate(null);
                  onSelectDate(cell.date);
                  onOpenCreateEvent?.(cell.date);
                }}
                onDragOver={(e) => handleCellDragOver(e, cell.date)}
                onDragLeave={(e) => handleCellDragLeave(e, cell.date)}
                onDrop={(e) => {
                  setExpandedDate(null);
                  handleCellDrop(e, cell.date);
                }}
                className={`min-w-0 min-h-0 px-2.5 py-2 flex flex-col transition-colors duration-150 cursor-pointer relative group h-full ${
                  cell.isCurrentMonth ? 'bg-[#12141b]' : 'bg-[#0e1015] text-white/52'
                } ${
                  isExpanded
                    ? 'z-50 ring-1 ring-inset ring-white/20 bg-[#161923]'
                    : isDragOver
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

                {/* 날짜 번호 및 우측 상단 카운트 · 빠른 추가 버튼 */}
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <span
                    className={`h-[22px] px-0.5 inline-flex items-center text-[11.5px] tabular-nums tracking-[0.02em] transition-colors ${
                      cell.isToday
                        ? 'text-white font-semibold'
                        : isSelected
                        ? 'text-white font-medium'
                        : cell.isCurrentMonth
                        ? 'text-white/88 font-normal'
                        : 'text-white/50 font-normal'
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
                          <span className="text-[10.5px] font-medium text-white/68 tabular-nums tracking-[0.03em]">
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
                          className="w-5 h-5 rounded-md flex items-center justify-center text-white/65 hover:text-white hover:bg-white/[0.09] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150 cursor-pointer shrink-0"
                          title={`${cell.date} 새 일정 등록`}
                        >
                          <Plus className="w-3 h-3" strokeWidth={1.85} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* 일정 목록 (시간순 정렬 · 최대 3개 표시 + 초과 시 더보기 버튼으로 전체 확장) */}
                <div
                  className={`flex-1 min-h-0 flex flex-col ${
                    dayEvents.length > 3 ? 'gap-1' : 'gap-1.5'
                  } pt-0.5 overflow-visible`}
                >
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
                          if (!isCellDragging && !expandedDate) {
                            clearHoverCloseTimer();
                            setHoveredTarget({
                              event: ev,
                              cellDate: cell.date,
                              eventIdx,
                            });
                          }
                        }}
                        onMouseLeave={() => {
                          scheduleHoverClose({
                            eventId: ev.id,
                            cellDate: cell.date,
                          });
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          clearHoverCloseTimer();
                          setHoveredTarget(null);
                          onSelectDate(cell.date);
                          onSelectEvent(ev);
                        }}
                      />
                    );
                  })}

                  {dayEvents.length > 3 && (
                    <button
                      type="button"
                      data-month-more-btn={cell.date}
                      aria-expanded={isExpanded}
                      aria-haspopup="dialog"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHoveredTarget(null);
                        onSelectDate(cell.date);
                        setExpandedDate((prev) => (prev === cell.date ? null : cell.date));
                      }}
                      className={`h-[21px] w-full px-2 rounded-[5px] flex items-center justify-between gap-1.5 text-[10.5px] font-medium tabular-nums tracking-[0.025em] transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                        isExpanded
                          ? 'bg-white/[0.12] text-white'
                          : 'text-white/75 hover:text-white hover:bg-white/[0.07]'
                      }`}
                    >
                      <span className="truncate">
                        +{dayEvents.length - 3}건 더보기
                      </span>
                      <MoreHorizontal className="w-3.5 h-3.5 text-white/65 shrink-0" aria-hidden="true" />
                    </button>
                  )}
                </div>

                {/* 3건 초과 일정 확장 리스트 팝오버 (시간순 전체 일정) */}
                {isExpanded && (
                  <div
                    ref={expandedPopoverRef}
                    role="dialog"
                    aria-label={`${cell.date} 전체 일정 (${dayEvents.length}건)`}
                    onClick={(e) => e.stopPropagation()}
                    className={`month-expanded-popover luxury-glass-border absolute ${getExpandedPopoverPositionClasses(
                      rowIdx,
                      rowCount,
                      colIdx
                    )} w-[268px] sm:w-[296px] max-h-[min(340px,52vh)] rounded-xl bg-gradient-to-b from-[#171b25]/98 via-[#12151e]/98 to-[#0e1118]/98 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.88),0_8px_20px_-4px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.07)] flex flex-col overflow-hidden z-50 transition-opacity duration-150 ${
                      isCellDragging ? 'pointer-events-none opacity-30' : ''
                    }`}
                  >
                    <div className="px-3.5 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2 shrink-0">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="text-[12.5px] font-semibold text-white tracking-tight truncate">
                          {formatLocalizedDate(cell.date, i18n.language, {
                            month: 'long',
                            day: 'numeric',
                            weekday: 'short',
                          })}
                        </span>
                        <span className="text-[11px] text-white/50 tabular-nums shrink-0">
                          · {dayEvents.length}건
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {onOpenCreateEvent && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedDate(null);
                              onSelectDate(cell.date);
                              onOpenCreateEvent(cell.date);
                            }}
                            title={`${cell.date} 새 일정 등록`}
                            aria-label={`${cell.date} 새 일정 등록`}
                            className="w-6 h-6 rounded-md flex items-center justify-center text-white/65 hover:text-white hover:bg-white/[0.08] transition-colors duration-150 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" strokeWidth={1.85} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedDate(null);
                          }}
                          title="닫기"
                          aria-label="확장 리스트 닫기"
                          className="w-6 h-6 rounded-md flex items-center justify-center text-white/65 hover:text-white hover:bg-white/[0.08] transition-colors duration-150 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" strokeWidth={1.85} />
                        </button>
                      </div>
                    </div>

                    <div className="p-2.5 overflow-y-auto flex-1 min-h-0 flex flex-col gap-1.5">
                      {dayEvents.map((ev) => {
                        const vm = byEventId.get(ev.id) ?? getViewModel(ev);
                        const isBeingDragged = draggedEventId === ev.id;
                        const isEvSelected = selectedEvent?.id === ev.id;
                        const chipTimeLabel = ev.isAllDay
                          ? '종일'
                          : vm.timing.localStartTime || ev.startTime;

                        return (
                          <LuxuryEventChip
                            key={`expanded-${ev.id}`}
                            event={ev}
                            theme={vm.theme}
                            size="sm"
                            timeLabel={chipTimeLabel}
                            showProjectBadge={isComparing}
                            showCompletionIcon
                            hasConflict={conflictingEventIds.has(ev.id)}
                            showChecklistBadge
                            isSelected={isEvSelected}
                            isDragging={isBeingDragged}
                            isAnyDragging={isCellDragging}
                            draggable
                            onDragStart={(e) => handleCellDragStart(e, ev.id)}
                            onDragEnd={handleCellDragEnd}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedDate(null);
                              onSelectDate(cell.date);
                              onSelectEvent(ev);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 초 럭셔리 에디토리얼 요약 호버 카드 (여유로운 행간·자간 및 미세 웨이트 조판) */}
                {activeTooltipEvent && hoveredTarget && localizedTooltip && (
                  <div
                    role="tooltip"
                    onMouseEnter={clearHoverCloseTimer}
                    onMouseLeave={() =>
                      scheduleHoverClose({
                        eventId: activeTooltipEvent.id,
                        cellDate: cell.date,
                      })
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      clearHoverCloseTimer();
                      setHoveredTarget(null);
                      onSelectDate(cell.date);
                      onSelectEvent(activeTooltipEvent);
                    }}
                    className={`luxury-hover-tooltip absolute ${getTooltipPositionClasses(
                      rowIdx,
                      rowCount,
                      colIdx,
                      hoveredTarget.eventIdx
                    )} w-[292px] z-50 cursor-pointer ${
                      isCellDragging ? 'pointer-events-none' : ''
                    }`}
                  >
                    {/* 칩과 상세 카드 사이의 미세 간격을 이어주는 투명 호버 브리지 */}
                    <div
                      aria-hidden="true"
                      className={`absolute inset-x-0 h-3 ${
                        rowIdx >= rowCount - 2 ? '-bottom-2.5' : '-top-2.5'
                      }`}
                    />
                    <div className="luxury-glass-border relative rounded-xl bg-gradient-to-b from-[#171b25]/96 via-[#12151e]/96 to-[#0e1118]/98 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.86),0_8px_20px_-4px_rgba(0,0,0,0.58),inset_0_1px_0_0_rgba(255,255,255,0.07)] p-4 overflow-hidden">
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
                          className={`text-[13px] font-medium leading-[1.54] tracking-[0.015em] line-clamp-2 break-keep ${
                            activeTooltipEvent.isCompleted
                              ? 'text-white/62 line-through'
                              : 'text-white'
                          }`}
                        >
                          {localizedTooltip.title}
                        </p>
                        {activeTooltipEvent.isCompleted && (
                          <span className="text-[10px] font-medium tracking-[0.025em] text-white/70 shrink-0 mt-0.5">
                            {localizedTooltip.statusLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 미세 중성 헤어라인 구분선 */}
                    <div className="h-px my-3 bg-white/[0.065]" />

                    {/* 좌측 고정 라벨 + 단일 좌측 정렬 값 그리드 (여유로운 층간 호흡 gap-y-2.5) */}
                    <div className="grid grid-cols-[58px_1fr] gap-x-3.5 gap-y-2.5 text-[11px] items-baseline">
                      <span className="font-normal text-white/70 tracking-[0.025em]">
                        {t('calendar.time', '시간')}
                      </span>
                      <span className="font-medium tabular-nums text-white tracking-[0.032em] leading-[1.5] whitespace-nowrap">
                        {localizedTooltip.timeLabel}
                      </span>

                      <span className="font-normal text-white/70 tracking-[0.025em]">
                        {t('calendar.categoryLabel', '분류')}
                      </span>
                      <span className="font-normal text-white/92 tracking-[0.015em] leading-[1.5] truncate">
                        {localizedTooltip.category}
                      </span>

                      {activeTooltipEvent.recurrence && (
                        <>
                          <span className="font-normal text-white/70 tracking-[0.025em]">
                            {t('calendar.repeat', '반복')}
                          </span>
                          <span className="font-normal tabular-nums text-white/90 tracking-[0.02em] leading-[1.5] truncate">
                            {localizedTooltip.recurrenceLabel}
                          </span>
                        </>
                      )}

                      {!activeTooltipEvent.isAllDay &&
                        tooltipTiming &&
                        !tooltipTiming.isSameZone && (
                          <>
                            <span className="font-normal text-white/70 tracking-[0.025em]">
                              {t('calendar.timezone', '표준시')}
                            </span>
                            <span className="font-normal tabular-nums text-white/85 tracking-[0.025em] leading-[1.5] truncate">
                              {tooltipTiming.sourceRangeWithCode} · {tooltipTiming.sourceMeta.cityKo}
                            </span>
                          </>
                        )}

                      <span className="font-normal text-white/70 tracking-[0.025em]">
                        {t('calendar.project', '프로젝트')}
                      </span>
                      {tooltipProject ? (
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-[5px] h-[5px] rounded-full shrink-0 ${
                              tooltipTheme?.dotClass || 'bg-neutral-300'
                            }`}
                          />
                          <span className="font-normal text-white/92 truncate tracking-[0.015em] leading-[1.5]">
                            {tooltipProject.name}
                          </span>
                        </div>
                      ) : (
                        <span className="font-normal text-white/62 tracking-[0.02em]">
                          {t('common.unassigned', '미지정')}
                        </span>
                      )}

                      {(activeTooltipEvent.location ||
                        activeTooltipEvent.locationAddress) && (
                        <>
                          <span className="font-normal text-white/70 tracking-[0.025em]">
                            {t('calendar.location', '장소')}
                          </span>
                          <div className="min-w-0 space-y-1 text-left">
                            <p className="font-normal text-white/92 leading-[1.54] tracking-[0.015em] line-clamp-2 break-keep">
                              {activeTooltipEvent.location ||
                                activeTooltipEvent.locationAddress}
                            </p>
                            {activeTooltipEvent.location &&
                              activeTooltipEvent.locationAddress && (
                                <p className="text-[10.5px] font-normal text-white/72 leading-[1.5] tracking-[0.02em] line-clamp-2 break-keep">
                                  {activeTooltipEvent.locationAddress}
                                </p>
                              )}
                          </div>
                        </>
                      )}

                      <span className="font-normal text-white/70 tracking-[0.025em]">
                        {t('calendar.checklist', '체크리스트')}
                      </span>
                      {totalChecks > 0 ? (
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2 tabular-nums whitespace-nowrap">
                            <span className="text-white font-medium tracking-[0.03em]">
                              {checkRate}%
                            </span>
                            <span className="text-[10.5px] font-normal text-white/72 tracking-[0.035em]">
                              {doneChecks}/{totalChecks}
                            </span>
                          </div>
                          <div className="mt-2 w-full h-[1.5px] rounded-full bg-white/[0.12] overflow-hidden">
                            <div
                              style={{
                                width: `${Math.max(checkRate > 0 ? 5 : 0, checkRate)}%`,
                              }}
                              className="h-full rounded-full bg-white/90"
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="font-normal text-white/62 tracking-[0.02em]">항목 없음</span>
                      )}
                    </div>
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
    prev.onSelectDate === next.onSelectDate &&
    prev.onSelectEvent === next.onSelectEvent &&
    prev.onMoveEventDate === next.onMoveEventDate &&
    prev.onOpenCreateEvent === next.onOpenCreateEvent &&
    areShallowArraysEqual(prev.events, next.events) &&
    areShallowArraysEqual(prev.projects, next.projects) &&
    areShallowArraysEqual(prev.comparedProjectIds, next.comparedProjectIds)
  );
}

export const MonthGridView = React.memo(MonthGridViewComponent, areMonthGridViewPropsEqual);
