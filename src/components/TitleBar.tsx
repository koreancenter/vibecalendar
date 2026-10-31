import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  PanelLeftOpen,
  PanelLeftClose,
  Plus,
  Search,
} from 'lucide-react';
import {
  CalendarCategory,
  CalendarEventItem,
  CalendarViewMode,
  ProjectItem,
} from '../types';
import { getWeekRangeLabel, formatKoreanDateWithDay } from '../shared/dateUtils';
import { ExportMenuDropdown } from './ExportMenuDropdown';
import { TopBarTooltip } from './common/TopBarTooltip';

interface TitleBarProps {
  currentYear: number;
  currentMonth: number;
  selectedDate: string;
  events: CalendarEventItem[];
  projects?: ProjectItem[];
  selectedProjectIds?: string[];
  selectedCategory?: CalendarCategory | '전체';
  timeZoneSlot?: React.ReactNode;
  historySlot?: React.ReactNode;
  vaultSlot?: React.ReactNode;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  viewMode: CalendarViewMode;
  onChangeViewMode: (mode: CalendarViewMode) => void;
  onOpenCommandPalette?: () => void;
  onOpenCreateEvent?: () => void;
  onImportIcsFile?: (file: File) => void;
  onExportWorkspaceJson?: () => void;
  onImportWorkspaceJsonFile?: (file: File) => void;
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
  historySlot,
  vaultSlot,
  isSidebarOpen,
  onToggleSidebar,
  onPrev,
  onNext,
  onToday,
  viewMode,
  onChangeViewMode,
  onOpenCommandPalette,
  onOpenCreateEvent,
  onImportIcsFile,
  onExportWorkspaceJson,
  onImportWorkspaceJsonFile,
  showToast,
}) => {
  const prevLabel =
    viewMode === 'month' || viewMode === 'ops'
      ? '이전 달'
      : viewMode === 'week'
      ? '이전 주'
      : '이전 날';

  const nextLabel =
    viewMode === 'month' || viewMode === 'ops'
      ? '다음 달'
      : viewMode === 'week'
      ? '다음 주'
      : '다음 날';

  return (
    <header className="h-11 bg-[#0c0e14] border-b border-white/[0.04] px-3.5 sm:px-5 flex items-center justify-between gap-3 select-none shrink-0 z-30">
      {/* Zone 1: 좌측 패널 토글 및 단일 브랜드 워드마크 */}
      <div className="flex items-center gap-2.5 shrink-0">
        <TopBarTooltip
          label={isSidebarOpen ? '컨시어지 패널 닫기' : '컨시어지 패널 열기'}
          align="left"
        >
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={isSidebarOpen ? '컨시어지 패널 닫기' : '컨시어지 패널 열기'}
            className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25 ${
              isSidebarOpen
                ? 'text-neutral-300 hover:text-white hover:bg-white/[0.06]'
                : 'text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.06]'
            }`}
          >
            {isSidebarOpen ? (
              <PanelLeftClose className="w-[15px] h-[15px]" strokeWidth={1.65} />
            ) : (
              <PanelLeftOpen className="w-[15px] h-[15px]" strokeWidth={1.65} />
            )}
          </button>
        </TopBarTooltip>

        <span className="text-[13px] font-semibold text-white tracking-tight whitespace-nowrap shrink-0 hidden sm:inline">
          바이브 행사
        </span>
      </div>

      {/* Zone 2: 중앙 무테(Unboxed) 날짜 탐색 */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        <TopBarTooltip label={prevLabel}>
          <button
            type="button"
            onClick={onPrev}
            aria-label={prevLabel}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
          >
            <ChevronLeft className="w-[15px] h-[15px]" strokeWidth={1.65} />
          </button>
        </TopBarTooltip>

        <TopBarTooltip label="오늘 날짜로 이동" shortcut="T">
          <button
            type="button"
            onClick={onToday}
            className="text-[13px] font-medium text-white hover:text-neutral-200 px-1.5 tracking-tight tabular-nums whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25 rounded-md"
          >
            {viewMode === 'month' && `${currentYear}년 ${currentMonth + 1}월`}
            {viewMode === 'week' && `${currentYear}년 ${getWeekRangeLabel(selectedDate)}`}
            {viewMode === 'agenda' && formatKoreanDateWithDay(selectedDate, true)}
            {viewMode === 'ops' && `공정 런시트 · ${currentYear}년 ${currentMonth + 1}월`}
          </button>
        </TopBarTooltip>

        <TopBarTooltip label={nextLabel}>
          <button
            type="button"
            onClick={onNext}
            aria-label={nextLabel}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
          >
            <ChevronRight className="w-[15px] h-[15px]" strokeWidth={1.65} />
          </button>
        </TopBarTooltip>

        <TopBarTooltip label="오늘로 이동" shortcut="T">
          <button
            type="button"
            onClick={onToday}
            className="ml-0.5 px-1.5 h-6 rounded-md text-xs font-normal text-neutral-500 hover:text-white hover:bg-white/[0.05] transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
          >
            오늘
          </button>
        </TopBarTooltip>
      </div>

      {/* Zone 3: 3-클러스터 미니멀 바 — ① 시계 │ ② 글래스 뷰 세그먼트 │ ③ 유틸리티 아이콘 + 새 일정(+) */}
      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
        {timeZoneSlot}

        {timeZoneSlot && (
          <span
            aria-hidden="true"
            className="hidden sm:block h-3 w-px bg-white/[0.07] shrink-0"
          />
        )}

        {/* Cluster 2: 초슬림 다크 글래스 세그먼트 뷰 전환 */}
        <div
          className="h-7 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06] inline-flex items-center gap-0.5 shrink-0"
          role="tablist"
          aria-label="캘린더 뷰 전환"
        >
          {(
            [
              { mode: 'month', label: '월', tooltip: '월간 뷰', shortcut: 'M' },
              { mode: 'week', label: '주', tooltip: '주간 뷰', shortcut: 'W' },
              { mode: 'agenda', label: '일', tooltip: '일간 뷰', shortcut: 'D' },
              { mode: 'ops', label: '공정', tooltip: '공정 런시트', shortcut: 'O' },
            ] as const
          ).map(({ mode, label, tooltip, shortcut }) => {
            const active = viewMode === mode;
            return (
              <TopBarTooltip key={mode} label={tooltip} shortcut={shortcut}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onChangeViewMode(mode)}
                  className={`h-6 px-2 sm:px-2.5 rounded-[6px] text-[11.5px] leading-none inline-flex items-center justify-center transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25 ${
                    active
                      ? 'bg-white/[0.10] text-white font-medium shadow-[0_1px_2px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]'
                      : 'text-neutral-500 hover:text-neutral-200 font-normal'
                  }`}
                >
                  {label}
                </button>
              </TopBarTooltip>
            );
          })}
        </div>

        <span aria-hidden="true" className="h-3 w-px bg-white/[0.07] shrink-0" />

        {/* Cluster 3: 정밀 유틸리티 아이콘 열 (검색 · 내보내기 · 볼트 · 새 일정 앵커) */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {onOpenCommandPalette && (
            <TopBarTooltip label="통합 검색" shortcut="⌘K" align="right">
              <button
                type="button"
                onClick={onOpenCommandPalette}
                aria-label="통합 검색 및 명령 팔레트"
                className="h-7 w-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
              >
                <Search className="w-[15px] h-[15px]" strokeWidth={1.65} />
              </button>
            </TopBarTooltip>
          )}

          {historySlot}

          <ExportMenuDropdown
            currentYear={currentYear}
            currentMonth={currentMonth}
            selectedDate={selectedDate}
            viewMode={viewMode}
            events={events}
            projects={projects}
            selectedProjectIds={selectedProjectIds}
            selectedCategory={selectedCategory}
            onImportIcsFile={onImportIcsFile}
            onExportWorkspaceJson={onExportWorkspaceJson}
            onImportWorkspaceJsonFile={onImportWorkspaceJsonFile}
            onExportDone={showToast}
          />

          {vaultSlot}

          {onOpenCreateEvent && (
            <TopBarTooltip label="새 일정 등록" shortcut="N" align="right">
              <button
                type="button"
                onClick={onOpenCreateEvent}
                aria-label="새 일정 등록"
                className="ml-0.5 h-7 w-7 rounded-lg bg-white/[0.07] hover:bg-white/[0.14] border border-white/[0.11] hover:border-white/[0.2] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] text-neutral-100 hover:text-white flex items-center justify-center transition-all duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
              >
                <Plus className="w-[15px] h-[15px]" strokeWidth={1.85} />
              </button>
            </TopBarTooltip>
          )}
        </div>
      </div>
    </header>
  );
};

