import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Calendar,
  CornerDownLeft,
  Database,
  Download,
  FolderKanban,
  Globe2,
  ListChecks,
  Lock,
  MapPin,
  PanelLeft,
  Plus,
  Search,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { CalendarEventItem, CalendarViewMode, ProjectItem } from '../types';
import { ReminderLeadMinutes } from '../hooks/useEventReminders';
import { resolveEventLuxuryTheme } from '../utils/eventTheme';

interface CommandPaletteModalProps {
  isOpen: boolean;
  events: CalendarEventItem[];
  projects: ProjectItem[];
  selectedProjectId: string | 'all';
  viewMode: CalendarViewMode;
  isSidebarOpen: boolean;
  isVaultEncrypted: boolean;
  onClose: () => void;
  onSelectEvent: (event: CalendarEventItem) => void;
  onSelectProject: (projectId: string | 'all') => void;
  onOpenCreateEvent: (prefillTitle?: string) => void;
  onOpenCreateProject: () => void;
  onChangeViewMode: (mode: CalendarViewMode) => void;
  onToday: () => void;
  onToggleSidebar: () => void;
  onLockVault: () => void;
  onTriggerReverseMilestones?: () => void;
  onTriggerImportIcs?: () => void;
  onExportWorkspaceJson?: () => void;
  onAutoRebalance?: () => void;
  hasDualTimeZone?: boolean;
  onToggleDualTimeZone?: () => void;
  reminderLeadMinutes?: ReminderLeadMinutes;
  onChangeReminderLeadMinutes?: (lead: ReminderLeadMinutes) => void;
  canInstallPwa?: boolean;
  onInstallPwa?: () => void;
}

interface PaletteItem {
  id: string;
  section: 'action' | 'event' | 'project';
  title: string;
  subtitle?: string;
  shortcut?: string;
  dotClass?: string;
  icon?: React.ReactNode;
  onExecute: () => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  events,
  projects,
  selectedProjectId,
  viewMode,
  isSidebarOpen,
  isVaultEncrypted,
  onClose,
  onSelectEvent,
  onSelectProject,
  onOpenCreateEvent,
  onOpenCreateProject,
  onChangeViewMode,
  onToday,
  onToggleSidebar,
  onLockVault,
  onTriggerReverseMilestones,
  onTriggerImportIcs,
  onExportWorkspaceJson,
  onAutoRebalance,
  hasDualTimeZone = false,
  onToggleDualTimeZone,
  reminderLeadMinutes = 0,
  onChangeReminderLeadMinutes,
  canInstallPwa = false,
  onInstallPwa,
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 25);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const list: PaletteItem[] = [];

    if (q.length > 0) {
      list.push({
        id: 'act-quick-create-titled',
        section: 'action',
        title: `'${query.trim()}' 제목으로 새 일정 등록`,
        subtitle: '현재 선택된 날짜로 즉시 작성',
        icon: <Plus className="w-3.5 h-3.5 text-white shrink-0" />,
        onExecute: () => {
          onClose();
          onOpenCreateEvent(query.trim());
        },
      });
    }

    const baseActions: Array<PaletteItem & { keywords: string }> = [
      {
        id: 'act-new-event',
        section: 'action',
        title: '새 일정 등록',
        subtitle: '수동 일정 작성 모달 열기',
        shortcut: 'N',
        keywords: '새 일정 추가 등록 생성 new create event',
        icon: <Plus className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
        onExecute: () => {
          onClose();
          onOpenCreateEvent();
        },
      },
      {
        id: 'act-today',
        section: 'action',
        title: '오늘 날짜로 이동',
        subtitle: '현재 시각 기준 오늘 셀로 이동',
        shortcut: 'T',
        keywords: '오늘 today 이동 날짜',
        icon: <Calendar className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
        onExecute: () => {
          onClose();
          onToday();
        },
      },
      {
        id: 'act-view-month',
        section: 'action',
        title: '월간 그리드 뷰 전환',
        subtitle: viewMode === 'month' ? '현재 활성 뷰' : '한 달 전체 공정 확인',
        shortcut: 'M',
        keywords: '월간 달력 뷰 month view',
        icon: <Calendar className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
        onExecute: () => {
          onClose();
          onChangeViewMode('month');
        },
      },
      {
        id: 'act-view-week',
        section: 'action',
        title: '주간 타임테이블 뷰 전환',
        subtitle: viewMode === 'week' ? '현재 활성 뷰' : '7일 시간대 그리드 확인',
        shortcut: 'W',
        keywords: '주간 뷰 week 타임테이블',
        icon: <Calendar className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
        onExecute: () => {
          onClose();
          onChangeViewMode('week');
        },
      },
      {
        id: 'act-view-day',
        section: 'action',
        title: '일간 타임라인 · 인스펙터 뷰 전환',
        subtitle: viewMode === 'agenda' ? '현재 활성 뷰' : '15분 단위 정밀 일정 편집',
        shortcut: 'D',
        keywords: '일간 아젠다 뷰 day agenda inspector',
        icon: <Calendar className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
        onExecute: () => {
          onClose();
          onChangeViewMode('agenda');
        },
      },
      {
        id: 'act-view-ops',
        section: 'action',
        title: '공정 런시트 · 준비 보드 뷰 전환',
        subtitle: viewMode === 'ops' ? '현재 활성 뷰' : 'D-Day 역산 · 기한 경과 · 체크리스트 총괄',
        shortcut: 'O',
        keywords: '공정 런시트 보드 준비 ops runsheet kanban d-day',
        icon: <ListChecks className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
        onExecute: () => {
          onClose();
          onChangeViewMode('ops');
        },
      },
      ...(onAutoRebalance
        ? [
            {
              id: 'act-auto-rebalance',
              section: 'action' as const,
              title: '시간 충돌 · 지연 공정 자동 재배치',
              subtitle: '겹치거나 기한이 지난 미완료 공정을 업무 시간 빈 슬롯으로 1클릭 정렬',
              keywords: '자동 재배치 충돌 해결 지연 공정 리밸런싱 auto rebalance schedule conflict',
              icon: <Wand2 className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
              onExecute: () => {
                onClose();
                onAutoRebalance();
              },
            },
          ]
        : []),
      ...(onToggleDualTimeZone
        ? [
            {
              id: 'act-toggle-dual-tz',
              section: 'action' as const,
              title: hasDualTimeZone
                ? '글로벌 보조 시간대(듀얼 타임라인 축) 해제'
                : '글로벌 보조 시간대(듀얼 타임라인 축) 켜기',
              subtitle: hasDualTimeZone
                ? '주간·일간 단일 로컬 시간축으로 복귀'
                : '주간·일간 타임라인 좌측에 현지 + 글로벌 보조 시각 병렬 표시',
              keywords: '타임존 시간대 듀얼 글로벌 보조 timezone dual utc gmt',
              icon: <Globe2 className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
              onExecute: () => {
                onClose();
                onToggleDualTimeZone();
              },
            },
          ]
        : []),
      ...(onTriggerReverseMilestones
        ? [
            {
              id: 'act-ai-reverse-milestones',
              section: 'action' as const,
              title: 'D-Day 역산 공정 AI 자동 설계',
              subtitle: '개최일 기준으로 사전 준비 마일스톤과 체크리스트 일괄 생성',
              keywords: 'd-day 역산 공정 설계 마일스톤 체크리스트 ai reverse milestone',
              icon: <Sparkles className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
              onExecute: () => {
                onClose();
                onTriggerReverseMilestones();
              },
            },
          ]
        : []),
      {
        id: 'act-new-project',
        section: 'action',
        title: '새 행사 프로젝트 생성',
        subtitle: '프로젝트 코드 · 컬러 · 기간 등록',
        keywords: '새 프로젝트 생성 행사 추가 project',
        icon: <FolderKanban className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
        onExecute: () => {
          onClose();
          onOpenCreateProject();
        },
      },
      ...(onTriggerImportIcs
        ? [
            {
              id: 'act-import-ics',
              section: 'action' as const,
              title: '표준 캘린더(.ics) 파일 가져오기',
              subtitle: 'Google · Apple · Outlook 내보내기 일정 일괄 등록',
              keywords: 'ics ical 가져오기 import 캘린더 파일 업로드',
              icon: <Upload className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
              onExecute: () => {
                onClose();
                onTriggerImportIcs();
              },
            },
          ]
        : []),
      ...(onExportWorkspaceJson
        ? [
            {
              id: 'act-export-json',
              section: 'action' as const,
              title: '워크스페이스 백업(.json) 다운로드',
              subtitle: '프로젝트 및 전체 일정을 무손실 백업 파일로 저장',
              keywords: '백업 json 저장 내보내기 backup export',
              icon: <Database className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
              onExecute: () => {
                onClose();
                onExportWorkspaceJson();
              },
            },
          ]
        : []),
      ...(onChangeReminderLeadMinutes
        ? [
            {
              id: 'act-cycle-reminder',
              section: 'action' as const,
              title: '임박 일정 로컬 알림 전환',
              subtitle: `현재 ${
                reminderLeadMinutes === 0 ? '꺼짐' : `${reminderLeadMinutes}분 전 알림`
              } · 실행 시 10분 / 15분 / 30분 / 꺼짐 순환`,
              keywords: '알림 리마인더 푸시 notification reminder alert 10분 15분 30분',
              icon: <Bell className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
              onExecute: () => {
                const order: ReminderLeadMinutes[] = [0, 10, 15, 30];
                const idx = order.indexOf(reminderLeadMinutes);
                const next = order[(idx + 1) % order.length];
                onClose();
                onChangeReminderLeadMinutes(next);
              },
            },
          ]
        : []),
      ...(canInstallPwa && onInstallPwa
        ? [
            {
              id: 'act-install-pwa',
              section: 'action' as const,
              title: '현장 오프라인 앱(PWA) 설치',
              subtitle: '네트워크 단절 시에도 런시트와 암호화 볼트를 독립 앱으로 열람',
              keywords: 'pwa 앱 설치 오프라인 현장 install offline app',
              icon: <Download className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
              onExecute: () => {
                onClose();
                onInstallPwa();
              },
            },
          ]
        : []),
      {
        id: 'act-toggle-sidebar',
        section: 'action',
        title: isSidebarOpen ? '일정 컨시어지 패널 닫기' : '일정 컨시어지 패널 열기',
        subtitle: '좌측 AI 대화 패널 토글',
        keywords: '컨시어지 사이드바 패널 ai chat sidebar',
        icon: <PanelLeft className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
        onExecute: () => {
          onClose();
          onToggleSidebar();
        },
      },
      {
        id: 'act-lock-vault',
        section: 'action',
        title: isVaultEncrypted ? '보안 볼트 즉시 잠금' : '보안 게이트 화면으로 전환',
        subtitle: '화면 보호 및 암호화 세션 잠금',
        shortcut: '⌘L',
        keywords: '볼트 잠금 보안 lock vault',
        icon: <Lock className="w-3.5 h-3.5 text-neutral-300 shrink-0" />,
        onExecute: () => {
          onClose();
          onLockVault();
        },
      },
    ];

    for (const act of baseActions) {
      if (!q || act.title.toLowerCase().includes(q) || act.keywords.toLowerCase().includes(q)) {
        list.push(act);
      }
    }

    const matchedEvents = events
      .filter((ev) => {
        if (!q) return true;
        const proj = ev.projectId ? projectMap.get(ev.projectId) : undefined;
        const haystack = [
          ev.title,
          ev.date,
          ev.endDate || '',
          ev.category,
          ev.location || '',
          ev.locationAddress || '',
          ev.content || '',
          proj?.name || '',
          proj?.code || '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.startTime.localeCompare(b.startTime))
      .slice(0, q ? 16 : 6);

    for (const ev of matchedEvents) {
      const theme = resolveEventLuxuryTheme(ev, projects);
      const timeLabel = ev.isAllDay ? '종일' : `${ev.startTime}–${ev.endTime}`;
      const dateLabel = ev.endDate ? `${ev.date} ~ ${ev.endDate.slice(5)}` : ev.date;
      const metaParts = [dateLabel, timeLabel, ev.location || ev.category].filter(Boolean);

      list.push({
        id: `evt-${ev.id}`,
        section: 'event',
        title: ev.title,
        subtitle: metaParts.join(' · '),
        dotClass: theme.dotClass,
        onExecute: () => {
          onClose();
          onSelectEvent(ev);
        },
      });
    }

    const matchedProjects = projects
      .filter((p) => {
        if (!q) return true;
        const haystack = [p.name, p.code || '', p.clientOrOrg || '', p.description || '']
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, q ? 8 : 4);

    if (!q && selectedProjectId !== 'all') {
      list.push({
        id: 'proj-all',
        section: 'project',
        title: '전체 프로젝트 보기',
        subtitle: '프로젝트 필터 해제',
        dotClass: 'bg-neutral-400',
        onExecute: () => {
          onClose();
          onSelectProject('all');
        },
      });
    }

    for (const proj of matchedProjects) {
      const pTheme = resolveEventLuxuryTheme({ projectId: proj.id, category: '기타' }, projects);
      list.push({
        id: `proj-${proj.id}`,
        section: 'project',
        title: proj.name,
        subtitle: [proj.code, proj.clientOrOrg, selectedProjectId === proj.id ? '선택됨' : '']
          .filter(Boolean)
          .join(' · '),
        dotClass: pTheme.dotClass,
        onExecute: () => {
          onClose();
          onSelectProject(proj.id);
        },
      });
    }

    return list;
  }, [
    query,
    events,
    projects,
    projectMap,
    selectedProjectId,
    viewMode,
    isSidebarOpen,
    isVaultEncrypted,
    onClose,
    onOpenCreateEvent,
    onOpenCreateProject,
    onChangeViewMode,
    onToday,
    onToggleSidebar,
    onLockVault,
    onSelectEvent,
    onSelectProject,
    onTriggerReverseMilestones,
    onTriggerImportIcs,
    onExportWorkspaceJson,
    onAutoRebalance,
    hasDualTimeZone,
    onToggleDualTimeZone,
    reminderLeadMinutes,
    onChangeReminderLeadMinutes,
    canInstallPwa,
    onInstallPwa,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-palette-index="${activeIndex}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (items.length > 0 ? (prev + 1) % items.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (items.length > 0 ? (prev - 1 + items.length) % items.length : 0));
      return;
    }
    if (e.key === 'Enter' && items[activeIndex]) {
      e.preventDefault();
      items[activeIndex].onExecute();
    }
  };

  let lastSection: PaletteItem['section'] | null = null;
  const sectionLabels: Record<PaletteItem['section'], string> = {
    action: '빠른 실행',
    event: '일정 검색',
    project: '프로젝트 전환',
  };

  return (
    <div
      onClick={onClose}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[55] flex items-start justify-center pt-[12vh] px-4 bg-black/65 backdrop-blur-xs select-none"
      role="dialog"
      aria-modal="true"
      aria-label="통합 검색 및 명령 팔레트"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="luxury-glass-border w-full max-w-xl bg-[#12151e] border border-white/[0.11] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[72vh]"
      >
        {/* 검색 입력창 */}
        <div className="h-12 px-4 border-b border-white/[0.07] bg-[#13161f] flex items-center gap-3 shrink-0">
          <Search className="w-4 h-4 text-neutral-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="일정 제목 · 장소 · 메모 · 프로젝트 검색 또는 명령 실행..."
            className="flex-1 bg-transparent text-xs sm:text-sm text-white placeholder:text-neutral-500 outline-hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 rounded text-neutral-500 hover:text-neutral-200 cursor-pointer"
              title="검색어 지우기"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span className="text-[10.5px] font-mono text-neutral-500 shrink-0">ESC</span>
          )}
        </div>

        {/* 결과 목록 */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {items.length === 0 ? (
            <div className="py-10 text-center text-xs text-neutral-500">
              검색어와 일치하는 일정이나 명령이 없습니다.
            </div>
          ) : (
            items.map((item, idx) => {
              const showHeader = item.section !== lastSection;
              lastSection = item.section;
              const isSelected = idx === activeIndex;

              return (
                <React.Fragment key={item.id}>
                  {showHeader && (
                    <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-medium text-neutral-500 tracking-tight">
                      {sectionLabels[item.section]}
                    </div>
                  )}
                  <button
                    type="button"
                    data-palette-index={idx}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={item.onExecute}
                    className={`w-full px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                      isSelected ? 'bg-white/[0.08] text-white' : 'text-neutral-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {item.icon ? (
                        item.icon
                      ) : (
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            item.dotClass || 'bg-neutral-400'
                          }`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate text-neutral-100">
                          {item.title}
                        </div>
                        {item.subtitle && (
                          <div className="text-[11px] text-neutral-400 truncate font-mono tabular-nums mt-0.5 flex items-center gap-1">
                            {item.section === 'event' && (
                              <MapPin className="w-2.5 h-2.5 text-neutral-500 shrink-0 hidden sm:inline" />
                            )}
                            <span className="truncate">{item.subtitle}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.shortcut && (
                        <span className="text-[10.5px] font-mono text-neutral-400 px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.07]">
                          {item.shortcut}
                        </span>
                      )}
                      {isSelected && (
                        <CornerDownLeft className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      )}
                    </div>
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* 하단 단축키 안내 헤어라인 */}
        <div className="h-8 px-4 bg-[#0f121a] border-t border-white/[0.06] flex items-center justify-between text-[10.5px] text-neutral-500 font-mono shrink-0">
          <span>↑↓ 이동 · Enter 실행</span>
          <span className="hidden sm:inline">단축키: N 새 일정 · T 오늘 · M/W/D/O 뷰 전환</span>
        </div>
      </div>
    </div>
  );
};
