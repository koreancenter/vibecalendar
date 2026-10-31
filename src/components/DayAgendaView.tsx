import React, { useCallback, useMemo } from 'react';
import { CalendarEventItem, ProjectItem } from '../types';
import { formatKoreanDateWithDay, getTodayDateString } from '../shared/dateUtils';
import {
  areShallowArraysEqual,
  useCalendarEventViewModels,
} from '../hooks/useCalendarEventViewModels';
import { LuxuryEventChip } from './common/LuxuryEventChip';
import { DayInspectorPanel } from './DayInspectorPanel';
import { TimeGridCanvas, TimeGridColumn } from './TimeGridCanvas';

interface DayAgendaViewProps {
  selectedDate: string;
  events: CalendarEventItem[];
  selectedEvent: CalendarEventItem | null;
  viewerTimeZone: string;
  onSelectEvent: (event: CalendarEventItem | null) => void;
  onDeleteEvent: (id: string) => void;
  onToggleComplete: (id: string) => void;
  onToggleChecklistItem: (eventId: string, itemId: string) => void;
  onMoveEventDate?: (
    eventId: string,
    targetDate: string,
    targetStartTime?: string,
    targetEndTime?: string
  ) => void;
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
  onOpenCreateEvent?: (date: string, startTime?: string, endTime?: string) => void;
  onShareEvent?: (event: CalendarEventItem) => void;
  emptyGuideText?: string;
  isWorkspaceEmpty?: boolean;
  onLoadSampleData?: () => void;
}

const DayAgendaViewComponent: React.FC<DayAgendaViewProps> = ({
  selectedDate,
  events,
  selectedEvent,
  viewerTimeZone,
  onSelectEvent,
  onDeleteEvent,
  onToggleComplete,
  onToggleChecklistItem,
  onMoveEventDate,
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
  isWorkspaceEmpty = false,
  onLoadSampleData,
}) => {
  const isComparing = comparedProjectIds.length >= 2;
  const dateHeaderLabel = useMemo(
    () => formatKoreanDateWithDay(selectedDate, false),
    [selectedDate]
  );
  const isToday = selectedDate === getTodayDateString();

  const { byEventId, getViewModel } = useCalendarEventViewModels({
    events,
    projects,
    viewerTimeZone,
  });

  const allDayEvents = useMemo(() => events.filter((e) => e.isAllDay), [events]);
  const timedEvents = useMemo(() => events.filter((e) => !e.isAllDay), [events]);

  const handleSelectCanvasEvent = useCallback(
    (ev: CalendarEventItem) => {
      onSelectEvent(ev);
    },
    [onSelectEvent]
  );

  const columns: TimeGridColumn[] = useMemo(
    () => [
      {
        date: selectedDate,
        isSelected: true,
        isToday,
        events: timedEvents,
      },
    ],
    [selectedDate, isToday, timedEvents]
  );

  return (
    <div className="flex-1 flex flex-row h-full overflow-hidden select-none bg-[#0c0e14]">
      {/* 좌측: 일간 타임테이블 메인 영역 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        <div className="h-10 px-4 border-b border-white/[0.06] bg-[#101218] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs whitespace-nowrap">
            <span className="font-medium text-white tracking-tight tabular-nums">
              {dateHeaderLabel}
            </span>
            {isToday && (
              <>
                <span aria-hidden="true" className="text-neutral-600">
                  ·
                </span>
                <span className="text-[11px] text-neutral-300">오늘</span>
              </>
            )}
            <span aria-hidden="true" className="text-neutral-600 hidden sm:inline">
              ·
            </span>
            <span className="text-[11px] text-neutral-400 hidden sm:inline tabular-nums">
              일정 <strong className="text-neutral-200 font-medium">{events.length}</strong>건 (시간제{' '}
              {timedEvents.length} · 종일 {allDayEvents.length})
            </span>
          </div>

          <span className="text-[10.5px] text-white/36 tabular-nums tracking-tight hidden md:inline">
            15분 단위 드래그 조절
          </span>
        </div>

        {/* 종일 일정 고정 바 */}
        {allDayEvents.length > 0 && (
          <div className="bg-[#11141d] border-b border-white/[0.07] px-4 py-2.5 flex items-center gap-3 shrink-0 flex-wrap">
            <span className="text-[11px] font-[370] text-white/42 shrink-0 tracking-[0.025em]">종일</span>
            {allDayEvents.map((ev) => {
              const vm = byEventId.get(ev.id) ?? getViewModel(ev);
              const isSelected = selectedEvent?.id === ev.id;
              return (
                <LuxuryEventChip
                  key={ev.id}
                  event={ev}
                  theme={vm.theme}
                  size="md"
                  showProjectBadge={isComparing}
                  projectCodeMaxLength={4}
                  showCompletionIcon
                  showChecklistBadge
                  isSelected={isSelected}
                  onClick={() => onSelectEvent(ev)}
                />
              );
            })}
          </div>
        )}

        {/* 공용 타임그리드 캔버스 */}
        <TimeGridCanvas
          columns={columns}
          variant="day"
          viewerTimeZone={viewerTimeZone}
          startHour={7}
          endHour={23}
          pxPerHour={76}
          selectedEvent={selectedEvent}
          projects={projects}
          comparedProjectIds={comparedProjectIds}
          scrollResetKey={selectedDate}
          onSelectEvent={handleSelectCanvasEvent}
          onMoveEventDate={onMoveEventDate}
          onQuickCreateSlot={onOpenCreateEvent}
          showEmptyGuide={events.length === 0}
          emptyGuideText={emptyGuideText}
          isWorkspaceEmpty={isWorkspaceEmpty}
          onLoadSampleData={onLoadSampleData}
        />
      </div>

      {/* 우측: 일간 인스펙터 패널 */}
      <DayInspectorPanel
        selectedDate={selectedDate}
        events={events}
        selectedEvent={selectedEvent}
        viewerTimeZone={viewerTimeZone}
        onSelectEvent={onSelectEvent}
        onDeleteEvent={onDeleteEvent}
        onToggleComplete={onToggleComplete}
        onToggleChecklistItem={onToggleChecklistItem}
        onQuickAiPromptForDate={onQuickAiPromptForDate}
        projects={projects}
        comparedProjectIds={comparedProjectIds}
        onUpdateProject={onUpdateProject}
        onUpdateTimeZone={onUpdateTimeZone}
        onUpdateLocation={onUpdateLocation}
        onUpdateEventFields={onUpdateEventFields}
        onAddChecklistItem={onAddChecklistItem}
        onUpdateChecklistItemText={onUpdateChecklistItemText}
        onDeleteChecklistItem={onDeleteChecklistItem}
        onOpenCreateEvent={onOpenCreateEvent ? (d) => onOpenCreateEvent(d) : undefined}
        onShareEvent={onShareEvent}
        emptyGuideText={emptyGuideText}
      />
    </div>
  );
};

function areDayAgendaViewPropsEqual(
  prev: DayAgendaViewProps,
  next: DayAgendaViewProps
): boolean {
  return (
    prev.selectedDate === next.selectedDate &&
    prev.selectedEvent === next.selectedEvent &&
    prev.viewerTimeZone === next.viewerTimeZone &&
    prev.emptyGuideText === next.emptyGuideText &&
    prev.isWorkspaceEmpty === next.isWorkspaceEmpty &&
    prev.onSelectEvent === next.onSelectEvent &&
    prev.onDeleteEvent === next.onDeleteEvent &&
    prev.onToggleComplete === next.onToggleComplete &&
    prev.onToggleChecklistItem === next.onToggleChecklistItem &&
    prev.onMoveEventDate === next.onMoveEventDate &&
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
    prev.onLoadSampleData === next.onLoadSampleData &&
    areShallowArraysEqual(prev.events, next.events) &&
    areShallowArraysEqual(prev.projects, next.projects) &&
    areShallowArraysEqual(prev.comparedProjectIds, next.comparedProjectIds)
  );
}

export const DayAgendaView = React.memo(DayAgendaViewComponent, areDayAgendaViewPropsEqual);
