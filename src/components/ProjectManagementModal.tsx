import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  FolderKanban,
  Edit2,
  Trash2,
  ExternalLink,
  ChevronDown,
  Check,
  LayoutList,
  GanttChartSquare,
  RotateCcw,
  Layers,
  Share2,
} from 'lucide-react';
import { ProjectItem, CalendarEventItem, ProjectStatus } from '../types';
import { PROJECT_STATUS_MAP } from '../constants/projects';
import { parseLocalDate, formatDateString } from '../shared/dateUtils';
import { calculateCompletionStats } from '../shared/scheduleUtils';

interface ProjectManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectItem[];
  events: CalendarEventItem[];
  selectedProjectId: string | 'all';
  selectedProjectIds?: string[];
  onSelectProject: (id: string | 'all') => void;
  onToggleCompareProject?: (id: string) => void;
  onOpenCreateModal: () => void;
  onEditProject: (project: ProjectItem) => void;
  onRequestDeleteProject: (project: ProjectItem) => void;
  onUpdateProject?: (id: string, updates: Partial<ProjectItem>) => void;
  onShareProject?: (project: ProjectItem) => void;
}

export const ProjectManagementModal: React.FC<ProjectManagementModalProps> = ({
  isOpen,
  onClose,
  projects,
  events,
  selectedProjectId,
  selectedProjectIds = [],
  onSelectProject,
  onToggleCompareProject,
  onOpenCreateModal,
  onEditProject,
  onRequestDeleteProject,
  onUpdateProject,
  onShareProject,
}) => {
  const [viewType, setViewType] = useState<'list' | 'timeline'>('list');
  const [onlySelectedInTimeline, setOnlySelectedInTimeline] = useState(false);
  const [activeStatusMenuId, setActiveStatusMenuId] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selectedProjectIds), [selectedProjectIds]);
  const isComparing = selectedProjectIds.length >= 2;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveStatusMenuId(null);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 프로젝트들의 실제 시작/종료일 범위에 맞춘 동적 간트 타임라인 산출
  const timelineMeta = useMemo(() => {
    const now = new Date();
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
    let minTime = new Date(now.getFullYear(), qStartMonth, 1).getTime();
    let maxTime = new Date(now.getFullYear(), qStartMonth + 3, 0).getTime();

    const validStarts = projects
      .map((p) => (p.startDate ? parseLocalDate(p.startDate).getTime() : null))
      .filter((v): v is number => v !== null && !Number.isNaN(v));

    const validEnds = projects
      .map((p) => (p.endDate ? parseLocalDate(p.endDate).getTime() : null))
      .filter((v): v is number => v !== null && !Number.isNaN(v));

    if (validStarts.length > 0 || validEnds.length > 0) {
      const earliest = validStarts.length > 0 ? Math.min(...validStarts) : Math.min(...validEnds);
      const latest = validEnds.length > 0 ? Math.max(...validEnds) : Math.max(...validStarts);

      const startDt = new Date(earliest);
      startDt.setDate(1);
      minTime = startDt.getTime();

      const endDt = new Date(latest);
      endDt.setMonth(endDt.getMonth() + 1, 0);
      maxTime = Math.max(minTime + 30 * 24 * 60 * 60 * 1000, endDt.getTime());
    }

    const duration = Math.max(1, maxTime - minTime);
    const seg1 = new Date(minTime);
    const seg2 = new Date(minTime + duration / 3);
    const seg3 = new Date(minTime + (duration * 2) / 3);

    const formatMonthLabel = (dt: Date) => `${dt.getFullYear()}년 ${dt.getMonth() + 1}월`;

    return {
      minTime,
      maxTime,
      duration,
      defaultStartStr: formatDateString(new Date(minTime)),
      defaultEndStr: formatDateString(new Date(maxTime)),
      headers: [formatMonthLabel(seg1), formatMonthLabel(seg2), formatMonthLabel(seg3)],
    };
  }, [projects]);

  if (!isOpen) return null;

  const getTimelineBarStyles = (startDate?: string, endDate?: string) => {
    const s = startDate ? parseLocalDate(startDate).getTime() : timelineMeta.minTime;
    const e = endDate ? parseLocalDate(endDate).getTime() : timelineMeta.maxTime;

    const leftPercent = Math.max(
      0,
      Math.min(94, ((s - timelineMeta.minTime) / timelineMeta.duration) * 100)
    );
    const rightPercent = Math.max(
      0,
      Math.min(100, ((e - timelineMeta.minTime) / timelineMeta.duration) * 100)
    );
    const widthPercent = Math.max(6, rightPercent - leftPercent);

    return {
      left: `${leftPercent}%`,
      width: `${widthPercent}%`,
    };
  };

  return (
    <div
      onClick={() => {
        setActiveStatusMenuId(null);
        onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none"
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          setActiveStatusMenuId(null);
        }}
        className="w-full max-w-3xl h-[560px] max-h-[90vh] bg-[#0c0e14] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* 1. 상단 헤더 */}
        <div className="h-14 px-6 border-b border-white/[0.06] flex items-center justify-between bg-[#10121a] shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white tracking-tight">프로젝트 관리</h3>
            <span className="text-[11px] font-mono text-neutral-500 tabular-nums">
              {projects.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {viewType === 'timeline' && isComparing && (
              <button
                type="button"
                onClick={() => setOnlySelectedInTimeline((prev) => !prev)}
                className={`h-7 px-2.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer mr-1 whitespace-nowrap ${
                  onlySelectedInTimeline
                    ? 'bg-white/[0.12] text-white'
                    : 'text-neutral-400 hover:text-white hover:bg-white/[0.05]'
                }`}
                title="선택된 비교 대상 프로젝트만 타임라인에 표시"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>선택 프로젝트만 ({selectedProjectIds.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setViewType('list')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                viewType === 'list'
                  ? 'text-white bg-white/[0.08]'
                  : 'text-neutral-400 hover:text-white hover:bg-white/[0.04]'
              }`}
              title="목록 뷰"
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewType('timeline')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                viewType === 'timeline'
                  ? 'text-white bg-white/[0.08]'
                  : 'text-neutral-400 hover:text-white hover:bg-white/[0.04]'
              }`}
              title="간트 타임라인 뷰"
            >
              <GanttChartSquare className="w-4 h-4" />
            </button>

            <div className="w-[1px] h-3.5 bg-white/[0.08] mx-1" />

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCreateModal();
              }}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              title="새 프로젝트 등록"
            >
              <Plus className="w-4 h-4 text-indigo-400" />
            </button>
          </div>
        </div>

        {/* 2. 본문 영역 */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {projects.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500 space-y-2">
              <FolderKanban className="w-8 h-8 text-neutral-600 opacity-60" />
              <p className="text-xs font-medium text-neutral-300">등록된 프로젝트가 없습니다.</p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenCreateModal();
                }}
                className="mt-2 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs text-white transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5 text-indigo-400" />
                <span>새 프로젝트 등록</span>
              </button>
            </div>
          ) : viewType === 'list' ? (
            <div className="divide-y divide-white/[0.04]">
              {projects.map((proj) => {
                const projEvents = events.filter((e) => e.projectId === proj.id);
                const { rate } = calculateCompletionStats(projEvents);
                const statusInfo = PROJECT_STATUS_MAP[proj.status] || PROJECT_STATUS_MAP.active;
                const isSelectedInCompare = selectedSet.has(proj.id);
                const isCurrentFiltered =
                  selectedProjectId === proj.id || isSelectedInCompare;
                const isMenuOpen = activeStatusMenuId === proj.id;

                return (
                  <div
                    key={proj.id}
                    className={`group px-3 py-3.5 flex items-center justify-between gap-4 transition-colors rounded-xl ${
                      isCurrentFiltered ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {onToggleCompareProject && (
                        <button
                          type="button"
                          onClick={() => onToggleCompareProject(proj.id)}
                          className={`w-4 h-4 rounded flex items-center justify-center border transition-colors cursor-pointer shrink-0 ${
                            isSelectedInCompare
                              ? 'bg-white text-neutral-950 border-white'
                              : 'border-white/20 hover:border-white/45 bg-white/[0.02]'
                          }`}
                          title={
                            isSelectedInCompare
                              ? '비교 선택에서 제외'
                              : '체크하여 다중 프로젝트 비교에 추가'
                          }
                        >
                          {isSelectedInCompare && <Check className="w-3 h-3 stroke-[2.5]" />}
                        </button>
                      )}

                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: proj.color }}
                      />

                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        {proj.code && (
                          <span className="text-[10px] font-mono tracking-wider text-neutral-400 font-medium shrink-0">
                            {proj.code}
                          </span>
                        )}
                        {proj.code && <span className="text-neutral-700 text-xs shrink-0">/</span>}
                        <h4 className="text-sm font-semibold text-white tracking-tight truncate max-w-[200px] sm:max-w-[240px]">
                          {proj.name}
                        </h4>

                        <div className="relative inline-block">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveStatusMenuId(isMenuOpen ? null : proj.id);
                            }}
                            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer py-0.5 rounded px-1.5 hover:bg-white/[0.06]"
                            title="클릭하여 상태 변경"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotClass}`} />
                            <span className={statusInfo.textClass}>{statusInfo.label}</span>
                            <ChevronDown className="w-3 h-3 text-neutral-500" />
                          </button>

                          {isMenuOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute left-0 top-full mt-1 z-30 w-32 bg-[#14161f] border border-white/10 rounded-xl shadow-2xl p-1 text-xs"
                            >
                              {(Object.keys(PROJECT_STATUS_MAP) as ProjectStatus[]).map((st) => {
                                const sInfo = PROJECT_STATUS_MAP[st];
                                const isSelected = proj.status === st;
                                return (
                                  <button
                                    key={st}
                                    type="button"
                                    onClick={() => {
                                      onUpdateProject?.(proj.id, { status: st });
                                      setActiveStatusMenuId(null);
                                    }}
                                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                                      isSelected
                                        ? 'bg-white/[0.08] text-white font-medium'
                                        : 'text-neutral-300 hover:bg-white/[0.04] hover:text-white'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`w-1.5 h-1.5 rounded-full ${sInfo.dotClass}`}
                                      />
                                      <span className="text-[11px]">{sInfo.label}</span>
                                    </div>
                                    {isSelected && <Check className="w-3 h-3 text-indigo-400" />}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="hidden md:flex items-center gap-2 text-[11px] text-neutral-500 shrink-0 font-mono tabular-nums">
                      {proj.clientOrOrg && (
                        <span className="text-neutral-400 max-w-[120px] truncate font-sans">
                          {proj.clientOrOrg}
                        </span>
                      )}
                      {proj.clientOrOrg && (proj.startDate || proj.endDate) && (
                        <span className="text-neutral-700">·</span>
                      )}
                      {(proj.startDate || proj.endDate) && (
                        <span className="text-neutral-500 text-[10px]">
                          {proj.startDate?.slice(5) || '미정'} ~ {proj.endDate?.slice(5) || '미정'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-2 w-24 sm:w-32">
                        <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${rate}%`,
                              backgroundColor: proj.color,
                            }}
                          />
                        </div>
                        <span className="font-mono text-[10px] text-neutral-400 font-medium w-7 text-right tabular-nums">
                          {rate}%
                        </span>
                      </div>

                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectProject(isCurrentFiltered ? 'all' : proj.id);
                            onClose();
                          }}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            isCurrentFiltered
                              ? 'text-indigo-300 bg-white/[0.08]'
                              : 'text-neutral-400 hover:text-white hover:bg-white/[0.06]'
                          }`}
                          title={
                            isCurrentFiltered
                              ? '현재 필터링 중 (클릭 시 전체 보기)'
                              : '이 프로젝트 일정만 캘린더에 표시'
                          }
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>

                        {onShareProject && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onShareProject(proj);
                            }}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                            title="프로젝트 일정표 브리핑 패스 공유"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onEditProject(proj);
                          }}
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                          title="프로젝트 수정"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onRequestDeleteProject(proj)}
                          className="p-1.5 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="프로젝트 삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3">
              {/* 동적 산출 타임라인 축 헤더 */}
              <div className="grid grid-cols-3 text-center border-b border-white/[0.06] pb-2 text-[11px] font-mono text-neutral-400 tabular-nums">
                <div className="border-r border-white/[0.04]">{timelineMeta.headers[0]}</div>
                <div className="border-r border-white/[0.04]">{timelineMeta.headers[1]}</div>
                <div>{timelineMeta.headers[2]}</div>
              </div>

              <div className="divide-y divide-white/[0.04] pt-1">
                {(onlySelectedInTimeline && isComparing
                  ? projects.filter((p) => selectedSet.has(p.id))
                  : projects
                ).map((proj) => {
                  const barStyle = getTimelineBarStyles(proj.startDate, proj.endDate);
                  const projEvents = events.filter((e) => e.projectId === proj.id);
                  const { rate } = calculateCompletionStats(projEvents);
                  const isSelectedInCompare = selectedSet.has(proj.id);
                  const isCurrentFiltered =
                    selectedProjectId === proj.id || isSelectedInCompare;

                  return (
                    <div
                      key={proj.id}
                      className={`py-3 px-2 rounded-xl transition-all space-y-2 ${
                        isCurrentFiltered ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          {onToggleCompareProject && (
                            <button
                              type="button"
                              onClick={() => onToggleCompareProject(proj.id)}
                              className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-colors cursor-pointer shrink-0 ${
                                isSelectedInCompare
                                  ? 'bg-white text-neutral-950 border-white'
                                  : 'border-white/20 hover:border-white/45 bg-white/[0.02]'
                              }`}
                              title="다중 프로젝트 비교 선택/해제"
                            >
                              {isSelectedInCompare && <Check className="w-2.5 h-2.5 stroke-[2.5]" />}
                            </button>
                          )}
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: proj.color }}
                          />
                          <span className="font-semibold text-white tracking-tight truncate max-w-[200px]">
                            {proj.name}
                          </span>
                          {proj.code && (
                            <span className="text-[10px] font-mono text-neutral-500">
                              {proj.code}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-[11px] text-neutral-400 tabular-nums">
                            {rate}%
                          </span>

                          {onShareProject && (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onShareProject(proj);
                              }}
                              className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                              title="프로젝트 일정표 브리핑 패스 공유"
                            >
                              <Share2 className="w-3 h-3" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              onSelectProject(isCurrentFiltered ? 'all' : proj.id);
                              onClose();
                            }}
                            className={`p-1 rounded-md transition-colors cursor-pointer ${
                              isCurrentFiltered
                                ? 'text-indigo-300 bg-white/[0.08]'
                                : 'text-neutral-400 hover:text-white hover:bg-white/[0.06]'
                            }`}
                            title={isCurrentFiltered ? '필터 해제' : '캘린더 포커스'}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div className="h-4.5 w-full bg-white/[0.03] rounded-md relative overflow-hidden flex items-center px-1">
                        <div className="absolute inset-0 grid grid-cols-3 pointer-events-none">
                          <div className="border-r border-white/[0.04] h-full" />
                          <div className="border-r border-white/[0.04] h-full" />
                          <div className="h-full" />
                        </div>

                        <div
                          className="absolute h-3 rounded-xs transition-all duration-300"
                          style={{
                            ...barStyle,
                            backgroundColor: proj.color,
                          }}
                          title={`${proj.name} (${proj.startDate || timelineMeta.defaultStartStr} ~ ${
                            proj.endDate || timelineMeta.defaultEndStr
                          })`}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 tabular-nums">
                        <span>{proj.startDate || timelineMeta.defaultStartStr}</span>
                        <span>{proj.endDate || timelineMeta.defaultEndStr}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 3. 하단 바 */}
        <div className="h-11 px-6 border-t border-white/[0.06] flex items-center justify-between bg-[#10121a] text-xs shrink-0">
          <div className="text-[11px] text-neutral-400 flex items-center gap-2">
            <span className="text-neutral-500">포커스:</span>
            <span className="font-medium text-white font-mono tabular-nums">
              {selectedProjectIds.length >= 2
                ? `${selectedProjectIds.length}개 프로젝트 비교 중`
                : selectedProjectIds.length === 1
                ? projects.find((p) => p.id === selectedProjectIds[0])?.name || '선택됨'
                : '전체'}
            </span>
            {selectedProjectIds.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setOnlySelectedInTimeline(false);
                  onSelectProject('all');
                }}
                className="p-1 rounded text-neutral-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer ml-1"
                title="전체 보기로 복귀"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-medium transition-colors cursor-pointer"
          >
            {selectedProjectIds.length >= 2 ? '비교 화면 보기' : '닫기'}
          </button>
        </div>
      </div>
    </div>
  );
};
