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
  selectedEvent?: CalendarEventItem | null;
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

export const MonthGridView: React.FC<MonthGridViewProps> = ({
  currentYear,
  currentMonth,
  selectedDate,
  selectedEvent = null,
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

                {/* 날짜 번호(절제된 글래스 링 마커) 및 우측 상단 카운트 */}
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

                  {dayEvents.length > 0 && !isDragOver && (
                    <div className="flex items-center gap-1 pr-0.5">
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
                      <span className="text-[10.5px] font-[360] text-white/28 tabular-nums tracking-[0.03em]">
                        {dayEvents.length}
                      </span>
                    </div>
                  )}
                </div>

                {/* 일정 목록 (최대 3개 표시: 25px 여유 높이 + 미세 웨이트 450/370 + 양(+)의 자간 호흡) */}
                <div className="flex-1 min-h-0 flex flex-col gap-1.5 overflow-hidden">
                  {!isMonthEmpty && isSelected && dayEvents.length === 0 && !isDragOver && (
                    <div className="flex-1 flex items-center justify-center pointer-events-none">
                      <span className="text-[11px] font-[350] text-white/24 tracking-[0.025em] select-none">
                        일정 없음
                      </span>
                    </div>
                  )}
                  {dayEvents.slice(0, 3).map((ev, eventIdx) => {
                    const theme = resolveEventLuxuryTheme(ev, projects);
                    const proj = theme.project;
                    const isBeingDragged = draggedEventId === ev.id;
                    const isEvSelected = selectedEvent?.id === ev.id;
                    const timing = timingById.get(ev.id);
                    const chipTimeLabel = ev.isAllDay
                      ? '종일'
                      : timing?.localStartTime || ev.startTime;

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
                        className={`h-[25px] w-full text-left px-2.5 rounded-[6px] truncate flex items-center gap-2.5 border luxury-event-card cursor-grab active:cursor-grabbing shrink-0 ${
                          theme.chipSurfaceClass
                        } ${
                          isEvSelected && !isBeingDragged ? theme.selectedSurfaceClass : ''
                        } ${
                          isBeingDragged
                            ? 'opacity-30 scale-95 border-dashed border-white/35'
                            : ''
                        } ${ev.isCompleted && !isBeingDragged ? 'opacity-55' : ''}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`w-[2px] h-3 rounded-full shrink-0 ${theme.inlayClass}`}
                        />
                        <span className="text-[10.5px] font-[370] text-white/46 shrink-0 tabular-nums tracking-[0.032em]">
                          {chipTimeLabel}
                        </span>
                        {isComparing && proj && (
                          <span
                            className={`text-[10px] font-[440] shrink-0 tracking-[0.03em] ${theme.accentTextClass}`}
                          >
                            {proj.code || proj.name.slice(0, 3)}
                          </span>
                        )}
                        <span
                          className={`text-[11.5px] truncate font-[450] tracking-[0.014em] leading-[1.4] ${
                            ev.isCompleted
                              ? 'line-through text-white/32'
                              : 'text-[#f2f4f8]'
                          }`}
                        >
                          {ev.title}
                        </span>
                      </div>
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
