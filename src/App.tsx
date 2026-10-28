import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { TitleBar } from './components/TitleBar';
import { TimeZoneControl } from './components/TimeZoneControl';
import { AiChatSidebar } from './components/AiChatSidebar';
import { MonthGridView } from './components/MonthGridView';
import { WeekGridView } from './components/WeekGridView';
import { DayAgendaView } from './components/DayAgendaView';
import { EventDetailModal } from './components/EventDetailModal';
import { DeleteConfirmationModal } from './components/DeleteConfirmationModal';
import { ProjectSelectorBar } from './components/ProjectSelectorBar';
import { ProjectModal } from './components/ProjectModal';
import { ProjectManagementModal } from './components/ProjectManagementModal';
import { SharePassModal, ShareModalTarget } from './components/SharePassModal';
import { SharedPassStandaloneView } from './components/SharedPassStandaloneView';
import { VaultIntroGate } from './components/vault/VaultIntroGate';
import { VaultControlMenu } from './components/vault/VaultControlMenu';
import {
  LegalAndColophonDrawer,
  LegalDrawerTab,
} from './components/vault/LegalAndColophonDrawer';
import { useToast } from './hooks/useToast';
import { useCalendarEvents, VaultEventsSyncConfig } from './hooks/useCalendarEvents';
import { useProjects, VaultProjectsSyncConfig } from './hooks/useProjects';
import {
  CalendarEventViewModelsProvider,
  useCalendarEventViewModels,
} from './hooks/useCalendarEventViewModels';
import { useTimeZonePreferences } from './hooks/useTimeZonePreferences';
import { CalendarEventItem, ProjectItem } from './types';
import { addDays } from './shared/dateUtils';
import { hasEventConflict } from './shared/scheduleUtils';
import {
  decodeSharePayload,
  extractShareTokenFromLocation,
  SharedPassPayload,
} from './utils/shareCodec';
import { getEmptyCalendarGuideText } from './utils/emptyStateGuide';
import {
  createSampleWorkspaceDataset,
  isSampleEventItem,
  isSampleProjectItem,
} from './data/sampleEvents';
import {
  AutoLockMinutesOption,
  computeBundleDigest,
  createEncryptedVault,
  disableEncryptedVault,
  disableVaultBiometrics,
  enableVaultBiometrics,
  factoryResetLocalWorkspace,
  isBiometricUnlockEnabled,
  isBrowseSessionActive,
  persistVaultDataWithActiveDek,
  PinLengthOption,
  readAutoLockMinutes,
  readLegalConsent,
  readPlaintextWorkspaceBundle,
  readStoredVaultEnvelope,
  saveAutoLockMinutes,
  saveLegalConsent,
  setBrowseSessionActive,
  unlockEncryptedVault,
  unlockEncryptedVaultWithBiometrics,
  VaultPlaintextBundle,
  zeroOutBytes,
} from './utils/vaultCrypto';
import { isPlatformBiometricHardwareAvailable } from './utils/webauthnBiometrics';

interface ActiveVaultCryptoSession {
  dekKey: CryptoKey;
  rawDekBytes: Uint8Array;
  pinLength: PinLengthOption;
}

type AppGateState =
  | { mode: 'onboarding' }
  | { mode: 'locked'; pinLength: PinLengthOption }
  | { mode: 'unlocked_browse'; sessionId: number }
  | { mode: 'unlocked_vault'; sessionId: number };

interface WorkspaceContentProps {
  isVaultEncrypted: boolean;
  isBiometricEnabled: boolean;
  isBiometricHardwareAvailable: boolean;
  getInitialVaultBundle?: () => VaultPlaintextBundle | null;
  onConsumeInitialVaultBundle?: () => void;
  initialToastNotice?: string | null;
  onConsumeToastNotice?: () => void;
  autoLockMinutes: AutoLockMinutesOption;
  onChangeAutoLockMinutes: (minutes: AutoLockMinutesOption) => void;
  onToggleBiometrics: (enable: boolean) => Promise<void>;
  onPersistEncryptedBundle: (bundle: VaultPlaintextBundle) => void;
  onLockNow: () => void;
  onReturnToIntroGate: () => void;
  onSetupOrChangePin: (
    newPin: string,
    pinLength: PinLengthOption,
    currentBundle: VaultPlaintextBundle,
    enableBiometricsAfterSetup?: boolean
  ) => Promise<void>;
  onDisableVaultEncryption: (currentBundle: VaultPlaintextBundle) => void;
}

const WorkspaceContent: React.FC<WorkspaceContentProps> = ({
  isVaultEncrypted,
  isBiometricEnabled,
  isBiometricHardwareAvailable,
  getInitialVaultBundle,
  onConsumeInitialVaultBundle,
  initialToastNotice,
  onConsumeToastNotice,
  autoLockMinutes,
  onChangeAutoLockMinutes,
  onToggleBiometrics,
  onPersistEncryptedBundle,
  onLockNow,
  onReturnToIntroGate,
  onSetupOrChangePin,
  onDisableVaultEncryption,
}) => {
  const { toastMessage, showToast, handleExecuteUndo, hasUndo } = useToast();
  const tzPrefs = useTimeZonePreferences();

  useEffect(() => {
    if (initialToastNotice) {
      showToast(initialToastNotice);
      onConsumeToastNotice?.();
    }
  }, [initialToastNotice, onConsumeToastNotice, showToast]);

  const [bootstrapReleased, setBootstrapReleased] = useState(false);
  const bootstrapBundle =
    !bootstrapReleased && isVaultEncrypted ? (getInitialVaultBundle?.() ?? null) : null;

  const latestBundleRef = useRef<VaultPlaintextBundle | null>(
    isVaultEncrypted
      ? {
          events: bootstrapBundle?.events ?? [],
          projects: bootstrapBundle?.projects ?? [],
          selectedProjectIds: bootstrapBundle?.selectedProjectIds ?? [],
        }
      : null
  );

  const handleEncryptedProjectsChange = useCallback(
    (nextProjects: ProjectItem[], nextSelectedIds: string[]) => {
      const nextBundle: VaultPlaintextBundle = {
        events: latestBundleRef.current?.events ?? [],
        projects: nextProjects,
        selectedProjectIds: nextSelectedIds,
      };
      latestBundleRef.current = nextBundle;
      onPersistEncryptedBundle(nextBundle);
    },
    [onPersistEncryptedBundle]
  );

  const handleEncryptedEventsChange = useCallback(
    (nextEvents: CalendarEventItem[]) => {
      const nextBundle: VaultPlaintextBundle = {
        events: nextEvents,
        projects: latestBundleRef.current?.projects ?? [],
        selectedProjectIds: latestBundleRef.current?.selectedProjectIds ?? [],
      };
      latestBundleRef.current = nextBundle;
      onPersistEncryptedBundle(nextBundle);
    },
    [onPersistEncryptedBundle]
  );

  const vaultProjectsConfig = useMemo<VaultProjectsSyncConfig | undefined>(() => {
    if (!isVaultEncrypted) return undefined;
    const initialBundle = bootstrapReleased ? null : (getInitialVaultBundle?.() ?? null);
    return {
      isEncrypted: true,
      initialProjects: initialBundle?.projects ?? [],
      initialSelectedProjectIds: initialBundle?.selectedProjectIds ?? [],
      onEncryptedProjectsChange: handleEncryptedProjectsChange,
    };
  }, [bootstrapReleased, getInitialVaultBundle, handleEncryptedProjectsChange, isVaultEncrypted]);

  const vaultEventsConfig = useMemo<VaultEventsSyncConfig | undefined>(() => {
    if (!isVaultEncrypted) return undefined;
    const initialBundle = bootstrapReleased ? null : (getInitialVaultBundle?.() ?? null);
    return {
      isEncrypted: true,
      initialEvents: initialBundle?.events ?? [],
      onEncryptedEventsChange: handleEncryptedEventsChange,
    };
  }, [bootstrapReleased, getInitialVaultBundle, handleEncryptedEventsChange, isVaultEncrypted]);

  const {
    projects,
    setProjects,
    selectedProjectId,
    setSelectedProjectId,
    selectedProjectIds,
    setSelectedProjectIds,
    isCompareMode,
    handleProjectClick,
    toggleProjectInComparison,
    toggleCompareMode,
    createProject,
    updateProject,
    deleteProject,
  } = useProjects(showToast, vaultProjectsConfig);

  const {
    events,
    setEvents,
    filteredEvents,
    selectedDateEvents,
    currentYear,
    currentMonth,
    selectedDate,
    selectedCategory,
    selectedEvent,
    setCurrentYear,
    setCurrentMonth,
    setSelectedDate,
    setSelectedCategory,
    setSelectedEvent,
    handlePrevMonth,
    handleNextMonth,
    handleToday,
    jumpToDate,
    handleMoveEventDate,
    handleUpdateTimeSlot,
    handleUpdateEventTimeZone,
    handleUpdateEventProject,
    handleUpdateEventLocation,
    clearProjectAssociation,
    handleDeleteEvent,
    handleToggleComplete,
    handleToggleChecklistItem,
    handleApplyAgentResponse,
    handleCreateEventFromVenue,
    handleCreateEventFromGroundedSuggestion,
  } = useCalendarEvents({
    showToast,
    selectedProjectId,
    selectedProjectIds,
    viewerTimeZone: tzPrefs.viewerTimeZone,
    vaultEventsConfig,
  });

  const workspaceViewModels = useCalendarEventViewModels({
    events,
    projects,
    viewerTimeZone: tzPrefs.viewerTimeZone,
  });
  const workspaceViewModelsRef = useRef(workspaceViewModels);
  workspaceViewModelsRef.current = workspaceViewModels;

  const isWorkspaceEmpty = events.length === 0 && projects.length === 0;
  const hasSampleData = useMemo(
    () => projects.some(isSampleProjectItem) || events.some(isSampleEventItem),
    [projects, events]
  );

  const sampleSnapshotRef = useRef<{
    projects: ProjectItem[];
    events: CalendarEventItem[];
    selectedProjectIds: string[];
    selectedDate: string;
  } | null>(null);
  sampleSnapshotRef.current = { projects, events, selectedProjectIds, selectedDate };

  const handleLoadSampleData = useCallback(() => {
    const snap = sampleSnapshotRef.current;
    if (!snap) return;
    const prevProjects = snap.projects;
    const prevEvents = snap.events;
    const prevSelectedIds = snap.selectedProjectIds;
    const dataset = createSampleWorkspaceDataset(snap.selectedDate);

    setProjects((curr) => {
      const userOnly = curr.filter((p) => !isSampleProjectItem(p));
      return [...dataset.projects, ...userOnly];
    });
    setEvents((curr) => {
      const userOnly = curr.filter((e) => !isSampleEventItem(e));
      return [...dataset.events, ...userOnly];
    });
    setSelectedProjectId('all');
    setSelectedCategory('전체');
    jumpToDate(dataset.focusDate);

    showToast('가상 장소 기반 학습용 샘플 데이터를 불러왔습니다.', () => {
      setProjects(prevProjects);
      setEvents(prevEvents);
      setSelectedProjectIds(prevSelectedIds);
    });
  }, [
    setProjects,
    setEvents,
    setSelectedProjectId,
    setSelectedCategory,
    jumpToDate,
    showToast,
    setSelectedProjectIds,
  ]);

  const handleClearSampleData = useCallback(() => {
    const prevProjects = projects;
    const prevEvents = events;
    const prevSelectedIds = selectedProjectIds;

    setProjects((curr) => curr.filter((p) => !isSampleProjectItem(p)));
    setEvents((curr) => curr.filter((e) => !isSampleEventItem(e)));
    setSelectedEvent((curr) => (curr && isSampleEventItem(curr) ? null : curr));

    showToast('학습용 샘플 데이터를 모두 비웠습니다.', () => {
      setProjects(prevProjects);
      setEvents(prevEvents);
      setSelectedProjectIds(prevSelectedIds);
    });
  }, [
    projects,
    events,
    selectedProjectIds,
    setProjects,
    setEvents,
    setSelectedEvent,
    showToast,
    setSelectedProjectIds,
  ]);

  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [isProjectManagementOpen, setIsProjectManagementOpen] = useState(false);

  const [shareTarget, setShareTarget] = useState<ShareModalTarget | null>(null);
  const [previewSharedPayload, setPreviewSharedPayload] = useState<SharedPassPayload | null>(null);

  const [viewMode, setViewMode] = useState<'month' | 'week' | 'agenda'>('month');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [legalDrawer, setLegalDrawer] = useState<{
    isOpen: boolean;
    tab: LegalDrawerTab;
  }>({
    isOpen: false,
    tab: 'disclaimer',
  });

  // 글로벌 단축키 (Cmd/Ctrl + L) 지원
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (isVaultEncrypted) {
          onLockNow();
        } else {
          onReturnToIntroGate();
        }
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [isVaultEncrypted, onLockNow, onReturnToIntroGate]);

  // 초기 마운트 완료 후 부트스트랩 평문 번들 참조 즉시 해제 및 언마운트(잠금/종료) 시 latestBundleRef 명시적 해제
  useEffect(() => {
    if (isVaultEncrypted && !latestBundleRef.current) {
      latestBundleRef.current = {
        events,
        projects,
        selectedProjectIds,
      };
    }

    const releaseTimerId = window.setTimeout(() => {
      setBootstrapReleased(true);
      onConsumeInitialVaultBundle?.();
    }, 0);

    return () => {
      window.clearTimeout(releaseTimerId);
      latestBundleRef.current = null;
      sampleSnapshotRef.current = null;
    };
  }, [isVaultEncrypted, onConsumeInitialVaultBundle]);

  // 자리 비움 자동 잠금 타이머 (AES-256-GCM 활성 시 + 백그라운드 복귀 경과 시간 검증)
  useEffect(() => {
    if (!isVaultEncrypted || autoLockMinutes <= 0) return;

    const timeoutMs = autoLockMinutes * 60 * 1000;
    let lastActivityAt = Date.now();
    let lastReset = lastActivityAt;
    let timerId: ReturnType<typeof setTimeout> = setTimeout(onLockNow, timeoutMs);

    const resetTimer = () => {
      const now = Date.now();
      lastActivityAt = now;
      if (now - lastReset < 2000) return;
      lastReset = now;
      clearTimeout(timerId);
      timerId = setTimeout(onLockNow, timeoutMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastActivityAt >= timeoutMs) {
        clearTimeout(timerId);
        onLockNow();
      }
    };

    window.addEventListener('pointerdown', resetTimer, { passive: true });
    window.addEventListener('keydown', resetTimer, { passive: true });
    window.addEventListener('mousemove', resetTimer, { passive: true });
    window.addEventListener('touchstart', resetTimer, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(timerId);
      window.removeEventListener('pointerdown', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoLockMinutes, isVaultEncrypted, onLockNow]);

  const selectedEventHasConflict = useMemo(() => {
    if (!selectedEvent) return false;
    const selectedVm =
      workspaceViewModels.byEventId.get(selectedEvent.id) ??
      workspaceViewModels.getViewModel(selectedEvent);
    return hasEventConflict(selectedVm.projectedEvent, workspaceViewModels.projectedEvents);
  }, [selectedEvent, workspaceViewModels]);

  const handleSelectCalendarEvent = useCallback(
    (ev: CalendarEventItem) => {
      setSelectedEvent(ev);
      const vm =
        workspaceViewModelsRef.current.byEventId.get(ev.id) ??
        workspaceViewModelsRef.current.getViewModel(ev);
      setSelectedDate(vm.timing.localDate);
    },
    [setSelectedEvent, setSelectedDate]
  );

  const handleShareEvent = useCallback((ev: CalendarEventItem) => {
    setShareTarget({ kind: 'event', event: ev });
  }, []);

  const emptyGuideText = useMemo(
    () =>
      getEmptyCalendarGuideText({
        scope: viewMode === 'agenda' ? 'day' : viewMode,
        selectedProjectId,
        comparedProjectCount: selectedProjectIds.length,
        selectedCategory,
        totalFilteredCount: filteredEvents.length,
      }),
    [
      viewMode,
      selectedProjectId,
      selectedProjectIds.length,
      selectedCategory,
      filteredEvents.length,
    ]
  );

  const syncYearMonthFromDate = useCallback(
    (dateStr: string) => {
      const [y, m] = dateStr.split('-').map(Number);
      if (!Number.isNaN(y) && !Number.isNaN(m)) {
        setCurrentYear(y);
        setCurrentMonth(m - 1);
      }
    },
    [setCurrentYear, setCurrentMonth]
  );

  const handlePrev = useCallback(() => {
    if (viewMode === 'month') {
      handlePrevMonth();
      return;
    }
    const offset = viewMode === 'week' ? -7 : -1;
    const newDate = addDays(selectedDate, offset);
    setSelectedDate(newDate);
    syncYearMonthFromDate(newDate);
  }, [viewMode, handlePrevMonth, selectedDate, setSelectedDate, syncYearMonthFromDate]);

  const handleNext = useCallback(() => {
    if (viewMode === 'month') {
      handleNextMonth();
      return;
    }
    const offset = viewMode === 'week' ? 7 : 1;
    const newDate = addDays(selectedDate, offset);
    setSelectedDate(newDate);
    syncYearMonthFromDate(newDate);
  }, [viewMode, handleNextMonth, selectedDate, setSelectedDate, syncYearMonthFromDate]);

  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    title: string;
    itemName: string;
    itemType: '일정' | '프로젝트';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    itemName: '',
    itemType: '일정',
    onConfirm: () => {},
  });

  const requestDeleteEvent = useCallback(
    (eventId: string) => {
      const target = events.find((e) => e.id === eventId);
      if (!target) return;

      setDeleteModalState({
        isOpen: true,
        title: '일정 삭제 확인',
        itemName: target.title,
        itemType: '일정',
        onConfirm: () => {
          handleDeleteEvent(eventId);
        },
      });
    },
    [events, handleDeleteEvent]
  );

  const requestDeleteProject = useCallback(
    (project: ProjectItem) => {
      setDeleteModalState({
        isOpen: true,
        title: '프로젝트 삭제 확인',
        itemName: project.name,
        itemType: '프로젝트',
        onConfirm: () => {
          deleteProject(project.id);
          clearProjectAssociation(project.id);
        },
      });
    },
    [deleteProject, clearProjectAssociation]
  );

  const handleQuickAiPromptForDate = useCallback(
    (dateStr: string) => {
      const m = parseInt(dateStr.slice(5, 7), 10);
      const d = parseInt(dateStr.slice(8, 10), 10);
      setIsSidebarOpen(true);
      showToast(
        `좌측 컨시어지 대화창에 "${m}월 ${d}일 오전 10시 일정"처럼 음성이나 텍스트로 지시해 보세요.`
      );
    },
    [showToast]
  );

  return (
    <CalendarEventViewModelsProvider value={workspaceViewModels}>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0a0c10] text-neutral-200 font-sans antialiased">
      {/* 1. 최상단 네비게이션 헤더 */}
      <TitleBar
        currentYear={currentYear}
        currentMonth={currentMonth}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        selectedDate={selectedDate}
        events={filteredEvents}
        projects={projects}
        selectedProjectIds={selectedProjectIds}
        selectedCategory={selectedCategory}
        timeZoneSlot={
          <TimeZoneControl
            viewerMeta={tzPrefs.viewerMeta}
            viewerClock={tzPrefs.viewerClock}
          />
        }
        vaultSlot={
          <VaultControlMenu
            isVaultEncrypted={isVaultEncrypted}
            isBiometricEnabled={isBiometricEnabled}
            isBiometricHardwareAvailable={isBiometricHardwareAvailable}
            autoLockMinutes={autoLockMinutes}
            onChangeAutoLockMinutes={(mins) => {
              onChangeAutoLockMinutes(mins);
              showToast(
                mins === 0
                  ? '자동 잠금이 해제되었습니다.'
                  : `${mins}분 자리 비움 시 자동 잠금됩니다.`
              );
            }}
            onToggleBiometrics={async (enable) => {
              await onToggleBiometrics(enable);
              showToast(
                enable
                  ? '생체 인증(Face ID · Touch ID · 지문) 빠른 잠금 해제가 활성화되었습니다.'
                  : '생체 인증 잠금 해제가 해제되었습니다.'
              );
            }}
            onLockNow={onLockNow}
            onReturnToIntroGate={onReturnToIntroGate}
            onSetupOrChangePin={async (newPin, pinLen, enableBioAfter) => {
              await onSetupOrChangePin(
                newPin,
                pinLen,
                {
                  events,
                  projects,
                  selectedProjectIds,
                },
                enableBioAfter
              );
              if (isVaultEncrypted) {
                showToast('볼트 PIN 번호가 안전하게 변경되었습니다.');
              }
            }}
            onDisableVaultEncryption={() => {
              onDisableVaultEncryption({
                events,
                projects,
                selectedProjectIds,
              });
            }}
            onOpenLegalDrawer={(tab) => setLegalDrawer({ isOpen: true, tab })}
            hasSampleData={hasSampleData}
            onLoadSampleData={handleLoadSampleData}
            onClearSampleData={handleClearSampleData}
          />
        }
        showToast={showToast}
      />

      {/* 1-2. 프로젝트 및 분류 통합 헤어라인 바 (다중 비교 지원) */}
      <ProjectSelectorBar
        projects={projects}
        events={events}
        selectedProjectId={selectedProjectId}
        selectedProjectIds={selectedProjectIds}
        isCompareMode={isCompareMode}
        onSelectProject={setSelectedProjectId}
        onProjectClick={handleProjectClick}
        onToggleProjectInComparison={toggleProjectInComparison}
        onToggleCompareMode={toggleCompareMode}
        onJumpToDate={jumpToDate}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        onOpenCreateProject={() => {
          setEditingProject(null);
          setIsProjectModalOpen(true);
        }}
        onOpenManageProject={() => setIsProjectManagementOpen(true)}
        onShareProject={(proj) => setShareTarget({ kind: 'project', project: proj })}
      />

      {/* 2. 메인 워크스페이스 */}
      <div className="flex-1 flex overflow-hidden relative">
        <div
          className={`transition-[width,opacity] duration-300 ease-out overflow-hidden shrink-0 flex ${
            isSidebarOpen
              ? 'w-full sm:w-[400px] lg:w-[440px] opacity-100'
              : 'w-0 opacity-0 pointer-events-none'
          }`}
          aria-hidden={!isSidebarOpen}
        >
          <div className="w-[100vw] sm:w-[400px] lg:w-[440px] h-full shrink-0">
            <AiChatSidebar
              currentYear={currentYear}
              selectedDate={selectedDate}
              viewerTimeZone={tzPrefs.viewerTimeZone}
              existingEvents={selectedProjectIds.length >= 2 ? filteredEvents : events}
              selectedEvent={selectedEvent}
              onApplyResponse={(res) => {
                if (res.actionType === 'QUERY_EVENTS') {
                  setViewMode('agenda');
                }
                handleApplyAgentResponse(res);
              }}
              onCreateEventFromVenue={handleCreateEventFromVenue}
              onAddGroundedSuggestion={handleCreateEventFromGroundedSuggestion}
              onJumpToDate={jumpToDate}
              onUpdateTimeSlot={handleUpdateTimeSlot}
              showToast={showToast}
              projects={projects}
              selectedProjectId={selectedProjectId}
              selectedProjectIds={selectedProjectIds}
            />
          </div>
        </div>

        <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden bg-[#0e1017]">
          {viewMode === 'month' && (
            <div className="flex-1 h-full overflow-hidden flex flex-col">
              <MonthGridView
                currentYear={currentYear}
                currentMonth={currentMonth}
                selectedDate={selectedDate}
                selectedEvent={selectedEvent}
                events={filteredEvents}
                viewerTimeZone={tzPrefs.viewerTimeZone}
                projects={projects}
                comparedProjectIds={selectedProjectIds}
                emptyGuideText={emptyGuideText}
                isWorkspaceEmpty={isWorkspaceEmpty}
                onLoadSampleData={handleLoadSampleData}
                onSelectDate={setSelectedDate}
                onSelectEvent={handleSelectCalendarEvent}
                onMoveEventDate={handleMoveEventDate}
              />
            </div>
          )}

          {viewMode === 'week' && (
            <div className="flex-1 h-full overflow-hidden flex flex-col">
              <WeekGridView
                selectedDate={selectedDate}
                events={filteredEvents}
                selectedEvent={selectedEvent}
                viewerTimeZone={tzPrefs.viewerTimeZone}
                viewerShortCode={tzPrefs.viewerMeta.shortCode}
                projects={projects}
                comparedProjectIds={selectedProjectIds}
                emptyGuideText={emptyGuideText}
                isWorkspaceEmpty={isWorkspaceEmpty}
                onLoadSampleData={handleLoadSampleData}
                onSelectDate={setSelectedDate}
                onSelectEvent={handleSelectCalendarEvent}
                onMoveEventDate={handleMoveEventDate}
              />
            </div>
          )}

          {viewMode === 'agenda' && (
            <div className="flex-1 h-full overflow-hidden flex flex-col">
              <DayAgendaView
                selectedDate={selectedDate}
                events={selectedDateEvents}
                selectedEvent={selectedEvent}
                viewerTimeZone={tzPrefs.viewerTimeZone}
                projects={projects}
                comparedProjectIds={selectedProjectIds}
                onUpdateProject={handleUpdateEventProject}
                onUpdateTimeZone={handleUpdateEventTimeZone}
                onUpdateLocation={handleUpdateEventLocation}
                onSelectEvent={setSelectedEvent}
                onDeleteEvent={requestDeleteEvent}
                onToggleComplete={handleToggleComplete}
                onToggleChecklistItem={handleToggleChecklistItem}
                onMoveEventDate={handleMoveEventDate}
                onQuickAiPromptForDate={handleQuickAiPromptForDate}
                onShareEvent={handleShareEvent}
                emptyGuideText={emptyGuideText}
                isWorkspaceEmpty={isWorkspaceEmpty}
                onLoadSampleData={handleLoadSampleData}
              />
            </div>
          )}
        </main>
      </div>

      {/* 3. 삭제 확인 모달 (일정 & 프로젝트 공용) */}
      <DeleteConfirmationModal
        isOpen={deleteModalState.isOpen}
        title={deleteModalState.title}
        itemName={deleteModalState.itemName}
        itemType={deleteModalState.itemType}
        onConfirm={deleteModalState.onConfirm}
        onClose={() => setDeleteModalState((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* 4. 일정 상세 모달 */}
      {viewMode !== 'agenda' && (
        <EventDetailModal
          event={selectedEvent}
          viewerTimeZone={tzPrefs.viewerTimeZone}
          projects={projects}
          onUpdateProject={handleUpdateEventProject}
          onUpdateTimeZone={handleUpdateEventTimeZone}
          onUpdateLocation={handleUpdateEventLocation}
          hasConflict={selectedEventHasConflict}
          onClose={() => setSelectedEvent(null)}
          onDelete={(id) => {
            setSelectedEvent(null);
            requestDeleteEvent(id);
          }}
          onToggleComplete={handleToggleComplete}
          onToggleChecklistItem={handleToggleChecklistItem}
          onShare={(ev) => {
            setSelectedEvent(null);
            setShareTarget({ kind: 'event', event: ev });
          }}
        />
      )}

      {/* 5. 프로젝트 등록/수정 모달 */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => {
          setIsProjectModalOpen(false);
          setEditingProject(null);
        }}
        initialProject={editingProject}
        onSubmit={(data) => {
          if (editingProject) {
            updateProject(editingProject.id, data);
          } else {
            const created = createProject(data);
            setSelectedProjectId(created.id);
          }
        }}
      />

      {/* 6. 프로젝트 관리 모달 */}
      <ProjectManagementModal
        isOpen={isProjectManagementOpen}
        onClose={() => setIsProjectManagementOpen(false)}
        projects={projects}
        events={events}
        selectedProjectId={selectedProjectId}
        selectedProjectIds={selectedProjectIds}
        onSelectProject={setSelectedProjectId}
        onToggleCompareProject={toggleProjectInComparison}
        onOpenCreateModal={() => {
          setEditingProject(null);
          setIsProjectModalOpen(true);
        }}
        onEditProject={(proj) => {
          setEditingProject(proj);
          setIsProjectModalOpen(true);
        }}
        onRequestDeleteProject={requestDeleteProject}
        onUpdateProject={updateProject}
        onShareProject={(proj) => setShareTarget({ kind: 'project', project: proj })}
      />

      {/* 6-2. 일정·프로젝트 브리핑 패스 공유 모달 */}
      <SharePassModal
        target={shareTarget}
        events={events}
        projects={projects}
        viewerTimeZone={tzPrefs.viewerTimeZone}
        onClose={() => setShareTarget(null)}
        onPreviewStandalone={(payload) => setPreviewSharedPayload(payload)}
        showToast={showToast}
      />

      {/* 6-3. 발신자용 수신자 전용 화면 미리보기 오버레이 */}
      {previewSharedPayload && (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <SharedPassStandaloneView
            payload={previewSharedPayload}
            isPreviewMode={true}
            onExit={() => setPreviewSharedPayload(null)}
          />
        </div>
      )}

      {/* 6-4. 법적 고지 · 개인정보처리방침 · 제작 노트 슬라이드오버 */}
      <LegalAndColophonDrawer
        isOpen={legalDrawer.isOpen}
        initialTab={legalDrawer.tab}
        onClose={() => setLegalDrawer((prev) => ({ ...prev, isOpen: false }))}
        onCopySuccess={showToast}
      />

      {/* 7. 하단 알림 토스트 & 실행 취소 배너 */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-[#1e222b] text-neutral-100 text-xs px-4 py-2.5 rounded-xl border border-white/10 shadow-2xl backdrop-blur-md">
          <span>{toastMessage}</span>
          {hasUndo && (
            <button
              type="button"
              onClick={handleExecuteUndo}
              className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-semibold pl-2 border-l border-white/10 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>실행 취소</span>
            </button>
          )}
        </div>
      )}
      </div>
    </CalendarEventViewModelsProvider>
  );
};

export default function App() {
  const [urlSharedPayload, setUrlSharedPayload] = useState<SharedPassPayload | null>(null);
  const [isDecodingShareUrl, setIsDecodingShareUrl] = useState<boolean>(() =>
    Boolean(extractShareTokenFromLocation())
  );

  const activeVaultSessionRef = useRef<ActiveVaultCryptoSession | null>(null);
  const unlockedBootstrapBundleRef = useRef<VaultPlaintextBundle | null>(null);
  const pendingPersistBundleRef = useRef<VaultPlaintextBundle | null>(null);
  const lastEncryptedSignatureRef = useRef<string>('');
  const encryptionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeSessionGenerationRef = useRef<number>(0);

  const [autoLockMinutes, setAutoLockMinutes] = useState<AutoLockMinutesOption>(() =>
    readAutoLockMinutes()
  );
  const [isBiometricEnabled, setIsBiometricEnabled] = useState<boolean>(() =>
    isBiometricUnlockEnabled()
  );
  const [isBiometricHardwareAvailable, setIsBiometricHardwareAvailable] =
    useState<boolean>(false);
  const [transitionNotice, setTransitionNotice] = useState<string | null>(null);

  const [gateState, setGateState] = useState<AppGateState>(() => {
    const existingEnvelope = readStoredVaultEnvelope();
    if (existingEnvelope) {
      return { mode: 'locked', pinLength: existingEnvelope.pinLength };
    }
    if (isBrowseSessionActive() && Boolean(readLegalConsent())) {
      return { mode: 'unlocked_browse', sessionId: 1 };
    }
    return { mode: 'onboarding' };
  });

  const gateStateRef = useRef<AppGateState>(gateState);
  gateStateRef.current = gateState;

  useEffect(() => {
    let mounted = true;
    void isPlatformBiometricHardwareAvailable().then((available) => {
      if (mounted) {
        setIsBiometricHardwareAvailable(available);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  /**
   * 볼트 잠금, 자동 잠금 타임아웃, 앱 언마운트, 세션 초기화 시
   * 원시 DEK 바이트(Uint8Array)를 즉시 0으로 덮어쓰고 모든 세션·평문 번들 참조를 명시적으로 해제
   */
  const clearActiveSessionMemory = useCallback(() => {
    activeSessionGenerationRef.current += 1;
    const existingSession = activeVaultSessionRef.current;
    if (existingSession) {
      zeroOutBytes(existingSession.rawDekBytes);
      (existingSession as Partial<ActiveVaultCryptoSession>).dekKey = undefined;
      (existingSession as Partial<ActiveVaultCryptoSession>).rawDekBytes = undefined;
    }
    activeVaultSessionRef.current = null;
    unlockedBootstrapBundleRef.current = null;
    pendingPersistBundleRef.current = null;
    lastEncryptedSignatureRef.current = '';
    encryptionQueueRef.current = Promise.resolve();
  }, []);

  const installActiveVaultSession = useCallback(
    (nextSession: ActiveVaultCryptoSession, bootstrapBundle: VaultPlaintextBundle) => {
      clearActiveSessionMemory();
      activeSessionGenerationRef.current += 1;
      activeVaultSessionRef.current = nextSession;
      unlockedBootstrapBundleRef.current = bootstrapBundle;
      lastEncryptedSignatureRef.current = computeBundleDigest(bootstrapBundle);
    },
    [clearActiveSessionMemory]
  );

  const getInitialVaultBundle = useCallback(() => unlockedBootstrapBundleRef.current, []);

  const handleConsumeInitialVaultBundle = useCallback(() => {
    unlockedBootstrapBundleRef.current = null;
  }, []);

  // 앱 언마운트 및 문서 완전 종료(pagehide non-persisted) 시 즉시 DEK 제로화 및 메모리 참조 해제
  useEffect(() => {
    const handlePageHide = (e: PageTransitionEvent) => {
      if (!e.persisted) {
        clearActiveSessionMemory();
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      clearActiveSessionMemory();
    };
  }, [clearActiveSessionMemory]);

  // 외부 브리핑 패스 공유 링크(?pass= / #pass=) 우선 감지 (수신자 무잠금 열람 보장)
  useEffect(() => {
    let active = true;
    const syncFromLocation = async () => {
      const token = extractShareTokenFromLocation();
      if (!token) {
        if (active) {
          setUrlSharedPayload(null);
          setIsDecodingShareUrl(false);
        }
        return;
      }
      setIsDecodingShareUrl(true);
      const decoded = await decodeSharePayload(token);
      if (!active) return;
      setUrlSharedPayload(decoded);
      setIsDecodingShareUrl(false);
    };

    void syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => {
      active = false;
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, []);

  const handleExitUrlShareMode = useCallback(() => {
    if (typeof window !== 'undefined') {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('pass');
      if (cleanUrl.hash.startsWith('#pass=')) {
        cleanUrl.hash = '';
      }
      window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    }
    setUrlSharedPayload(null);
  }, []);

  const handlePersistEncryptedBundle = useCallback((bundle: VaultPlaintextBundle) => {
    if (!activeVaultSessionRef.current) return;

    const digest = computeBundleDigest(bundle);
    if (digest === lastEncryptedSignatureRef.current) return;
    lastEncryptedSignatureRef.current = digest;

    const scheduledGeneration = activeSessionGenerationRef.current;
    pendingPersistBundleRef.current = bundle;
    let queuedBundle: VaultPlaintextBundle | null = bundle;

    encryptionQueueRef.current = encryptionQueueRef.current
      .then(async () => {
        if (activeSessionGenerationRef.current !== scheduledGeneration) return;
        const currentSession = activeVaultSessionRef.current;
        if (!currentSession || !queuedBundle) return;
        await persistVaultDataWithActiveDek(currentSession.dekKey, queuedBundle);
      })
      .catch((err) => {
        console.warn('AES-GCM 볼트 저장 실패:', err);
      })
      .finally(() => {
        if (pendingPersistBundleRef.current === queuedBundle) {
          pendingPersistBundleRef.current = null;
        }
        queuedBundle = null;
      });
  }, []);

  const handleCreateVaultFromGate = useCallback(
    async (pin: string, pinLength: PinLengthOption) => {
      saveLegalConsent();
      const initialBundle = readPlaintextWorkspaceBundle();
      const { dekKey, rawDekBytes, envelope } = await createEncryptedVault(
        pin,
        pinLength,
        initialBundle
      );

      let ownershipTransferred = false;
      try {
        installActiveVaultSession(
          {
            dekKey,
            rawDekBytes,
            pinLength: envelope.pinLength,
          },
          initialBundle
        );
        ownershipTransferred = true;
        setIsBiometricEnabled(false);

        setGateState({
          mode: 'unlocked_vault',
          sessionId: Date.now(),
        });
      } finally {
        if (!ownershipTransferred) {
          zeroOutBytes(rawDekBytes);
        }
      }
    },
    [installActiveVaultSession]
  );

  const handleUnlockVaultFromGate = useCallback(
    async (pin: string) => {
      saveLegalConsent();
      const { dekKey, rawDekBytes, envelope, payload } = await unlockEncryptedVault(pin);

      let ownershipTransferred = false;
      try {
        installActiveVaultSession(
          {
            dekKey,
            rawDekBytes,
            pinLength: envelope.pinLength,
          },
          payload
        );
        ownershipTransferred = true;
        setIsBiometricEnabled(isBiometricUnlockEnabled());

        setGateState({
          mode: 'unlocked_vault',
          sessionId: Date.now(),
        });
      } finally {
        if (!ownershipTransferred) {
          zeroOutBytes(rawDekBytes);
        }
      }
    },
    [installActiveVaultSession]
  );

  const handleUnlockVaultWithBiometricsFromGate = useCallback(async () => {
    saveLegalConsent();
    const { dekKey, rawDekBytes, envelope, payload } =
      await unlockEncryptedVaultWithBiometrics();

    let ownershipTransferred = false;
    try {
      installActiveVaultSession(
        {
          dekKey,
          rawDekBytes,
          pinLength: envelope.pinLength,
        },
        payload
      );
      ownershipTransferred = true;
      setIsBiometricEnabled(isBiometricUnlockEnabled());

      setGateState({
        mode: 'unlocked_vault',
        sessionId: Date.now(),
      });
    } finally {
      if (!ownershipTransferred) {
        zeroOutBytes(rawDekBytes);
      }
    }
  }, [installActiveVaultSession]);

  const handleToggleBiometrics = useCallback(async (enable: boolean) => {
    if (!enable) {
      await disableVaultBiometrics();
      setIsBiometricEnabled(false);
      return;
    }

    const session = activeVaultSessionRef.current;
    if (!session || !session.rawDekBytes) {
      throw new Error('볼트 암호화 세션이 활성화되어 있지 않습니다.');
    }

    const transientDek = new Uint8Array(session.rawDekBytes);
    try {
      await enableVaultBiometrics(transientDek);
      setIsBiometricEnabled(true);
    } finally {
      zeroOutBytes(transientDek);
    }
  }, []);

  const handleEnterBrowseWithoutLock = useCallback(() => {
    saveLegalConsent();
    setBrowseSessionActive(true);
    clearActiveSessionMemory();
    setGateState({
      mode: 'unlocked_browse',
      sessionId: Date.now(),
    });
  }, [clearActiveSessionMemory]);

  const handleFactoryResetVault = useCallback(() => {
    clearActiveSessionMemory();
    factoryResetLocalWorkspace();
    setIsBiometricEnabled(false);
    setGateState({ mode: 'onboarding' });
  }, [clearActiveSessionMemory]);

  const handleLockNow = useCallback(() => {
    const envelope = readStoredVaultEnvelope();
    clearActiveSessionMemory();
    setIsBiometricEnabled(isBiometricUnlockEnabled());
    if (envelope) {
      setGateState({ mode: 'locked', pinLength: envelope.pinLength });
    } else {
      setBrowseSessionActive(false);
      setGateState({ mode: 'onboarding' });
    }
  }, [clearActiveSessionMemory]);

  const handleReturnToIntroGate = useCallback(() => {
    setBrowseSessionActive(false);
    clearActiveSessionMemory();
    setGateState({ mode: 'onboarding' });
  }, [clearActiveSessionMemory]);

  const handleSetupOrChangePinInWorkspace = useCallback(
    async (
      newPin: string,
      pinLength: PinLengthOption,
      currentBundle: VaultPlaintextBundle,
      enableBiometricsAfterSetup?: boolean
    ) => {
      saveLegalConsent();
      const existingRawDek = activeVaultSessionRef.current?.rawDekBytes
        ? new Uint8Array(activeVaultSessionRef.current.rawDekBytes)
        : undefined;

      let nextRawDek: Uint8Array | null = null;
      let ownershipTransferred = false;

      try {
        const { dekKey, rawDekBytes, envelope } = await createEncryptedVault(
          newPin,
          pinLength,
          currentBundle,
          existingRawDek
        );
        nextRawDek = rawDekBytes;

        let bioRegistered = false;
        if (enableBiometricsAfterSetup && !existingRawDek) {
          try {
            await enableVaultBiometrics(rawDekBytes);
            setIsBiometricEnabled(true);
            bioRegistered = true;
          } catch {
            setIsBiometricEnabled(false);
          }
        } else {
          setIsBiometricEnabled(isBiometricUnlockEnabled());
        }

        const wasAlreadyVaultMode = gateStateRef.current.mode === 'unlocked_vault';
        clearActiveSessionMemory();
        activeSessionGenerationRef.current += 1;
        activeVaultSessionRef.current = {
          dekKey,
          rawDekBytes,
          pinLength: envelope.pinLength,
        };
        ownershipTransferred = true;
        lastEncryptedSignatureRef.current = computeBundleDigest(currentBundle);

        if (!wasAlreadyVaultMode) {
          unlockedBootstrapBundleRef.current = currentBundle;
          setTransitionNotice(
            bioRegistered
              ? 'AES-256-GCM 볼트 및 생체 인증 잠금 해제가 활성화되었습니다.'
              : 'AES-256-GCM 볼트 암호화가 활성화되었습니다.'
          );
          setGateState({
            mode: 'unlocked_vault',
            sessionId: Date.now(),
          });
        }
      } finally {
        zeroOutBytes(existingRawDek);
        if (!ownershipTransferred) {
          zeroOutBytes(nextRawDek);
        }
      }
    },
    [clearActiveSessionMemory]
  );

  const handleDisableVaultEncryptionInWorkspace = useCallback(
    (currentBundle: VaultPlaintextBundle) => {
      clearActiveSessionMemory();
      disableEncryptedVault(currentBundle);
      setIsBiometricEnabled(false);
      setTransitionNotice('볼트 암호화가 해제되어 일반 모드로 전환되었습니다.');
      setGateState({
        mode: 'unlocked_browse',
        sessionId: Date.now(),
      });
    },
    [clearActiveSessionMemory]
  );

  const handleChangeAutoLockMinutes = useCallback((mins: AutoLockMinutesOption) => {
    setAutoLockMinutes(mins);
    saveAutoLockMinutes(mins);
  }, []);

  if (isDecodingShareUrl) {
    return (
      <div className="h-screen w-screen bg-[#080a10] text-neutral-400 flex items-center justify-center text-xs font-sans">
        브리핑 패스를 불러오는 중...
      </div>
    );
  }

  if (urlSharedPayload) {
    return (
      <SharedPassStandaloneView
        payload={urlSharedPayload}
        isPreviewMode={false}
        onExit={handleExitUrlShareMode}
      />
    );
  }

  if (gateState.mode === 'onboarding' || gateState.mode === 'locked') {
    return (
      <VaultIntroGate
        mode={gateState.mode}
        vaultPinLength={gateState.mode === 'locked' ? gateState.pinLength : 4}
        isBiometricEnabled={gateState.mode === 'locked' ? isBiometricEnabled : false}
        initialHasConsented={Boolean(readLegalConsent())}
        onCreateVault={handleCreateVaultFromGate}
        onUnlockVault={handleUnlockVaultFromGate}
        onUnlockVaultWithBiometrics={handleUnlockVaultWithBiometricsFromGate}
        onEnterBrowseWithoutLock={handleEnterBrowseWithoutLock}
        onFactoryResetVault={handleFactoryResetVault}
      />
    );
  }

  return (
    <WorkspaceContent
      key={
        gateState.mode === 'unlocked_vault'
          ? `vault-${gateState.sessionId}`
          : `browse-${gateState.sessionId}`
      }
      isVaultEncrypted={gateState.mode === 'unlocked_vault'}
      isBiometricEnabled={isBiometricEnabled}
      isBiometricHardwareAvailable={isBiometricHardwareAvailable}
      getInitialVaultBundle={
        gateState.mode === 'unlocked_vault' ? getInitialVaultBundle : undefined
      }
      onConsumeInitialVaultBundle={handleConsumeInitialVaultBundle}
      initialToastNotice={transitionNotice}
      onConsumeToastNotice={() => setTransitionNotice(null)}
      autoLockMinutes={autoLockMinutes}
      onChangeAutoLockMinutes={handleChangeAutoLockMinutes}
      onToggleBiometrics={handleToggleBiometrics}
      onPersistEncryptedBundle={handlePersistEncryptedBundle}
      onLockNow={handleLockNow}
      onReturnToIntroGate={handleReturnToIntroGate}
      onSetupOrChangePin={handleSetupOrChangePinInWorkspace}
      onDisableVaultEncryption={handleDisableVaultEncryptionInWorkspace}
    />
  );
}
