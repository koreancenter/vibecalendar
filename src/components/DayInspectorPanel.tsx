import React, { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import { formatKoreanDateWithDay } from '../shared/dateUtils';
import { hasEventConflict, calculateCompletionStats } from '../shared/scheduleUtils';
import {
  areShallowArraysEqual,
  useCalendarEventViewModels,
} from '../hooks/useCalendarEventViewModels';
import { LuxuryEventBlock } from './common/LuxuryEventBlock';
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
  comparedProjectIds?: string[];
  onUpdateProject?: (eventId: string, projectId: string | undefined) => void;
  onUpdateTimeZone?: (eventId: string, timeZone: string | undefined) => void;
  onUpdateLocation?: (
    eventId: string,
    location?: string,
    locationAddress?: string,
    locationLat?: number,
    locationLng?: number
  ) => void;
  onUpdateEventFields?: (
    eventId: string,
    updates: Partial<CalendarEventItem>,
    toastLabel?: string
  ) => void;
  onAddChecklistItem?: (eventId: string, text: string) => void;
  onUpdateChecklistItemText?: (eventId: string, itemId: string, text: string) => void;
  onDeleteChecklistItem?: (eventId: string, itemId: string) => void;
  onOpenCreateEvent?: (date: string) => void;
  onShareEvent?: (event: CalendarEventItem) => void;
  emptyGuideText?: string;
}

const DayInspectorPanelComponent: React.FC<DayInspectorPanelProps> = ({
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
  comparedProjectIds = [],
  onUpdateProject,
  onUpdateTimeZone,
  onUpdateLocation,
  onUpdateEventFields,
  onAddChecklistItem,
  onUpdateChecklistItemText,
  onDeleteChecklistItem,
  onOpenCreateEvent,
  onShareEvent,
  emptyGuideText,
}) => {
  const isComparing = comparedProjectIds.length >= 2;
  const dateTitle = useMemo(() => formatKoreanDateWithDay(selectedDate, false), [selectedDate]);

  const { byEventId, projectedEvents, viewModels, getViewModel } = useCalendarEventViewModels({
    events,
    projects,
    viewerTimeZone,
  });

  const conflictingEventIds = useMemo(() => {
    const set = new Set<string>();
    if (projectedEvents.length < 2) return set;
    for (const vm of viewModels) {
      if (!vm.event.isAllDay && hasEventConflict(vm.projectedEvent, projectedEvents)) {
        set.add(vm.event.id);
      }
    }
    return set;
  }, [viewModels, projectedEvents]);

  const hasConflict = useMemo(() => {
    if (!selectedEvent) return false;
    if (conflictingEventIds.has(selectedEvent.id)) return true;
    const selectedVm = byEventId.get(selectedEvent.id) ?? getViewModel(selectedEvent);
    return !selectedEvent.isAllDay && hasEventConflict(selectedVm.projectedEvent, projectedEvents);
  }, [selectedEvent, conflictingEventIds, byEventId, getViewModel, projectedEvents]);

  const { total, completed, rate } = useMemo(
    () => calculateCompletionStats(events),
    [events]
  );

  const sortedViewModels = useMemo(
    () =>
      [...viewModels].sort((a, b) => {
        if (a.event.isAllDay && !b.event.isAllDay) return -1;
        if (!a.event.isAllDay && b.event.isAllDay) return 1;
        return a.timing.localStartTime.localeCompare(b.timing.localStartTime);
      }),
    [viewModels]
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
          onUpdateEventFields={onUpdateEventFields}
          onToggleComplete={onToggleComplete}
          onToggleChecklistItem={onToggleChecklistItem}
          onAddChecklistItem={onAddChecklistItem}
          onUpdateChecklistItemText={onUpdateChecklistItemText}
          onDeleteChecklistItem={onDeleteChecklistItem}
          onShare={onShareEvent}
          onDelete={onDeleteEvent}
          onClose={() => onSelectEvent(null)}
        />
      ) : (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* 상단 일자 헤더 (h-10 수평 그리드 정렬) */}
          <div className="h-10 px-4 border-b border-white/[0.06] bg-[#101218] flex items-center justify-between gap-2 shrink-0">
            <h4 className="text-xs font-medium text-neutral-300 tracking-tight tabular-nums truncate">
              {dateTitle}
            </h4>
            <div className="flex items-center gap-1.5 shrink-0">
              {onOpenCreateEvent && (
                <button
                  type="button"
                  onClick={() => onOpenCreateEvent(selectedDate)}
                  className="h-6 px-2.5 rounded-md bg-white text-neutral-950 hover:bg-neutral-200 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3 h-3 shrink-0" />
                  <span>새 일정</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onQuickAiPromptForDate(selectedDate)}
                className="h-6 px-2.5 rounded-md bg-white/[0.07] hover:bg-white/[0.13] text-[11px] text-neutral-100 font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
              >
                일정 지시
              </button>
            </div>
          </div>

          {sortedViewModels.length === 0 ? (
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

                {sortedViewModels.map(({ event: ev, timing, theme }) => (
                  <LuxuryEventBlock
                    key={ev.id}
                    variant="inspector"
                    event={ev}
                    theme={theme}
                    timing={timing}
                    hasConflict={conflictingEventIds.has(ev.id)}
                    showProjectBadge={isComparing}
                    onClick={() => onSelectEvent(ev)}
                    onToggleComplete={onToggleComplete}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
};

function areDayInspectorPanelPropsEqual(
  prev: DayInspectorPanelProps,
  next: DayInspectorPanelProps
): boolean {
  return (
    prev.selectedDate === next.selectedDate &&
    prev.selectedEvent === next.selectedEvent &&
    prev.viewerTimeZone === next.viewerTimeZone &&
    prev.emptyGuideText === next.emptyGuideText &&
    prev.onSelectEvent === next.onSelectEvent &&
    prev.onDeleteEvent === next.onDeleteEvent &&
    prev.onToggleComplete === next.onToggleComplete &&
    prev.onToggleChecklistItem === next.onToggleChecklistItem &&
    prev.onQuickAiPromptForDate === next.onQuickAiPromptForDate &&
    prev.onUpdateProject === next.onUpdateProject &&
    prev.onUpdateTimeZone === next.onUpdateTimeZone &&
    prev.onUpdateLocation === next.onUpdateLocation &&
    prev.onUpdateEventFields === next.onUpdateEventFields &&
    prev.onAddChecklistItem === next.onAddChecklistItem &&
    prev.onUpdateChecklistItemText === next.onUpdateChecklistItemText &&
    prev.onDeleteChecklistItem === next.onDeleteChecklistItem &&
    prev.onOpenCreateEvent === next.onOpenCreateEvent &&
    prev.onShareEvent === next.onShareEvent &&
    areShallowArraysEqual(prev.events, next.events) &&
    areShallowArraysEqual(prev.projects, next.projects) &&
    areShallowArraysEqual(prev.comparedProjectIds, next.comparedProjectIds)
  );
}

export const DayInspectorPanel = React.memo(
  DayInspectorPanelComponent,
  areDayInspectorPanelPropsEqual
);
