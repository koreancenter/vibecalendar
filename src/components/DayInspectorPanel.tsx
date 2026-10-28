import React, { useMemo } from 'react';
import { CheckCircle, Circle, MapPin } from 'lucide-react';
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
    locationAddress?: string
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
              <div className="p-3.5 border-b border-white/[0.06] bg-[#131620] shrink-0">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-neutral-400 text-[11px] font-medium">오늘 일정 달성률</span>
                  <span className="font-mono text-xs font-medium text-neutral-200 tabular-nums">
                    {completed}/{total} ({rate}%)
                  </span>
                </div>
                <div className="w-full h-1 rounded-full bg-white/[0.07] overflow-hidden">
                  <div
                    style={{ width: `${rate}%` }}
                    className="h-full bg-white/80 rounded-full transition-all duration-200"
                  />
                </div>
              </div>

              {/* 일간 타임라인 요약 목록 */}
              <div className="flex-1 p-4 overflow-y-auto space-y-2">
                <span className="text-xs font-medium text-neutral-400 block mb-2 tabular-nums">
                  등록된 일정 ({total}건)
                </span>

                {sortedEvents.map((ev) => {
                  const theme = resolveEventLuxuryTheme(ev, projects);
                  const proj = theme.project;
                  const timing = projectEventToViewerTimeZone(ev, viewerTimeZone);
                  return (
                    <div
                      key={ev.id}
                      onClick={() => onSelectEvent(ev)}
                      className={`p-3 rounded-xl border transition-colors duration-150 cursor-pointer group flex items-start gap-3 ${theme.blockSurfaceClass}`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleComplete(ev.id);
                        }}
                        className="mt-0.5 text-neutral-500 hover:text-emerald-400 transition-colors cursor-pointer shrink-0"
                        title={ev.isCompleted ? '완료 해제' : '완료 표시'}
                      >
                        {ev.isCompleted ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Circle className="w-4 h-4" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums text-neutral-400 truncate">
                          <span
                            className={`w-[5px] h-[5px] rounded-full shrink-0 ${theme.dotClass}`}
                          />
                          {proj && (
                            <>
                              <span className={`font-medium shrink-0 ${theme.accentTextClass}`}>
                                {proj.code || proj.name.slice(0, 5)}
                              </span>
                              <span aria-hidden="true" className="text-neutral-600">
                                ·
                              </span>
                            </>
                          )}
                          <span>{ev.isAllDay ? '종일' : timing.rangeLabel}</span>
                        </div>

                        <h5
                          className={`text-xs font-semibold truncate ${
                            ev.isCompleted
                              ? 'line-through text-neutral-500'
                              : 'text-neutral-100'
                          }`}
                        >
                          {ev.title}
                        </h5>

                        {(ev.location || ev.locationAddress) && (
                          <div className="pt-0.5 space-y-0.5 min-w-0">
                            {ev.location && (
                              <p className="text-[11px] text-neutral-300 flex items-center gap-1 truncate">
                                <MapPin className="w-3 h-3 text-neutral-500 shrink-0" />
                                <span className="truncate">{ev.location}</span>
                              </p>
                            )}
                            {ev.locationAddress && (
                              <p
                                className={`${
                                  ev.location ? 'pl-4' : ''
                                } text-[10.5px] text-neutral-500 truncate`}
                              >
                                {ev.locationAddress}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
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
