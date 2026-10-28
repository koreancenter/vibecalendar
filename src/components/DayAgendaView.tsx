import React, { useMemo } from 'react';
import { CheckCircle } from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import { formatKoreanDateWithDay, getTodayDateString } from '../shared/dateUtils';
import { resolveEventLuxuryTheme } from '../utils/eventTheme';
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
  onShareEvent?: (event: CalendarEventItem) => void;
  emptyGuideText?: string;
  isWorkspaceEmpty?: boolean;
  onLoadSampleData?: () => void;
}

export const DayAgendaView: React.FC<DayAgendaViewProps> = ({
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

  const allDayEvents = useMemo(() => events.filter((e) => e.isAllDay), [events]);
  const timedEvents = useMemo(() => events.filter((e) => !e.isAllDay), [events]);

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

          <span className="text-[10px] text-neutral-500 font-mono hidden md:inline">
            15분 단위 드래그 조절
          </span>
        </div>

        {/* 종일 일정 고정 바 */}
        {allDayEvents.length > 0 && (
          <div className="bg-[#11141d] border-b border-white/[0.07] px-4 py-2 flex items-center gap-2 shrink-0 flex-wrap">
            <span className="text-[11px] font-medium text-neutral-500 shrink-0">종일</span>
            {allDayEvents.map((ev) => {
              const theme = resolveEventLuxuryTheme(ev, projects);
              const proj = theme.project;
              const isSelected = selectedEvent?.id === ev.id;
              return (
                <div
                  key={ev.id}
                  onClick={() => onSelectEvent(ev)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors duration-150 border ${
                    theme.chipSurfaceClass
                  } ${isSelected ? theme.selectedSurfaceClass : ''}`}
                >
                  <span
                    className={`w-[5px] h-[5px] rounded-full shrink-0 ${theme.dotClass}`}
                  />
                  {isComparing && proj && (
                    <span className={`font-mono text-[10px] ${theme.accentTextClass}`}>
                      {proj.code || proj.name.slice(0, 4)}
                    </span>
                  )}
                  {ev.isCompleted && (
                    <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                  )}
                  <span
                    className={
                      ev.isCompleted ? 'line-through text-neutral-500' : 'text-neutral-100'
                    }
                  >
                    {ev.title}
                  </span>
                </div>
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
          pxPerHour={72}
          selectedEvent={selectedEvent}
          projects={projects}
          comparedProjectIds={comparedProjectIds}
          scrollResetKey={selectedDate}
          onSelectEvent={(ev) => onSelectEvent(ev)}
          onMoveEventDate={onMoveEventDate}
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
        onUpdateProject={onUpdateProject}
        onUpdateTimeZone={onUpdateTimeZone}
        onUpdateLocation={onUpdateLocation}
        onShareEvent={onShareEvent}
        emptyGuideText={emptyGuideText}
      />
    </div>
  );
};
