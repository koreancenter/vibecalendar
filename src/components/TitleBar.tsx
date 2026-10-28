import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react';
import { CalendarCategory, CalendarEventItem, ProjectItem } from '../types';
import { getWeekRangeLabel, formatKoreanDateWithDay } from '../shared/dateUtils';
import { ExportMenuDropdown } from './ExportMenuDropdown';

interface TitleBarProps {
  currentYear: number;
  currentMonth: number;
  selectedDate: string;
  events: CalendarEventItem[];
  projects?: ProjectItem[];
  selectedProjectIds?: string[];
  selectedCategory?: CalendarCategory | '전체';
  timeZoneSlot?: React.ReactNode;
  vaultSlot?: React.ReactNode;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  viewMode: 'month' | 'week' | 'agenda';
  onChangeViewMode: (mode: 'month' | 'week' | 'agenda') => void;
  showToast: (msg: string) => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  currentYear,
  currentMonth,
  selectedDate,
  events,
  projects = [],
  selectedProjectIds = [],
  selectedCategory = '전체',
  timeZoneSlot,
  vaultSlot,
  isSidebarOpen,
  onToggleSidebar,
  onPrev,
  onNext,
  onToday,
  viewMode,
  onChangeViewMode,
  showToast,
}) => {
  return (
    <header className="h-11 bg-[#0c0e14] border-b border-white/[0.035] px-3.5 sm:px-5 flex items-center justify-between gap-4 select-none shrink-0 z-30">
      {/* Zone 1: 좌측 패널 토글 및 단일 브랜드 워드마크 */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer ${
            isSidebarOpen
              ? 'text-neutral-300 hover:text-white hover:bg-white/[0.05]'
              : 'text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.05]'
          }`}
          title={isSidebarOpen ? '컨시어지 패널 닫기' : '컨시어지 패널 열기'}
        >
          {isSidebarOpen ? (
            <PanelLeftClose className="w-4 h-4" strokeWidth={1.65} />
          ) : (
            <PanelLeftOpen className="w-4 h-4" strokeWidth={1.65} />
          )}
        </button>

        <span className="text-[13px] font-semibold text-white tracking-tight whitespace-nowrap shrink-0 hidden sm:inline">
          바이브 행사
        </span>
      </div>

      {/* Zone 2: 중앙 무테(Unboxed) 날짜 탐색 */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onPrev}
          className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/[0.05] transition-colors duration-150 cursor-pointer"
          title={viewMode === 'month' ? '이전 달' : viewMode === 'week' ? '이전 주' : '이전 날'}
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={1.65} />
        </button>

        <button
          type="button"
          onClick={onToday}
          className="text-[13px] font-medium text-white hover:text-neutral-200 px-1.5 tracking-tight tabular-nums whitespace-nowrap transition-colors duration-150 cursor-pointer"
          title="오늘 날짜로 이동"
        >
          {viewMode === 'month' && `${currentYear}년 ${currentMonth + 1}월`}
          {viewMode === 'week' && `${currentYear}년 ${getWeekRangeLabel(selectedDate)}`}
          {viewMode === 'agenda' && formatKoreanDateWithDay(selectedDate, true)}
        </button>

        <button
          type="button"
          onClick={onNext}
          className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/[0.05] transition-colors duration-150 cursor-pointer"
          title={viewMode === 'month' ? '다음 달' : viewMode === 'week' ? '다음 주' : '다음 날'}
        >
          <ChevronRight className="w-4 h-4" strokeWidth={1.65} />
        </button>

        <button
          type="button"
          onClick={onToday}
          className="ml-1 px-1.5 h-6 text-xs font-normal text-neutral-500 hover:text-white transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
        >
          오늘
        </button>
      </div>

      {/* Zone 3: 우측 현재 위치 시각 · 무테 뷰 전환(월 · 주 · 일) · 단일 내보내기 아이콘 */}
      <div className="flex items-center gap-4 sm:gap-5 shrink-0">
        {timeZoneSlot}

        <div className="flex items-center gap-3" role="tablist" aria-label="캘린더 뷰 전환">
          {(
            [
              { mode: 'month', label: '월' },
              { mode: 'week', label: '주' },
              { mode: 'agenda', label: '일' },
            ] as const
          ).map(({ mode, label }) => {
            const active = viewMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChangeViewMode(mode)}
                className={`text-xs transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? 'text-white font-medium'
                    : 'text-neutral-500 hover:text-neutral-200 font-normal'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <ExportMenuDropdown
          currentYear={currentYear}
          currentMonth={currentMonth}
          selectedDate={selectedDate}
          viewMode={viewMode}
          events={events}
          projects={projects}
          selectedProjectIds={selectedProjectIds}
          selectedCategory={selectedCategory}
          onExportDone={showToast}
        />

        {vaultSlot}
      </div>
    </header>
  );
};
