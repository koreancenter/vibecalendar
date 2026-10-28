import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  Plus,
  Settings2,
  Check,
  X,
  Layers,
  Share2,
  ListFilter,
  BarChart2,
  CalendarSearch,
} from 'lucide-react';
import { ProjectItem, CalendarEventItem, CalendarCategory } from '../types';
import { getProjectThemeClasses, PROJECT_STATUS_MAP } from '../constants/projects';
import { CALENDAR_CATEGORIES } from '../constants/categories';
import { calculateCompletionStats } from '../shared/scheduleUtils';

interface ProjectSelectorBarProps {
  projects: ProjectItem[];
  events: CalendarEventItem[];
  selectedProjectId: string | 'all';
  selectedProjectIds: string[];
  isCompareMode: boolean;
  onSelectProject: (id: string | 'all') => void;
  onProjectClick: (id: string, multiModifier?: boolean) => void;
  onToggleProjectInComparison: (id: string) => void;
  onToggleCompareMode: () => void;
  onJumpToDate?: (date: string) => void;
  selectedCategory: CalendarCategory | '전체';
  onSelectCategory: (category: CalendarCategory | '전체') => void;
  onOpenCreateProject: () => void;
  onOpenManageProject: () => void;
  onShareProject?: (project: ProjectItem) => void;
}

function getProgressWidthClass(rate: number): string {
  if (rate <= 0) return 'w-0';
  if (rate <= 5) return 'w-[5%]';
  if (rate <= 10) return 'w-[10%]';
  if (rate <= 15) return 'w-[15%]';
  if (rate <= 20) return 'w-[20%]';
  if (rate <= 25) return 'w-[25%]';
  if (rate <= 30) return 'w-[30%]';
  if (rate <= 35) return 'w-[35%]';
  if (rate <= 40) return 'w-[40%]';
  if (rate <= 45) return 'w-[45%]';
  if (rate <= 50) return 'w-[50%]';
  if (rate <= 55) return 'w-[55%]';
  if (rate <= 60) return 'w-[60%]';
  if (rate <= 65) return 'w-[65%]';
  if (rate <= 70) return 'w-[70%]';
  if (rate <= 75) return 'w-[75%]';
  if (rate <= 80) return 'w-[80%]';
  if (rate <= 85) return 'w-[85%]';
  if (rate <= 90) return 'w-[90%]';
  if (rate <= 95) return 'w-[95%]';
  return 'w-full';
}

export const ProjectSelectorBar: React.FC<ProjectSelectorBarProps> = ({
  projects,
  events,
  selectedProjectId,
  selectedProjectIds,
  isCompareMode,
  onSelectProject,
  onProjectClick,
  onToggleCompareMode,
  onJumpToDate,
  selectedCategory,
  onSelectCategory,
  onOpenCreateProject,
  onOpenManageProject,
  onShareProject,
}) => {
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [isComparePopoverOpen, setIsComparePopoverOpen] = useState(false);
  const [overlapCursor, setOverlapCursor] = useState(0);

  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const comparePopoverRef = useRef<HTMLDivElement>(null);

  const isComparing = selectedProjectIds.length >= 2;
  const isMultiSelectActive = isCompareMode || isComparing;

  useEffect(() => {
    if (!isComparing) {
      setIsComparePopoverOpen(false);
      setOverlapCursor(0);
    }
  }, [isComparing]);

  useEffect(() => {
    if (!isCategoryOpen && !isComparePopoverOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (categoryMenuRef.current && !categoryMenuRef.current.contains(target)) {
        setIsCategoryOpen(false);
      }
      if (comparePopoverRef.current && !comparePopoverRef.current.contains(target)) {
        setIsComparePopoverOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCategoryOpen(false);
        setIsComparePopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isCategoryOpen, isComparePopoverOpen]);

  const selectedSet = useMemo(() => new Set(selectedProjectIds), [selectedProjectIds]);

  const selectedProjects = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p]));
    return selectedProjectIds
      .map((id) => byId.get(id))
      .filter((p): p is ProjectItem => Boolean(p));
  }, [projects, selectedProjectIds]);

  const activeProject = useMemo(
    () =>
      !isMultiSelectActive && selectedProjectId !== 'all'
        ? projects.find((p) => p.id === selectedProjectId) || null
        : null,
    [isMultiSelectActive, projects, selectedProjectId]
  );

  // 선택된 비교 프로젝트별 통계 및 중첩 일자 산출
  const comparisonSummary = useMemo(() => {
    if (!isComparing) {
      return {
        items: [],
        totalEvents: 0,
        avgRate: 0,
        overlapDates: [] as string[],
      };
    }

    const items = selectedProjects.map((proj) => {
      const projEvents = events.filter((e) => e.projectId === proj.id);
      const stats = calculateCompletionStats(projEvents);
      return {
        project: proj,
        stats,
      };
    });

    const totalEvents = items.reduce((acc, cur) => acc + cur.stats.total, 0);
    const avgRate =
      items.length > 0
        ? Math.round(items.reduce((acc, cur) => acc + cur.stats.rate, 0) / items.length)
        : 0;

    const projectsPerDate = new Map<string, Set<string>>();
    for (const ev of events) {
      if (ev.projectId && selectedSet.has(ev.projectId)) {
        const set = projectsPerDate.get(ev.date) || new Set<string>();
        set.add(ev.projectId);
        projectsPerDate.set(ev.date, set);
      }
    }

    const overlapDates = Array.from(projectsPerDate.entries())
      .filter(([, projSet]) => projSet.size >= 2)
      .map(([date]) => date)
      .sort((a, b) => a.localeCompare(b));

    return {
      items,
      totalEvents,
      avgRate,
      overlapDates,
    };
  }, [events, isComparing, selectedProjects, selectedSet]);

  const handleJumpNextOverlap = () => {
    const dates = comparisonSummary.overlapDates;
    if (dates.length === 0 || !onJumpToDate) return;
    const targetDate = dates[overlapCursor % dates.length];
    setOverlapCursor((prev) => (prev + 1) % dates.length);
    onJumpToDate(targetDate);
  };

  const categoryOptions: Array<CalendarCategory | '전체'> = ['전체', ...CALENDAR_CATEGORIES];
  const isAllSelected = selectedProjectIds.length === 0 && !isCompareMode;
  const isCategoryFiltered = selectedCategory !== '전체';

  return (
    <div className="shrink-0 z-20 select-none">
      <div className="h-10 bg-[#0c0e14] border-b border-white/[0.05] px-3.5 sm:px-5 flex items-center justify-between gap-4">
        {/* 좌측: 순수 타이포그래피 프로젝트 탭 + 무테 아이콘 액션 */}
        <div className="flex items-center gap-2 min-w-0 h-full">
          <div className="flex items-center gap-5 overflow-x-auto no-scrollbar h-full min-w-0">
            <button
              type="button"
              onClick={() => onSelectProject('all')}
              className={`relative h-full flex items-center text-xs tracking-tight transition-colors duration-150 shrink-0 cursor-pointer whitespace-nowrap ${
                isAllSelected
                  ? 'text-white font-medium after:content-[""] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1.5px] after:bg-white/95 after:rounded-full'
                  : 'text-neutral-500 hover:text-neutral-300 font-normal'
              }`}
            >
              전체
            </button>

            {projects.map((proj) => {
              const isSelected = selectedSet.has(proj.id);
              const theme = getProjectThemeClasses(proj.color);
              const underlineColorClass = isMultiSelectActive
                ? theme.underlineClass
                : 'after:bg-white/95';

              return (
                <button
                  key={proj.id}
                  type="button"
                  onClick={(e) =>
                    onProjectClick(proj.id, e.metaKey || e.ctrlKey || e.shiftKey)
                  }
                  className={`relative h-full flex items-center gap-1.5 text-xs tracking-tight transition-colors duration-150 shrink-0 cursor-pointer whitespace-nowrap ${
                    isSelected
                      ? `text-white font-medium after:content-[""] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1.5px] ${underlineColorClass} after:rounded-full`
                      : 'text-neutral-500 hover:text-neutral-200 font-normal'
                  }`}
                  title={
                    isMultiSelectActive
                      ? `${proj.name} (클릭하여 비교 대상 ${isSelected ? '해제' : '추가'})`
                      : isSelected
                      ? `${proj.name} (다시 클릭 시 전체 보기)`
                      : proj.name
                  }
                >
                  {isMultiSelectActive && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                        isSelected
                          ? theme.dotClass
                          : 'border border-neutral-600 bg-transparent'
                      }`}
                    />
                  )}
                  <span className="truncate max-w-[160px] sm:max-w-[220px]">{proj.name}</span>
                </button>
              );
            })}
          </div>

          {/* 순수 아이콘 전용 액션 클러스터 (비교 · 추가 · 관리) */}
          <div className="flex items-center gap-0.5 pl-1.5 shrink-0">
            {projects.length >= 2 && (
              <button
                type="button"
                onClick={onToggleCompareMode}
                aria-label="프로젝트 다중 비교"
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer shrink-0 ${
                  isMultiSelectActive
                    ? 'bg-white/[0.09] text-white'
                    : 'text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.05]'
                }`}
                title={
                  isMultiSelectActive
                    ? '다중 비교 모드 종료'
                    : '프로젝트 2개 이상 다중 비교'
                }
              >
                <Layers className="w-3.5 h-3.5" strokeWidth={1.65} />
              </button>
            )}

            <button
              type="button"
              onClick={onOpenCreateProject}
              aria-label="새 프로젝트 등록"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.05] transition-colors duration-150 cursor-pointer shrink-0"
              title="새 프로젝트 등록"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={1.65} />
            </button>

            <button
              type="button"
              onClick={onOpenManageProject}
              aria-label="프로젝트 관리"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.05] transition-colors duration-150 cursor-pointer shrink-0"
              title="프로젝트 관리"
            >
              <Settings2 className="w-3.5 h-3.5" strokeWidth={1.65} />
            </button>
          </div>
        </div>

        {/* 우측: 순수 아이콘 전용 유틸리티 (공유 · 비교 지표 · 분류 필터) */}
        <div className="flex items-center gap-1 shrink-0">
          {/* 단일 프로젝트 포커스 시: 순수 공유 아이콘만 노출 */}
          {activeProject && onShareProject && (
            <button
              type="button"
              onClick={() => onShareProject(activeProject)}
              aria-label={`${activeProject.name} 브리핑 패스 공유`}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer shrink-0"
              title={`${activeProject.name} 브리핑 패스 공유`}
            >
              <Share2 className="w-3.5 h-3.5" strokeWidth={1.65} />
            </button>
          )}

          {/* 다중 프로젝트 비교 시: 순수 아이콘 액션 */}
          {isComparing && (
            <div className="relative flex items-center gap-1" ref={comparePopoverRef}>
              {comparisonSummary.overlapDates.length > 0 && (
                <button
                  type="button"
                  onClick={handleJumpNextOverlap}
                  aria-label="다음 중첩 일정일로 이동"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer shrink-0"
                  title={`중첩 일정일 순서대로 이동 (${comparisonSummary.overlapDates.length}일)`}
                >
                  <CalendarSearch className="w-3.5 h-3.5" strokeWidth={1.65} />
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsComparePopoverOpen((prev) => !prev)}
                aria-label="선택 프로젝트 비교 지표"
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer shrink-0 ${
                  isComparePopoverOpen
                    ? 'bg-white/[0.10] text-white'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.06]'
                }`}
                title="선택 프로젝트 비교 지표"
              >
                <BarChart2 className="w-3.5 h-3.5" strokeWidth={1.65} />
              </button>

              <button
                type="button"
                onClick={() => onSelectProject('all')}
                aria-label="비교 해제"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-white hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer shrink-0"
                title="비교 모드 해제"
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.65} />
              </button>

              {isComparePopoverOpen && (
                <div className="luxury-glass-border absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl bg-gradient-to-b from-[#181c27]/88 via-[#11141d]/84 to-[#0c0e15]/92 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.82),0_8px_20px_-4px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.05)] p-3.5 z-50 space-y-3 overflow-hidden">
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span className="text-neutral-200 font-medium">
                      프로젝트 비교 ({selectedProjects.length})
                    </span>
                    <span className="font-mono tabular-nums text-neutral-400">
                      총 {comparisonSummary.totalEvents}건 · 평균 {comparisonSummary.avgRate}%
                    </span>
                  </div>

                  <div className="divide-y divide-white/[0.06]">
                    {comparisonSummary.items.map(({ project: proj, stats }) => {
                      const theme = getProjectThemeClasses(proj.color);
                      const stInfo =
                        PROJECT_STATUS_MAP[proj.status] || PROJECT_STATUS_MAP.active;

                      return (
                        <div key={proj.id} className="py-2.5 first:pt-1 last:pb-1 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${theme.dotClass}`}
                              />
                              <span className="text-xs font-medium text-white truncate">
                                {proj.name}
                              </span>
                            </div>
                            <span className="text-[10px] text-neutral-400 shrink-0 whitespace-nowrap">
                              {stInfo.label}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-3 text-[10px] text-neutral-400 font-mono tabular-nums">
                            <span>
                              {proj.startDate ? proj.startDate.slice(5) : '--'} ~{' '}
                              {proj.endDate ? proj.endDate.slice(5) : '--'}
                            </span>
                            <span>
                              완료 {stats.completed}/{stats.total}건 ·{' '}
                              <strong className="text-neutral-200 font-semibold">
                                {stats.rate}%
                              </strong>
                            </span>
                          </div>

                          <div className="h-1 w-full rounded-full bg-white/[0.07] overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-200 ${theme.barClass} ${getProgressWidthClass(
                                stats.rate
                              )}`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-neutral-400">
                      <span>프로젝트 간 일정 중첩일</span>
                      <span className="font-mono tabular-nums text-neutral-300">
                        {comparisonSummary.overlapDates.length}일
                      </span>
                    </div>

                    {comparisonSummary.overlapDates.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {comparisonSummary.overlapDates.slice(0, 8).map((dt) => (
                          <button
                            key={dt}
                            type="button"
                            onClick={() => {
                              onJumpToDate?.(dt);
                              setIsComparePopoverOpen(false);
                            }}
                            className="h-6 px-2 rounded-md bg-white/[0.05] hover:bg-white/[0.11] text-[10px] font-mono tabular-nums text-neutral-200 hover:text-white transition-colors cursor-pointer"
                            title={`${dt} 일자로 달력 이동`}
                          >
                            {dt}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-neutral-500">
                        선택한 프로젝트 간 동일 일자에 겹치는 일정이 없습니다.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 일정 분류 필터: 순수 단일 아이콘 버튼 */}
          <div className="relative" ref={categoryMenuRef}>
            <button
              type="button"
              onClick={() => setIsCategoryOpen((prev) => !prev)}
              aria-label="일정 분류 필터"
              aria-expanded={isCategoryOpen}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150 cursor-pointer shrink-0 ${
                isCategoryOpen || isCategoryFiltered
                  ? 'bg-white/[0.09] text-white'
                  : 'text-neutral-500 hover:text-white hover:bg-white/[0.05]'
              }`}
              title={
                isCategoryFiltered ? `분류 필터: ${selectedCategory}` : '일정 분류 필터'
              }
            >
              <ListFilter className="w-3.5 h-3.5" strokeWidth={1.65} />
            </button>

            {isCategoryOpen && (
              <div className="luxury-glass-border absolute right-0 top-full mt-2 w-40 rounded-xl bg-gradient-to-b from-[#181c27]/88 via-[#11141d]/84 to-[#0c0e15]/92 backdrop-blur-xl backdrop-saturate-150 shadow-[0_24px_56px_-12px_rgba(0,0,0,0.78),0_8px_20px_-4px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)] p-1.5 z-50 space-y-0.5 overflow-hidden">
                {categoryOptions.map((cat) => {
                  const isSelected = selectedCategory === cat;
                  const label = cat === '전체' ? '전체 분류' : cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        onSelectCategory(cat);
                        setIsCategoryOpen(false);
                      }}
                      className={`w-full h-[32px] px-2.5 rounded-[7px] text-left flex items-center justify-between gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                        isSelected
                          ? 'bg-white/[0.09] text-white'
                          : 'text-neutral-300/85 hover:bg-white/[0.05] hover:text-white'
                      }`}
                    >
                      <span className="text-xs truncate">{label}</span>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-neutral-100 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
