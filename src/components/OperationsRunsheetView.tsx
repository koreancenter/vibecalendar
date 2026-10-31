import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Circle,
  Columns3,
  ListChecks,
  MapPin,
  Plus,
  Repeat,
  Search,
  Sparkles,
  Table2,
  Wand2,
  X,
} from 'lucide-react';
import { CalendarEventItem, ProjectItem } from '../types';
import {
  addDays,
  formatKoreanDateWithDay,
  getEventDateSpan,
  getTodayDateString,
  parseLocalDate,
} from '../shared/dateUtils';
import {
  expandRecurringEventsForRange,
  formatRecurrenceShortLabel,
} from '../shared/recurrenceUtils';
import { hasEventConflict } from '../shared/scheduleUtils';
import {
  areShallowArraysEqual,
  CalendarEventViewModel,
  useCalendarEventViewModels,
} from '../hooks/useCalendarEventViewModels';
import { getEventChecklistStats } from './common/LuxuryEventChip';
import { DayInspectorPanel } from './DayInspectorPanel';
import { EventDetailContent } from './EventDetailContent';

type OpsFilterKey = 'all' | 'pending' | 'overdue' | 'checklist' | 'conflict';
type OpsSubLayout = 'table' | 'board';

interface OperationsRunsheetViewProps {
  events: CalendarEventItem[];
  selectedDate: string;
  selectedDateEvents: CalendarEventItem[];
  selectedEvent: CalendarEventItem | null;
  viewerTimeZone: string;
  projects?: ProjectItem[];
  selectedProjectId?: string | 'all';
  comparedProjectIds?: string[];
  emptyGuideText?: string;
  isWorkspaceEmpty?: boolean;
  onLoadSampleData?: () => void;
  onSelectDate: (date: string) => void;
  onSelectEvent: (event: CalendarEventItem | null) => void;
  onDeleteEvent: (id: string) => void;
  onToggleComplete: (id: string) => void;
  onToggleChecklistItem: (eventId: string, itemId: string) => void;
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
  onQuickAiPromptForDate: (date: string) => void;
  onRequestReverseMilestones: (prompt: string) => void;
  onAutoRebalance?: () => void;
}

function formatSignedDday(targetDateStr: string, baseTodayStr: string): string {
  const targetMs = parseLocalDate(targetDateStr).getTime();
  const todayMs = parseLocalDate(baseTodayStr).getTime();
  const diffDays = Math.round((targetMs - todayMs) / 86_400_000);
  if (diffDays === 0) return 'D-Day';
  if (diffDays > 0) return `D-${diffDays}`;
  return `D+${Math.abs(diffDays)}`;
}

const OperationsRunsheetViewComponent: React.FC<OperationsRunsheetViewProps> = ({
  events,
  selectedDate,
  selectedDateEvents,
  selectedEvent,
  viewerTimeZone,
  projects = [],
  selectedProjectId = 'all',
  comparedProjectIds = [],
  emptyGuideText,
  isWorkspaceEmpty = false,
  onLoadSampleData,
  onSelectDate,
  onSelectEvent,
  onDeleteEvent,
  onToggleComplete,
  onToggleChecklistItem,
  onUpdateProject,
  onUpdateTimeZone,
  onUpdateLocation,
  onUpdateEventFields,
  onAddChecklistItem,
  onUpdateChecklistItemText,
  onDeleteChecklistItem,
  onOpenCreateEvent,
  onShareEvent,
  onQuickAiPromptForDate,
  onRequestReverseMilestones,
  onAutoRebalance,
}) => {
  const [filterKey, setFilterKey] = useState<OpsFilterKey>('all');
  const [subLayout, setSubLayout] = useState<OpsSubLayout>('table');
  const [searchQuery, setSearchQuery] = useState('');

  const todayStr = useMemo(() => getTodayDateString(), []);
  const sevenDaysOutStr = useMemo(() => addDays(todayStr, 7), [todayStr]);

  const activeProject = useMemo(() => {
    if (!selectedProjectId || selectedProjectId === 'all') return null;
    return projects.find((p) => p.id === selectedProjectId) || null;
  }, [projects, selectedProjectId]);

  const { rangeStart, rangeEnd } = useMemo(() => {
    let start = addDays(todayStr, -60);
    let end = addDays(todayStr, 180);
    if (activeProject?.startDate && activeProject.startDate < start) {
      start = addDays(activeProject.startDate, -30);
    }
    if (activeProject?.endDate && activeProject.endDate > end) {
      end = addDays(activeProject.endDate, 14);
    }
    return { rangeStart: start, rangeEnd: end };
  }, [todayStr, activeProject]);

  const expandedEvents = useMemo(
    () => expandRecurringEventsForRange(events, rangeStart, rangeEnd, 180),
    [events, rangeStart, rangeEnd]
  );

  const { viewModels, byEventId, getViewModel } = useCalendarEventViewModels({
    events: expandedEvents,
    projects,
    viewerTimeZone,
  });

  const sortedViewModels = useMemo(() => {
    return [...viewModels].sort((a, b) => {
      const dateCmp = a.timing.localDate.localeCompare(b.timing.localDate);
      if (dateCmp !== 0) return dateCmp;
      if (a.event.isAllDay && !b.event.isAllDay) return -1;
      if (!a.event.isAllDay && b.event.isAllDay) return 1;
      return a.timing.localStartTime.localeCompare(b.timing.localStartTime);
    });
  }, [viewModels]);

  const conflictingEventIds = useMemo(() => {
    const byDate = new Map<string, CalendarEventItem[]>();
    for (const vm of sortedViewModels) {
      if (vm.event.isAllDay) continue;
      const spanned = getEventDateSpan(vm.timing.localDate, vm.event.endDate);
      for (const dStr of spanned) {
        const list = byDate.get(dStr);
        if (list) {
          list.push(vm.projectedEvent);
        } else {
          byDate.set(dStr, [vm.projectedEvent]);
        }
      }
    }

    const conflicts = new Set<string>();
    byDate.forEach((dayProjected) => {
      if (dayProjected.length < 2) return;
      for (const projEv of dayProjected) {
        if (hasEventConflict(projEv, dayProjected)) {
          conflicts.add(projEv.id);
        }
      }
    });
    return conflicts;
  }, [sortedViewModels]);

  const ddayAnchor = useMemo(() => {
    if (activeProject?.startDate) {
      const targetDate =
        activeProject.startDate < todayStr &&
        activeProject.endDate &&
        activeProject.endDate >= todayStr
          ? activeProject.endDate
          : activeProject.startDate;
      return {
        label: activeProject.name,
        date: targetDate,
        ddayText: formatSignedDday(targetDate, todayStr),
      };
    }

    const upcomingMilestone = sortedViewModels.find(
      (vm) =>
        !vm.event.isCompleted &&
        vm.timing.localDate >= todayStr &&
        vm.event.category === '행사·세미나'
    );
    if (upcomingMilestone) {
      return {
        label: upcomingMilestone.event.title,
        date: upcomingMilestone.timing.localDate,
        ddayText: formatSignedDday(upcomingMilestone.timing.localDate, todayStr),
      };
    }

    const nextAny = sortedViewModels.find(
      (vm) => !vm.event.isCompleted && vm.timing.localDate >= todayStr
    );
    if (nextAny) {
      return {
        label: nextAny.event.title,
        date: nextAny.timing.localDate,
        ddayText: formatSignedDday(nextAny.timing.localDate, todayStr),
      };
    }

    return null;
  }, [activeProject, sortedViewModels, todayStr]);

  const stats = useMemo(() => {
    let total = 0;
    let completed = 0;
    let pending = 0;
    let overdue = 0;
    let withPendingChecklist = 0;
    let remainingChecklistItems = 0;
    let conflictCount = 0;

    for (const vm of sortedViewModels) {
      total += 1;
      const isDone = Boolean(vm.event.isCompleted);
      if (isDone) {
        completed += 1;
      } else {
        pending += 1;
        if (vm.timing.localDate < todayStr) {
          overdue += 1;
        }
      }

      const chk = getEventChecklistStats(vm.event);
      if (!isDone && chk.total > chk.done) {
        withPendingChecklist += 1;
        remainingChecklistItems += chk.total - chk.done;
      }

      if (conflictingEventIds.has(vm.event.id)) {
        conflictCount += 1;
      }
    }

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return {
      total,
      completed,
      pending,
      overdue,
      withPendingChecklist,
      remainingChecklistItems,
      conflictCount,
      completionRate,
    };
  }, [sortedViewModels, todayStr, conflictingEventIds]);

  const filteredViewModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedViewModels.filter((vm) => {
      const ev = vm.event;
      const isDone = Boolean(ev.isCompleted);

      if (filterKey === 'pending' && isDone) return false;
      if (filterKey === 'overdue' && (isDone || vm.timing.localDate >= todayStr)) return false;
      if (filterKey === 'checklist') {
        const chk = getEventChecklistStats(ev);
        if (isDone || chk.total <= chk.done) return false;
      }
      if (filterKey === 'conflict' && !conflictingEventIds.has(ev.id)) return false;

      if (q) {
        const checkTexts = (ev.checklist || []).map((c) => c.text).join(' ');
        const projName = vm.theme.project?.name || '';
        const projCode = vm.theme.project?.code || '';
        const haystack = [
          ev.title,
          ev.category,
          ev.location || '',
          ev.locationAddress || '',
          ev.content || '',
          projName,
          projCode,
          checkTexts,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [sortedViewModels, filterKey, searchQuery, todayStr, conflictingEventIds]);

  const groupedByDate = useMemo(() => {
    const groups: Array<{ date: string; items: CalendarEventViewModel[] }> = [];
    const indexByDate = new Map<string, number>();

    for (const vm of filteredViewModels) {
      const dStr = vm.timing.localDate;
      const existingIdx = indexByDate.get(dStr);
      if (existingIdx !== undefined) {
        groups[existingIdx].items.push(vm);
      } else {
        indexByDate.set(dStr, groups.length);
        groups.push({ date: dStr, items: [vm] });
      }
    }

    return groups;
  }, [filteredViewModels]);

  const boardColumns = useMemo(() => {
    const overdueCol: CalendarEventViewModel[] = [];
    const weekCol: CalendarEventViewModel[] = [];
    const upcomingOrDoneCol: CalendarEventViewModel[] = [];

    for (const vm of filteredViewModels) {
      const d = vm.timing.localDate;
      const isDone = Boolean(vm.event.isCompleted);
      if (!isDone && d < todayStr) {
        overdueCol.push(vm);
      } else if (!isDone && d >= todayStr && d <= sevenDaysOutStr) {
        weekCol.push(vm);
      } else {
        upcomingOrDoneCol.push(vm);
      }
    }

    return [
      {
        id: 'overdue',
        title: '기한 경과 · 즉시 점검',
        subtitle: '미완료 지연 공정',
        items: overdueCol,
        accentClass: overdueCol.length > 0 ? 'text-rose-300' : 'text-neutral-300',
      },
      {
        id: 'this_week',
        title: '이번 주 실행 (7일 이내)',
        subtitle: `${todayStr.slice(5)} – ${sevenDaysOutStr.slice(5)}`,
        items: weekCol,
        accentClass: 'text-white',
      },
      {
        id: 'upcoming_done',
        title: '예정 및 완료 공정',
        subtitle: '차주 이후 · 완료 항목',
        items: upcomingOrDoneCol,
        accentClass: 'text-neutral-300',
      },
    ];
  }, [filteredViewModels, todayStr, sevenDaysOutStr]);

  const handleTriggerReverseMilestones = () => {
    const targetDate = ddayAnchor?.date || selectedDate;
    const subjectName = activeProject?.name || ddayAnchor?.label || '신규 본행사';
    const prompt = `${targetDate} 개최 예정인 '${subjectName}' D-Day를 기준으로 D-30 기획 확정, D-21 연사·장소 계약, D-14 초청·홍보 발송, D-7 장비·케이터링 최종 점검, D-1 현장 리허설, D+2 사후 정산까지 핵심 준비 마일스톤과 사전 체크리스트를 역산하여 일괄 등록해 줘`;
    onRequestReverseMilestones(prompt);
  };

  const handleRowSelect = (vm: CalendarEventViewModel) => {
    onSelectDate(vm.timing.localDate);
    onSelectEvent(vm.event);
  };

  const showProjectMeta = selectedProjectId === 'all' || comparedProjectIds.length >= 2;

  const selectedEventConflict = useMemo(() => {
    if (!selectedEvent) return false;
    return conflictingEventIds.has(selectedEvent.id);
  }, [selectedEvent, conflictingEventIds]);

  const filterTabs: Array<{ key: OpsFilterKey; label: string; count: number }> = [
    { key: 'all', label: '전체', count: stats.total },
    { key: 'pending', label: '미완료', count: stats.pending },
    { key: 'overdue', label: '기한 경과', count: stats.overdue },
    { key: 'checklist', label: '체크 잔여', count: stats.withPendingChecklist },
    { key: 'conflict', label: '시간 중첩', count: stats.conflictCount },
  ];

  return (
    <div className="flex-1 flex flex-row h-full overflow-hidden select-none bg-[#0c0e14]">
      {/* 좌측: 공정 런시트 · 준비 상태 보드 메인 캔버스 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* 1. 상단 공정 헤더 (h-10 수평 그리드 정렬) */}
        <div className="h-10 px-4 border-b border-white/[0.06] bg-[#101218] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs min-w-0 truncate">
            <span className="font-medium text-white tracking-tight truncate">
              {activeProject ? activeProject.name : '전체 행사 공정 런시트'}
            </span>
            {ddayAnchor && (
              <>
                <span aria-hidden="true" className="text-neutral-600 shrink-0">
                  ·
                </span>
                <span className="font-mono tabular-nums text-neutral-200 font-medium whitespace-nowrap shrink-0">
                  {ddayAnchor.ddayText}
                </span>
                <span className="text-[11px] text-neutral-400 font-mono tabular-nums hidden md:inline whitespace-nowrap shrink-0">
                  ({ddayAnchor.date})
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* 서브 레이아웃 전환: 런시트 표 / 준비 보드 */}
            <div
              className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]"
              role="tablist"
              aria-label="공정 표시 방식"
            >
              <button
                type="button"
                role="tab"
                aria-selected={subLayout === 'table'}
                onClick={() => setSubLayout('table')}
                className={`h-6 px-2 rounded-md text-[11px] inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  subLayout === 'table'
                    ? 'bg-white/[0.11] text-white font-medium'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Table2 className="w-3 h-3 shrink-0" />
                <span>런시트 표</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={subLayout === 'board'}
                onClick={() => setSubLayout('board')}
                className={`h-6 px-2 rounded-md text-[11px] inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  subLayout === 'board'
                    ? 'bg-white/[0.11] text-white font-medium'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Columns3 className="w-3 h-3 shrink-0" />
                <span>준비 보드</span>
              </button>
            </div>

            {onAutoRebalance && (
              <button
                type="button"
                onClick={onAutoRebalance}
                className={`h-7 px-2.5 rounded-lg text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  (filterTabs.find((t) => t.key === 'conflict')?.count || 0) +
                    (filterTabs.find((t) => t.key === 'overdue')?.count || 0) >
                  0
                    ? 'border border-amber-400/35 bg-amber-400/[0.08] text-amber-200 hover:bg-amber-400/[0.15]'
                    : 'bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.09] text-neutral-200'
                }`}
                title="겹치는 시간제 일정과 미완료 지연 공정을 빈 업무 시간대(09:00~19:00 우선)로 자동 재배치합니다"
              >
                <Wand2 className="w-3 h-3 shrink-0" />
                <span>충돌·지연 자동 재배치</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleTriggerReverseMilestones}
              className="h-7 px-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-[11px] font-medium text-neutral-100 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="선택된 행사 또는 날짜를 기준으로 D-30 ~ D-Day 역산 공정과 체크리스트를 AI로 자동 생성합니다"
            >
              <Sparkles className="w-3 h-3 text-neutral-200 shrink-0" />
              <span>D-Day 역산 공정 설계</span>
            </button>
          </div>
        </div>

        {/* 2. 무박스 지표 요약 & 상태 필터 · 실시간 검색 바 */}
        <div className="px-4 py-2.5 border-b border-white/[0.06] bg-[#0f1219] flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-1 flex-wrap">
            {filterTabs.map((tab) => {
              const active = filterKey === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilterKey(tab.key)}
                  className={`h-7 px-2.5 rounded-lg text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white/[0.10] text-white font-medium'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04]'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`font-mono tabular-nums text-[11px] ${
                      active
                        ? 'text-neutral-200'
                        : tab.key === 'overdue' && tab.count > 0
                        ? 'text-rose-300'
                        : tab.key === 'conflict' && tab.count > 0
                        ? 'text-amber-300'
                        : 'text-neutral-500'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <div className="hidden xl:flex items-center gap-2 text-[11px] text-neutral-400 font-mono tabular-nums whitespace-nowrap">
              <span>
                달성률 <strong className="text-neutral-200 font-medium">{stats.completionRate}%</strong> ({stats.completed}/{stats.total})
              </span>
              <span aria-hidden="true" className="text-neutral-600">
                ·
              </span>
              <span>
                잔여 체크 <strong className="text-neutral-200 font-medium">{stats.remainingChecklistItems}</strong>건
              </span>
            </div>

            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="공정 · 장소 · 체크항목 필터..."
                className="h-7 w-44 sm:w-52 pl-8 pr-6 rounded-lg bg-[#0b0d13] border border-white/[0.08] focus:border-white/22 text-xs text-neutral-100 placeholder:text-neutral-500 outline-hidden transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 p-0.5 text-neutral-500 hover:text-neutral-200 cursor-pointer"
                  title="필터 초기화"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 3. 본문 영역: 빈 상태 / 런시트 표 / 3열 준비 보드 */}
        {sortedViewModels.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="luxury-glass-border relative rounded-xl bg-gradient-to-b from-[#181c27]/78 via-[#11141d]/76 to-[#0c0e15]/84 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.78),0_8px_20px_-4px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)] px-6 py-5 text-center space-y-3.5 overflow-hidden">
              <p className="text-[13px] font-medium text-neutral-100 tracking-tight">
                {emptyGuideText || '등록된 행사 공정 일정이 없습니다'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleTriggerReverseMilestones}
                  className="h-9 px-4 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>D-Day 역산 공정 설계</span>
                </button>
                {onOpenCreateEvent && (
                  <button
                    type="button"
                    onClick={() => onOpenCreateEvent(selectedDate)}
                    className="h-9 px-4 rounded-lg bg-white/[0.08] hover:bg-white/[0.13] border border-white/[0.09] text-xs font-medium text-neutral-200 hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>새 일정 등록</span>
                  </button>
                )}
                {isWorkspaceEmpty && onLoadSampleData && (
                  <button
                    type="button"
                    onClick={onLoadSampleData}
                    className="h-9 px-4 rounded-lg bg-white/[0.08] hover:bg-white/[0.13] border border-white/[0.09] text-xs font-medium text-neutral-200 hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                    <span>샘플 데이터 불러오기</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : filteredViewModels.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2">
            <p className="text-xs text-neutral-400">선택한 필터 조건에 해당하는 공정이 없습니다.</p>
            <button
              type="button"
              onClick={() => {
                setFilterKey('all');
                setSearchQuery('');
              }}
              className="h-7 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] text-xs text-neutral-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              전체 공정 보기
            </button>
          </div>
        ) : subLayout === 'table' ? (
          <div className="flex-1 overflow-y-auto">
            {/* 컬럼 헤더 */}
            <div className="sticky top-0 z-10 h-8 px-4 bg-[#0e1118]/95 backdrop-blur-xs border-b border-white/[0.06] grid grid-cols-[28px_98px_1fr_92px] md:grid-cols-[28px_106px_1fr_168px_104px] items-center gap-3 text-[11px] text-neutral-500 font-medium">
              <span className="sr-only">완료</span>
              <span>시간</span>
              <span>공정 · 분류 · 프로젝트</span>
              <span className="hidden md:block">장소</span>
              <span className="text-right">체크리스트</span>
            </div>

            {groupedByDate.map((group) => {
              const isTodayGroup = group.date === todayStr;
              const ddayTag = formatSignedDday(group.date, todayStr);
              return (
                <section key={group.date} className="border-b border-white/[0.05]">
                  {/* 일자 섹션 구분선 */}
                  <div className="h-8 px-4 bg-[#11141d] border-b border-white/[0.045] flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 font-mono tabular-nums min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelectDate(group.date)}
                        className={`font-medium hover:underline cursor-pointer whitespace-nowrap ${
                          isTodayGroup ? 'text-white' : 'text-neutral-200'
                        }`}
                      >
                        {formatKoreanDateWithDay(group.date, false)}
                      </button>
                      <span aria-hidden="true" className="text-neutral-600">
                        ·
                      </span>
                      <span
                        className={`text-[11px] whitespace-nowrap ${
                          ddayTag === 'D-Day'
                            ? 'text-white font-semibold'
                            : group.date < todayStr
                            ? 'text-neutral-500'
                            : 'text-neutral-400'
                        }`}
                      >
                        {ddayTag}
                      </span>
                    </div>

                    <span className="text-[11px] font-mono tabular-nums text-neutral-500 whitespace-nowrap shrink-0">
                      {group.items.length}건
                    </span>
                  </div>

                  {/* 일자별 공정 행 */}
                  <div className="divide-y divide-white/[0.04]">
                    {group.items.map((vm) => {
                      const ev = vm.event;
                      const isSelected = selectedEvent?.id === ev.id;
                      const isDone = Boolean(ev.isCompleted);
                      const isOverdue = !isDone && vm.timing.localDate < todayStr;
                      const hasConflict = conflictingEventIds.has(ev.id);
                      const chk = getEventChecklistStats(ev);
                      const recShort = formatRecurrenceShortLabel(ev.recurrence);
                      const proj = vm.theme.project;

                      return (
                        <div
                          key={ev.id}
                          onClick={() => handleRowSelect(vm)}
                          className={`min-h-[42px] px-4 py-2 grid grid-cols-[28px_98px_1fr_92px] md:grid-cols-[28px_106px_1fr_168px_104px] items-center gap-3 transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-white/[0.075]'
                              : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          {/* 1. 완료 토글 */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleComplete(ev.id);
                            }}
                            className="text-neutral-500 hover:text-emerald-400 transition-colors cursor-pointer flex items-center justify-center"
                            title={isDone ? '완료 해제' : '공정 완료 처리'}
                          >
                            {isDone ? (
                              <CheckCircle className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <Circle className="w-4 h-4" />
                            )}
                          </button>

                          {/* 2. 시간 */}
                          <span className="font-mono tabular-nums text-xs text-neutral-300 whitespace-nowrap">
                            {ev.isAllDay
                              ? '종일'
                              : `${vm.timing.localStartTime}–${vm.timing.localEndTime}`}
                          </span>

                          {/* 3. 제목 + 무박스 메타데이터 */}
                          <div className="min-w-0 flex flex-col gap-0.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${vm.theme.dotClass}`}
                              />
                              <span
                                className={`text-xs font-medium truncate ${
                                  isDone ? 'line-through text-neutral-500' : 'text-neutral-100'
                                }`}
                              >
                                {ev.title}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 pl-3.5 truncate">
                              {showProjectMeta && proj && (
                                <>
                                  <span className={`truncate max-w-[110px] ${vm.theme.accentTextClass}`}>
                                    {proj.code || proj.name}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                </>
                              )}
                              <span className="shrink-0">{ev.category}</span>
                              {recShort && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="inline-flex items-center gap-0.5 text-neutral-300 shrink-0">
                                    <Repeat className="w-2.5 h-2.5" />
                                    <span>{recShort}</span>
                                  </span>
                                </>
                              )}
                              {isOverdue && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-rose-300 shrink-0">기한 경과</span>
                                </>
                              )}
                              {hasConflict && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="inline-flex items-center gap-0.5 text-amber-300 shrink-0">
                                    <AlertTriangle className="w-2.5 h-2.5" />
                                    <span>시간 중첩</span>
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* 4. 장소 */}
                          <div className="hidden md:flex items-center gap-1 min-w-0 text-xs text-neutral-400">
                            {ev.location || ev.locationAddress ? (
                              <>
                                <MapPin className="w-3 h-3 text-neutral-500 shrink-0" />
                                <span className="truncate">
                                  {ev.location || ev.locationAddress}
                                </span>
                              </>
                            ) : (
                              <span className="text-neutral-600">—</span>
                            )}
                          </div>

                          {/* 5. 체크리스트 진행도 */}
                          <div className="flex flex-col items-end justify-center gap-1">
                            {chk.total > 0 ? (
                              <>
                                <span className="font-mono tabular-nums text-[11px] text-neutral-300 inline-flex items-center gap-1">
                                  <ListChecks className="w-3 h-3 text-neutral-500 shrink-0" />
                                  <span>
                                    {chk.done}/{chk.total}
                                  </span>
                                </span>
                                <div className="w-16 h-[1.5px] rounded-full bg-white/[0.08] overflow-hidden">
                                  <div
                                    style={{ width: `${chk.rate}%` }}
                                    className="h-full bg-white/80 rounded-full"
                                  />
                                </div>
                              </>
                            ) : (
                              <span className="font-mono text-[11px] text-neutral-600">—</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          /* 3열 준비 상태 보드 (단일 엘리베이션 레인 + 내부 헤어라인 행) */
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            {boardColumns.map((col) => (
              <div
                key={col.id}
                className="rounded-xl bg-[#10131b] border border-white/[0.06] flex flex-col overflow-hidden min-h-[240px]"
              >
                <div className="px-3.5 py-2.5 border-b border-white/[0.06] bg-[#121620] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className={`text-xs font-semibold truncate ${col.accentClass}`}>
                      {col.title}
                    </h3>
                    <p className="text-[10.5px] text-neutral-500 font-mono tabular-nums">
                      {col.subtitle}
                    </p>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-neutral-400 shrink-0">
                    {col.items.length}
                  </span>
                </div>

                {col.items.length === 0 ? (
                  <div className="py-10 px-4 text-center text-[11px] text-neutral-500">
                    해당 상태의 공정이 없습니다
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.05]">
                    {col.items.map((vm) => {
                      const ev = vm.event;
                      const isSelected = selectedEvent?.id === ev.id;
                      const isDone = Boolean(ev.isCompleted);
                      const chk = getEventChecklistStats(ev);
                      const recShort = formatRecurrenceShortLabel(ev.recurrence);

                      return (
                        <div
                          key={ev.id}
                          onClick={() => handleRowSelect(vm)}
                          className={`px-3.5 py-2.5 space-y-1 transition-colors cursor-pointer ${
                            isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.035]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleComplete(ev.id);
                                }}
                                className="mt-0.5 text-neutral-500 hover:text-emerald-400 transition-colors cursor-pointer shrink-0"
                              >
                                {isDone ? (
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Circle className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <span
                                className={`text-xs font-medium leading-snug break-keep ${
                                  isDone ? 'line-through text-neutral-500' : 'text-neutral-100'
                                }`}
                              >
                                {ev.title}
                              </span>
                            </div>
                          </div>

                          <div className="pl-5.5 flex items-center gap-1.5 text-[10.5px] text-neutral-400 font-mono tabular-nums flex-wrap">
                            <span>{vm.timing.localDate.slice(5)}</span>
                            <span aria-hidden="true" className="text-neutral-600">
                              ·
                            </span>
                            <span>
                              {ev.isAllDay ? '종일' : vm.timing.localStartTime}
                            </span>
                            {recShort && (
                              <>
                                <span aria-hidden="true" className="text-neutral-600">
                                  ·
                                </span>
                                <span className="text-neutral-300">{recShort}</span>
                              </>
                            )}
                            {chk.total > 0 && (
                              <>
                                <span aria-hidden="true" className="text-neutral-600">
                                  ·
                                </span>
                                <span>
                                  체크 {chk.done}/{chk.total}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 우측 데스크톱 인스펙터 패널 (DayAgendaView와 동일한 즉시 인라인 편집 경험) */}
      <div className="hidden lg:flex h-full shrink-0">
        <DayInspectorPanel
          selectedDate={selectedDate}
          events={selectedDateEvents}
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
          onOpenCreateEvent={onOpenCreateEvent}
          onShareEvent={onShareEvent}
          emptyGuideText={emptyGuideText}
        />
      </div>

      {/* 모바일·태블릿(< lg)에서 항목 선택 시 인라인 상세 오버레이 */}
      {selectedEvent && (
        <div
          onClick={() => onSelectEvent(null)}
          className="lg:hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-[#12151e] border border-white/[0.10] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
          >
            <EventDetailContent
              event={
                (byEventId.get(selectedEvent.id) ?? getViewModel(selectedEvent)).event
              }
              viewerTimeZone={viewerTimeZone}
              hasConflict={selectedEventConflict}
              projects={projects}
              variant="modal"
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
              onDelete={(id) => {
                onSelectEvent(null);
                onDeleteEvent(id);
              }}
              onClose={() => onSelectEvent(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

function areOperationsRunsheetViewPropsEqual(
  prev: OperationsRunsheetViewProps,
  next: OperationsRunsheetViewProps
): boolean {
  return (
    prev.selectedDate === next.selectedDate &&
    prev.selectedEvent === next.selectedEvent &&
    prev.viewerTimeZone === next.viewerTimeZone &&
    prev.selectedProjectId === next.selectedProjectId &&
    prev.emptyGuideText === next.emptyGuideText &&
    prev.isWorkspaceEmpty === next.isWorkspaceEmpty &&
    prev.onSelectDate === next.onSelectDate &&
    prev.onSelectEvent === next.onSelectEvent &&
    prev.onDeleteEvent === next.onDeleteEvent &&
    prev.onToggleComplete === next.onToggleComplete &&
    prev.onToggleChecklistItem === next.onToggleChecklistItem &&
    prev.onUpdateProject === next.onUpdateProject &&
    prev.onUpdateTimeZone === next.onUpdateTimeZone &&
    prev.onUpdateLocation === next.onUpdateLocation &&
    prev.onUpdateEventFields === next.onUpdateEventFields &&
    prev.onAddChecklistItem === next.onAddChecklistItem &&
    prev.onUpdateChecklistItemText === next.onUpdateChecklistItemText &&
    prev.onDeleteChecklistItem === next.onDeleteChecklistItem &&
    prev.onOpenCreateEvent === next.onOpenCreateEvent &&
    prev.onShareEvent === next.onShareEvent &&
    prev.onQuickAiPromptForDate === next.onQuickAiPromptForDate &&
    prev.onRequestReverseMilestones === next.onRequestReverseMilestones &&
    prev.onAutoRebalance === next.onAutoRebalance &&
    prev.onLoadSampleData === next.onLoadSampleData &&
    areShallowArraysEqual(prev.events, next.events) &&
    areShallowArraysEqual(prev.selectedDateEvents, next.selectedDateEvents) &&
    areShallowArraysEqual(prev.projects, next.projects) &&
    areShallowArraysEqual(prev.comparedProjectIds, next.comparedProjectIds)
  );
}

export const OperationsRunsheetView = React.memo(
  OperationsRunsheetViewComponent,
  areOperationsRunsheetViewPropsEqual
);
