import React, { useMemo } from 'react';
import { CheckCircle, Circle } from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import { formatKoreanDateWithDay } from '../shared/dateUtils';
import { hasEventConflict, calculateCompletionStats } from '../shared/scheduleUtils';
import {
  mapEventsToViewerZone,
  projectEventToViewerTimeZone,
  toViewerProjectedEvent,
} from '../shared/timeZoneUtils';
import { resolveEventLuxuryTheme } from '../utils/eventTheme';
import { EventDetailContent } from './EventDetailContent';

interface DayInspectorPanelProps {
  selectedDate: string;
  events: CalendarEventItem[];
  selectedEvent: CalendarEventItem | null;
  viewerTimeZone: string;
  onSelectEvent: (event: CalendarEventItem | null) => void;
  onDeleteEvent: (id: string) => void;
  onToggleComplete: (id: string) => void;
  onToggleChecklistItem: (eventId: string, itemId: string) => void;
  onQuickAiPromptForDate: (date: string) => void;
  projects?: ProjectItem[];
  onUpdateProject?: (eventId: string, projectId: string | undefined) => void;
  onUpdateTimeZone?: (eventId: string, timeZone: string | undefined) => void;
  onUpdateLocation?: (
    eventId: string,
    location?: string,
    locationAddress?: string,
    locationLat?: number,
    locationLng?: number
  ) => void;
  onShareEvent?: (event: CalendarEventItem) => void;
  emptyGuideText?: string;
}

export const DayInspectorPanel: React.FC<DayInspectorPanelProps> = ({
  selectedDate,
  events,
  selectedEvent,
  viewerTimeZone,
  onSelectEvent,
  onDeleteEvent,
  onToggleComplete,
  onToggleChecklistItem,
  onQuickAiPromptForDate,
  projects = [],
  onUpdateProject,
  onUpdateTimeZone,
  onUpdateLocation,
  onShareEvent,
  emptyGuideText,
}) => {
  const dateTitle = useMemo(() => formatKoreanDateWithDay(selectedDate, false), [selectedDate]);
  const hasConflict = useMemo(() => {
    if (!selectedEvent) return false;
    return hasEventConflict(
      toViewerProjectedEvent(selectedEvent, viewerTimeZone),
      mapEventsToViewerZone(events, viewerTimeZone)
    );
  }, [selectedEvent, events, viewerTimeZone]);

  const { total, completed, rate } = useMemo(
    () => calculateCompletionStats(events),
    [events]
  );

  const sortedEvents = useMemo(
    () =>
      [...events].sort((a, b) => {
        if (a.isAllDay && !b.isAllDay) return -1;
        if (!a.isAllDay && b.isAllDay) return 1;
        const aLocal = projectEventToViewerTimeZone(a, viewerTimeZone).localStartTime;
        const bLocal = projectEventToViewerTimeZone(b, viewerTimeZone).localStartTime;
        return aLocal.localeCompare(bLocal);
      }),
    [events, viewerTimeZone]
  );

  return (
    <aside className="w-80 md:w-96 lg:w-[420px] h-full border-l border-white/[0.07] bg-[#11131a] flex flex-col shrink-0 select-none overflow-hidden">
      {selectedEvent ? (
        <EventDetailContent
          event={selectedEvent}
          viewerTimeZone={viewerTimeZone}
          hasConflict={hasConflict}
          projects={projects}
          variant="panel"
          onUpdateProject={onUpdateProject}
          onUpdateTimeZone={onUpdateTimeZone}
          onUpdateLocation={onUpdateLocation}
          onToggleComplete={onToggleComplete}
          onToggleChecklistItem={onToggleChecklistItem}
          onShare={onShareEvent}
          onDelete={onDeleteEvent}
          onClose={() => onSelectEvent(null)}
        />
      ) : (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* 상단 일자 헤더 (h-10 수평 그리드 정렬) */}
          <div className="h-10 px-4 border-b border-white/[0.06] bg-[#101218] flex items-center justify-between shrink-0">
            <h4 className="text-xs font-medium text-neutral-300 tracking-tight tabular-nums">
              {dateTitle}
            </h4>
            <button
              type="button"
              onClick={() => onQuickAiPromptForDate(selectedDate)}
              className="h-6 px-2.5 rounded-md bg-white/[0.07] hover:bg-white/[0.13] text-[11px] text-neutral-100 font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap"
            >
              일정 지시
            </button>
          </div>

          {sortedEvents.length === 0 ? (
            <div className="flex-1 flex items-center justify-center px-6">
              <p className="text-xs font-light text-neutral-500 tracking-wide text-center select-none">
                {emptyGuideText || '현재 선택한 날짜의 일정이 없습니다'}
              </p>
            </div>
          ) : (
            <>
              {/* 달성률 요약 바 */}
              <div className="p-4 border-b border-white/[0.06] bg-[#131620] shrink-0">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-white/46 text-[11px] font-[370] tracking-[0.02em]">오늘 일정 달성률</span>
                  <span className="text-xs font-[450] text-[#f1f3f7] tabular-nums tracking-[0.03em]">
                    {completed}/{total} ({rate}%)
                  </span>
                </div>
                <div className="w-full h-[1.5px] rounded-full bg-white/[0.07] overflow-hidden">
                  <div
                    style={{ width: `${rate}%` }}
                    className="h-full bg-white/80 rounded-full transition-all duration-200"
                  />
                </div>
              </div>

              {/* 일간 타임라인 요약 목록 */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3">
                <span className="text-[11px] font-[370] text-white/42 block mb-3 tabular-nums tracking-[0.025em]">
                  등록된 일정 ({total}건)
                </span>

                {sortedEvents.map((ev) => {
                  const theme = resolveEventLuxuryTheme(ev, projects);
                  const timing = projectEventToViewerTimeZone(ev, viewerTimeZone);
                  const primaryTime = ev.isAllDay
                    ? '종일'
                    : `${timing.localStartTime} – ${timing.localEndTime}`;
                  const secondaryZone =
                    !ev.isAllDay && !timing.isSameZone
                      ? timing.hasOffsetDiff
                        ? `${timing.sourceMeta.cityKo} ${ev.startTime}`
                        : timing.sourceMeta.cityKo
                      : null;
                  const checklistTotal = ev.checklist?.length || 0;
                  const checklistDone = ev.checklist?.filter((c) => c.done).length || 0;

                  return (
                    <div
                      key={ev.id}
                      onClick={() => onSelectEvent(ev)}
                      className={`relative pl-[24px] pr-4 py-3.5 rounded-[10px] border luxury-event-card cursor-pointer group flex items-start justify-between gap-3.5 ${
                        theme.blockSurfaceClass
                      } ${ev.isCompleted ? 'opacity-60' : ''}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute left-[11px] top-3.5 bottom-3.5 w-[2px] rounded-full ${theme.inlayClass}`}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-[11px] tabular-nums tracking-[0.035em] leading-[1.4] truncate">
                          <span className="font-[370] text-white/52 shrink-0">{primaryTime}</span>
                          {secondaryZone && (
                            <>
                              <span aria-hidden="true" className="text-white/20 shrink-0">
                                ·
                              </span>
                              <span className="font-[350] tracking-[0.025em] text-white/32 truncate">
                                {secondaryZone}
                              </span>
                            </>
                          )}
                          {checklistTotal > 0 && (
                            <span className="ml-auto text-[10.5px] font-[360] tracking-[0.04em] text-white/34 tabular-nums shrink-0 pl-2">
                              {checklistDone}/{checklistTotal}
                            </span>
                          )}
                        </div>

                        <h5
                          className={`text-[13px] font-[450] tracking-[0.015em] leading-[1.52] mt-2 truncate ${
                            ev.isCompleted
                              ? 'line-through text-white/34'
                              : 'text-[#f2f4f8]'
                          }`}
                        >
                          {ev.title}
                        </h5>

                        {(ev.location || ev.locationAddress) && (
                          <div className="mt-2 space-y-1 min-w-0">
                            {ev.location && (
                              <p className="text-[11px] font-[380] leading-[1.5] text-white/58 truncate tracking-[0.016em]">
                                {ev.location}
                              </p>
                            )}
                            {ev.locationAddress && (
                              <p className="text-[10.5px] font-[350] leading-[1.48] text-white/34 truncate tracking-[0.02em]">
                                {ev.locationAddress}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleComplete(ev.id);
                        }}
                        className="mt-0.5 text-white/28 hover:text-emerald-300 transition-colors cursor-pointer shrink-0"
                        title={ev.isCompleted ? '완료 해제' : '완료 표시'}
                      >
                        {ev.isCompleted ? (
                          <CheckCircle className="w-4 h-4 text-emerald-300/90" />
                        ) : (
                          <Circle className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
};
