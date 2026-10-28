import React, { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import { getCalendarGrid } from '../shared/dateUtils';
import {
  projectEventToViewerTimeZone,
  ResolvedEventTiming,
} from '../shared/timeZoneUtils';
import { resolveEventLuxuryTheme } from '../utils/eventTheme';

interface MonthGridViewProps {
  currentYear: number;
  currentMonth: number;
  selectedDate: string;
  events: CalendarEventItem[];
  viewerTimeZone: string;
  onSelectDate: (date: string) => void;
  onSelectEvent: (event: CalendarEventItem) => void;
  onMoveEventDate: (eventId: string, targetDate: string) => void;
  projects?: ProjectItem[];
  comparedProjectIds?: string[];
  emptyGuideText?: string;
  isWorkspaceEmpty?: boolean;
  onLoadSampleData?: () => void;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

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
    const upwardTopClass =
      eventIdx === 0
        ? 'top-[28px]'
        : eventIdx === 1
        ? 'top-[52px]'
        : 'top-[76px]';
    return `${horizontalClass} ${upwardTopClass} -translate-y-full`;
  }

  const downwardTopClass =
    eventIdx === 0
      ? 'top-[56px]'
      : eventIdx === 1
      ? 'top-[80px]'
      : 'top-[104px]';
  return `${horizontalClass} ${downwardTopClass}`;
}

export const MonthGridView: React.FC<MonthGridViewProps> = ({
  currentYear,
  currentMonth,
  selectedDate,
  events,
  viewerTimeZone,
  onSelectDate,
  onSelectEvent,
  onMoveEventDate,
  projects = [],
  comparedProjectIds = [],
  emptyGuideText,
  isWorkspaceEmpty = false,
  onLoadSampleData,
}) => {
  const grid = getCalendarGrid(currentYear, currentMonth);
  const rowCount = Math.ceil(grid.length / 7) || 5;
  const isComparing = comparedProjectIds.length >= 2;

  const [draggedEventId, setDraggedEventId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<{
    event: CalendarEventItem;
    cellDate: string;
    eventIdx: number;
  } | null>(null);

  const timingById = useMemo(() => {
    const map = new Map<string, ResolvedEventTiming>();
    for (const ev of events) {
      map.set(ev.id, projectEventToViewerTimeZone(ev, viewerTimeZone));
    }
    return map;
  }, [events, viewerTimeZone]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    events.forEach((ev) => {
      const timing = timingById.get(ev.id);
      const cellDate = timing ? timing.localDate : ev.date;
      const list = map.get(cellDate) || [];
      list.push(ev);
      map.set(cellDate, list);
    });
    map.forEach((list) => {
      list.sort((a, b) => {
        if (a.isAllDay && !b.isAllDay) return -1;
        if (!a.isAllDay && b.isAllDay) return 1;
        const aStart = timingById.get(a.id)?.localStartTime || a.startTime;
        const bStart = timingById.get(b.id)?.localStartTime || b.startTime;
        return aStart.localeCompare(bStart);
      });
    });
    return map;
  }, [events, timingById]);

  const visibleEventCount = useMemo(
    () =>
      grid.reduce((sum, cell) => sum + (eventsByDate.get(cell.date)?.length || 0), 0),
    [grid, eventsByDate]
  );
  const isMonthEmpty = visibleEventCount === 0;

  const handleDragStart = (e: React.DragEvent, eventId: string) => {
    setHoveredTarget(null);
    e.dataTransfer.setData('text/plain', eventId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedEventId(eventId);
  };

  const handleDragEnd = () => {
    setDraggedEventId(null);
    setDragOverDate(null);
  };

  const handleDragOver = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverDate !== date) {
      setDragOverDate(date);
    }
  };

  const handleDragLeave = (e: React.DragEvent, date: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverDate === date) {
      setDragOverDate(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    const eventId = e.dataTransfer.getData('text/plain') || draggedEventId;
    if (eventId) {
      onMoveEventDate(eventId, targetDate);
    }
    setDraggedEventId(null);
    setDragOverDate(null);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#111318] select-none min-h-0">
      {/* 1. 요일 헤더 */}
      <div className="h-10 grid grid-cols-7 border-b border-white/[0.06] bg-[#101218] text-center text-xs shrink-0 items-center z-10">
        {WEEKDAYS.map((day, idx) => (
          <div
            key={day}
            className={
              idx === 0 || idx === 6
                ? 'text-neutral-500 font-normal'
                : 'text-neutral-400 font-medium'
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
                    100% 가상 장소 예시 · 상단 잠금 메뉴에서 언제든 비우기 가능
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
          } gap-px bg-white/[0.06]`}
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
            const tooltipTiming = activeTooltipEvent
              ? timingById.get(activeTooltipEvent.id)
              : undefined;
            const tooltipTheme = activeTooltipEvent
              ? resolveEventLuxuryTheme(activeTooltipEvent, projects)
              : undefined;
            const tooltipProject = tooltipTheme?.project;
            const checklistItems = activeTooltipEvent?.checklist || [];
            const totalChecks = checklistItems.length;
            const doneChecks = checklistItems.filter((c) => c.done).length;
            const checkRate =
              totalChecks > 0 ? Math.round((doneChecks / totalChecks) * 100) : 0;

            return (
              <div
                key={cell.date}
                onClick={() => onSelectDate(cell.date)}
                onDragOver={(e) => handleDragOver(e, cell.date)}
                onDragLeave={(e) => handleDragLeave(e, cell.date)}
                onDrop={(e) => handleDrop(e, cell.date)}
                className={`min-w-0 min-h-0 p-2 flex flex-col transition-colors duration-150 cursor-pointer relative group h-full ${
                  cell.isCurrentMonth ? 'bg-[#12141a]' : 'bg-[#0e1015] text-neutral-600'
                } ${
                  isDragOver
                    ? 'ring-1 ring-white/40 bg-white/[0.08] z-30'
                    : isHoveredCell
                    ? isSelected
                      ? 'ring-1 ring-white/25 bg-[#171a23] z-40'
                      : 'bg-[#161922] z-40'
                    : isSelected
                    ? 'ring-1 ring-white/25 bg-[#171a23] z-10'
                    : 'hover:bg-[#161922]'
                }`}
              >
                {/* 드래그 오버 시 가이드 텍스트 */}
                {isDragOver && (
                  <div className="absolute top-1.5 right-2 z-30 pointer-events-none">
                    <span className="text-[10px] font-medium text-neutral-200">
                      여기로 이동
                    </span>
                  </div>
                )}

                {/* 날짜 번호 및 인디케이터 */}
                <div className="flex items-center justify-between mb-1 shrink-0">
                  <span
                    className={`text-xs rounded-md px-1.5 py-0.5 tabular-nums ${
                      cell.isToday
                        ? 'bg-white text-neutral-950 font-semibold'
                        : isSelected
                        ? 'text-white font-semibold bg-white/[0.09]'
                        : cell.isCurrentMonth
                        ? 'text-neutral-300 font-medium'
                        : 'text-neutral-600 font-normal'
                    }`}
                  >
                    {cell.dayNumber}
                  </span>

                  {dayEvents.length > 0 && !isDragOver && (
                    <div className="flex items-center gap-1">
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
                                const dotClass = resolveEventLuxuryTheme(
                                  { projectId: pid, category: '기타' },
                                  projects
                                ).dotClass;
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
                      <span className="text-[10px] text-neutral-500 font-mono tabular-nums">
                        {dayEvents.length}
                      </span>
                    </div>
                  )}
                </div>

                {/* 일정 목록 (최대 3개 표시) 또는 선택된 빈 날짜 미니멀 안내 */}
                <div className="flex-1 min-h-0 flex flex-col gap-1 overflow-hidden">
                  {!isMonthEmpty && isSelected && dayEvents.length === 0 && !isDragOver && (
                    <div className="flex-1 flex items-center justify-center pointer-events-none">
                      <span className="text-[11px] font-light text-neutral-600 opacity-75 tracking-tight select-none">
                        일정 없음
                      </span>
                    </div>
                  )}
                  {dayEvents.slice(0, 3).map((ev, eventIdx) => {
                    const theme = resolveEventLuxuryTheme(ev, projects);
                    const proj = theme.project;
                    const isBeingDragged = draggedEventId === ev.id;
                    const timing = timingById.get(ev.id);
                    const chipTimeLabel = ev.isAllDay
                      ? '종일'
                      : timing?.compactStartLabel || ev.startTime;

                    return (
                      <div
                        key={ev.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, ev.id)}
                        onDragEnd={handleDragEnd}
                        onMouseEnter={() => {
                          if (!draggedEventId) {
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
                        className={`h-[21px] w-full text-left px-1.5 rounded-[5px] text-[11px] truncate flex items-center gap-1.5 border transition-colors duration-150 cursor-grab active:cursor-grabbing shrink-0 ${theme.chipSurfaceClass} ${
                          isBeingDragged
                            ? 'opacity-30 scale-95 border-dashed border-white/40'
                            : ''
                        } ${ev.isCompleted && !isBeingDragged ? 'opacity-65' : ''}`}
                      >
                        <span
                          className={`w-[5px] h-[5px] rounded-full shrink-0 ${theme.dotClass}`}
                        />
                        <span className="font-mono text-[9.5px] text-neutral-400 shrink-0 tabular-nums">
                          {chipTimeLabel}
                        </span>
                        {isComparing && proj && (
                          <span
                            className={`font-mono text-[9px] shrink-0 tracking-tight ${theme.accentTextClass}`}
                          >
                            {proj.code || proj.name.slice(0, 3)}
                          </span>
                        )}
                        <span
                          className={`truncate font-medium tracking-[0.005em] ${
                            ev.isCompleted
                              ? 'line-through text-neutral-500'
                              : 'text-neutral-100'
                          }`}
                        >
                          {ev.title}
                        </span>
                      </div>
                    );
                  })}

                  {dayEvents.length > 3 && (
                    <span className="text-[10px] text-neutral-500 font-mono tabular-nums pl-1 shrink-0">
                      +{dayEvents.length - 3}건 더보기
                    </span>
                  )}
                </div>

                {/* 럭셔리 글래스모피즘 일정 요약 호버 툴팁 (장소명 + 상세 주소 포함) */}
                {activeTooltipEvent && hoveredTarget && (
                  <div
                    role="tooltip"
                    className={`luxury-glass-border pointer-events-none absolute ${getTooltipPositionClasses(
                      rowIdx,
                      rowCount,
                      colIdx,
                      hoveredTarget.eventIdx
                    )} w-64 rounded-xl bg-gradient-to-b from-[#181c27]/92 via-[#11141d]/90 to-[#0c0e15]/95 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.82),0_8px_20px_-4px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)] p-3 z-50 overflow-hidden`}
                  >
                    {/* 상단: 일정 제목 */}
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-xs font-medium leading-snug line-clamp-2 break-keep ${
                          activeTooltipEvent.isCompleted
                            ? 'text-neutral-400 line-through'
                            : 'text-neutral-100'
                        }`}
                      >
                        {activeTooltipEvent.title}
                      </p>
                      {activeTooltipEvent.isCompleted && (
                        <span className="text-[10px] text-neutral-400 shrink-0">
                          완료
                        </span>
                      )}
                    </div>

                    {/* 방향성 헤어라인 구분선 */}
                    <div className="h-px my-2 bg-gradient-to-r from-white/[0.14] via-white/[0.07] to-white/[0.02]" />

                    {/* 핵심 요약 메타데이터 (시간 · 원천 시간대 · 프로젝트 · 장소/주소 · 체크리스트) */}
                    <div className="space-y-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-neutral-500 shrink-0">시간</span>
                        <span className="font-mono tabular-nums text-neutral-100 whitespace-nowrap">
                          {activeTooltipEvent.isAllDay
                            ? '종일'
                            : tooltipTiming
                            ? `${tooltipTiming.localStartTime} – ${tooltipTiming.localEndTime}`
                            : `${activeTooltipEvent.startTime} – ${activeTooltipEvent.endTime}`}
                        </span>
                      </div>

                      {!activeTooltipEvent.isAllDay &&
                        tooltipTiming &&
                        !tooltipTiming.isSameZone && (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-neutral-500 shrink-0">원천</span>
                            <span className="font-mono tabular-nums text-neutral-300 whitespace-nowrap truncate">
                              {tooltipTiming.sourceRangeWithCode} · {tooltipTiming.sourceMeta.cityKo}
                            </span>
                          </div>
                        )}

                      <div className="flex items-center justify-between gap-3">
                        <span className="text-neutral-500 shrink-0">프로젝트</span>
                        {tooltipProject ? (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`w-[5px] h-[5px] rounded-full shrink-0 ${
                                tooltipTheme?.dotClass || 'bg-neutral-300'
                              }`}
                            />
                            <span className="text-neutral-200 truncate">
                              {tooltipProject.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-neutral-500">미지정</span>
                        )}
                      </div>

                      {(activeTooltipEvent.location ||
                        activeTooltipEvent.locationAddress) && (
                        <div className="pt-0.5 space-y-0.5">
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-neutral-500 shrink-0">장소</span>
                            <span className="text-neutral-200 text-right leading-snug line-clamp-2 break-keep">
                              {activeTooltipEvent.location ||
                                activeTooltipEvent.locationAddress}
                            </span>
                          </div>
                          {activeTooltipEvent.location &&
                            activeTooltipEvent.locationAddress && (
                              <p className="text-[10px] text-neutral-400 text-right leading-snug line-clamp-2 break-keep">
                                {activeTooltipEvent.locationAddress}
                              </p>
                            )}
                        </div>
                      )}

                      <div className="pt-0.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-neutral-500 shrink-0">체크리스트</span>
                          {totalChecks > 0 ? (
                            <div className="flex items-center gap-1 font-mono tabular-nums whitespace-nowrap">
                              <span className="text-neutral-100 font-medium">
                                {checkRate}%
                              </span>
                              <span className="text-[10px] text-neutral-400">
                                ({doneChecks}/{totalChecks})
                              </span>
                            </div>
                          ) : (
                            <span className="text-neutral-500">항목 없음</span>
                          )}
                        </div>

                        {totalChecks > 0 && (
                          <progress
                            value={Math.max(checkRate > 0 ? 4 : 0, checkRate)}
                            max={100}
                            className="mt-1.5 block w-full h-[1.5px] appearance-none bg-white/[0.08] overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-white/[0.08] [&::-webkit-progress-value]:bg-white/85 [&::-moz-progress-bar]:bg-white/85"
                          />
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
