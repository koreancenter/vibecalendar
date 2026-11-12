import React from 'react';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  PanelLeftOpen,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CalendarCategory,
  CalendarEventItem,
  CalendarViewMode,
  ProjectItem,
} from '../types';
import {
  getWeekRangeLabel,
  getLocalizedWeekRangeLabel,
  getLocalizedMonthLabel,
  formatLocalizedDate,
} from '../shared/dateUtils';
import { ExportMenuDropdown } from './ExportMenuDropdown';
import { TopBarTooltip } from './common/TopBarTooltip';
import { LanguageSelector } from './common/LanguageSelector';

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
  onOpenExternalSync?: () => void;
  syncedAccountCount?: number;
  syncConflictCount?: number;
  isExternalSyncing?: boolean;
  onOpenNotificationSettings?: () => void;
  isNotificationEnabled?: boolean;
  scheduledAlertCount?: number;
  onOpenCollabHub?: () => void;
  collabRoomCount?: number;
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
  onOpenExternalSync,
  syncedAccountCount = 0,
  syncConflictCount = 0,
  isExternalSyncing = false,
  onOpenNotificationSettings,
  isNotificationEnabled = false,
  scheduledAlertCount = 0,
  onOpenCollabHub,
  collabRoomCount = 0,
  onImportIcsFile,
  onExportWorkspaceJson,
  onImportWorkspaceJsonFile,
  showToast,
}) => {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language || 'ko';

  const prevLabel =
    viewMode === 'month' || viewMode === 'ops'
      ? `${t('common.prev', '이전')} (${t('calendar.viewMonth', '월')})`
      : viewMode === 'week'
      ? `${t('common.prev', '이전')} (${t('calendar.viewWeek', '주')})`
      : `${t('common.prev', '이전')} (${t('calendar.viewDay', '일')})`;

  const nextLabel =
    viewMode === 'month' || viewMode === 'ops'
      ? `${t('common.next', '다음')} (${t('calendar.viewMonth', '월')})`
      : viewMode === 'week'
      ? `${t('common.next', '다음')} (${t('calendar.viewWeek', '주')})`
      : `${t('common.next', '다음')} (${t('calendar.viewDay', '일')})`;

  return (
    <header className="h-11 bg-[#0c0e14] border-b border-white/[0.04] px-3.5 sm:px-5 flex items-center justify-between gap-3 select-none shrink-0 z-30">
      {/* Zone 1: 좌측 패널 토글 및 단일 브랜드 워드마크 */}
      <div className="flex items-center gap-2.5 shrink-0">
        <TopBarTooltip
          label={isSidebarOpen ? t('common.sidebarClose', '컨시어지 패널 닫기') : t('common.sidebarOpen', '컨시어지 패널 열기')}
          align="left"
        >
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={isSidebarOpen ? t('common.sidebarClose', '컨시어지 패널 닫기') : t('common.sidebarOpen', '컨시어지 패널 열기')}
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
          {t('common.appTitleFull', '바이브 캘린더 Vibe Calendar')}
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

        <TopBarTooltip label={t('common.today', '오늘 날짜로 이동')} shortcut="T">
          <button
            type="button"
            onClick={onToday}
            className="text-[13px] font-medium text-white hover:text-neutral-200 px-1.5 tracking-tight tabular-nums whitespace-nowrap transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25 rounded-md"
          >
            {viewMode === 'month' && getLocalizedMonthLabel(currentYear, currentMonth, currentLocale)}
            {viewMode === 'week' && `${currentYear} · ${getLocalizedWeekRangeLabel(selectedDate, currentLocale)}`}
            {viewMode === 'agenda' && formatLocalizedDate(selectedDate, currentLocale)}
            {viewMode === 'ops' && `${t('calendar.viewOpsTooltip', '공정 런시트')} · ${getLocalizedMonthLabel(currentYear, currentMonth, currentLocale)}`}
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

        <TopBarTooltip label={t('common.today', '오늘로 이동')} shortcut="T">
          <button
            type="button"
            onClick={onToday}
            className="ml-0.5 px-1.5 h-6 rounded-md text-xs font-normal text-neutral-500 hover:text-white hover:bg-white/[0.05] transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
          >
            {t('common.today', '오늘')}
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
          {[
            { mode: 'month' as const, label: t('calendar.viewMonth', '월'), tooltip: t('calendar.viewMonthTooltip', '월간 뷰 (M)'), shortcut: 'M' },
            { mode: 'week' as const, label: t('calendar.viewWeek', '주'), tooltip: t('calendar.viewWeekTooltip', '주간 뷰 (W)'), shortcut: 'W' },
            { mode: 'agenda' as const, label: t('calendar.viewDay', '일'), tooltip: t('calendar.viewDayTooltip', '일간 뷰 (D)'), shortcut: 'D' },
            { mode: 'ops' as const, label: t('calendar.viewOps', '공정'), tooltip: t('calendar.viewOpsTooltip', '공정 런시트 (O)'), shortcut: 'O' },
          ].map(({ mode, label, tooltip, shortcut }) => {
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

          {onOpenExternalSync && (
            <TopBarTooltip
              label={
                syncConflictCount > 0
                  ? `외부 동기화 · 충돌 ${syncConflictCount}건`
                  : syncedAccountCount > 0
                  ? `외부 캘린더 동기화 (${syncedAccountCount})`
                  : '외부 캘린더 · CalDAV 동기화'
              }
              shortcut="S"
              align="right"
            >
              <button
                type="button"
                onClick={onOpenExternalSync}
                aria-label="외부 캘린더 및 CalDAV 동기화 허브"
                className={`relative h-7 w-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25 ${
                  syncConflictCount > 0
                    ? 'text-amber-300 hover:text-amber-200 hover:bg-white/[0.06]'
                    : syncedAccountCount > 0
                    ? 'text-neutral-200 hover:text-white hover:bg-white/[0.06]'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <RefreshCw
                  className={`w-[14.5px] h-[14.5px] ${isExternalSyncing ? 'animate-spin' : ''}`}
                  strokeWidth={1.65}
                />
                {syncConflictCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400"
                  />
                )}
              </button>
            </TopBarTooltip>
          )}

          {onOpenNotificationSettings && (
            <TopBarTooltip
              label={
                isNotificationEnabled
                  ? scheduledAlertCount > 0
                    ? `알림 엔진 활성 · 예약 ${scheduledAlertCount}건`
                    : '알림 · 백그라운드 푸시 활성'
                  : '고급 알림 · 백그라운드 푸시 설정'
              }
              shortcut="B"
              align="right"
            >
              <button
                type="button"
                onClick={onOpenNotificationSettings}
                aria-label="고급 알림 및 백그라운드 푸시 설정"
                className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25 ${
                  isNotificationEnabled
                    ? 'text-neutral-200 hover:text-white hover:bg-white/[0.06]'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <Bell className="w-[14.5px] h-[14.5px]" strokeWidth={1.65} />
              </button>
            </TopBarTooltip>
          )}

          {onOpenCollabHub && (
            <TopBarTooltip
              label={
                collabRoomCount > 0
                  ? `라이브 협업 룸 (${collabRoomCount})`
                  : '라이브 협업 · 실시간 조율 허브'
              }
              shortcut="R"
              align="right"
            >
              <button
                type="button"
                onClick={onOpenCollabHub}
                aria-label="라이브 협업 및 실시간 시간대 조율 허브"
                className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/25 ${
                  collabRoomCount > 0
                    ? 'text-neutral-200 hover:text-white hover:bg-white/[0.06]'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <Users className="w-[14.5px] h-[14.5px]" strokeWidth={1.65} />
              </button>
            </TopBarTooltip>
          )}

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

          <LanguageSelector />

          {vaultSlot}

          {onOpenCreateEvent && (
            <TopBarTooltip label={t('calendar.newEvent', '새 일정')} shortcut="N" align="right">
              <button
                type="button"
                onClick={onOpenCreateEvent}
                aria-label={t('calendar.newEvent', '새 일정')}
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

