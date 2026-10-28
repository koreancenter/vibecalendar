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
import { useTimeZonePreferences } from './hooks/useTimeZonePreferences';
import { CalendarEventItem, ProjectItem } from './types';
import { addDays } from './shared/dateUtils';
import { hasEventConflict } from './shared/scheduleUtils';
import {
  mapEventsToViewerZone,
  projectEventToViewerTimeZone,
  toViewerProjectedEvent,
} from './shared/timeZoneUtils';
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
  | {
      mode: 'unlocked_vault';
      initialBundle: VaultPlaintextBundle;
      sessionId: number;
    };

interface WorkspaceContentProps {
  isVaultEncrypted: boolean;
  isBiometricEnabled: boolean;
  isBiometricHardwareAvailable: boolean;
  initialVaultBundle?: VaultPlaintextBundle;
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
  initialVaultBundle,
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

  const latestBundleRef = useRef<VaultPlaintextBundle>({
    events: initialVaultBundle?.events ?? [],
    projects: initialVaultBundle?.projects ?? [],
    selectedProjectIds: initialVaultBundle?.selectedProjectIds ?? [],
  });

  const handleEncryptedProjectsChange = useCallback(
    (nextProjects: ProjectItem[], nextSelectedIds: string[]) => {
      latestBundleRef.current = {
        ...latestBundleRef.current,
        projects: nextProjects,
        selectedProjectIds: nextSelectedIds,
      };
      onPersistEncryptedBundle(latestBundleRef.current);
    },
    [onPersistEncryptedBundle]
  );

  const handleEncryptedEventsChange = useCallback(
    (nextEvents: CalendarEventItem[]) => {
      latestBundleRef.current = {
        ...latestBundleRef.current,
        events: nextEvents,
      };
      onPersistEncryptedBundle(latestBundleRef.current);
    },
    [onPersistEncryptedBundle]
  );

  const vaultProjectsConfig = useMemo<VaultProjectsSyncConfig | undefined>(() => {
    if (!isVaultEncrypted || !initialVaultBundle) return undefined;
    return {
      isEncrypted: true,
      initialProjects: initialVaultBundle.projects,
      initialSelectedProjectIds: initialVaultBundle.selectedProjectIds,
      onEncryptedProjectsChange: handleEncryptedProjectsChange,
    };
  }, [handleEncryptedProjectsChange, initialVaultBundle, isVaultEncrypted]);

  const vaultEventsConfig = useMemo<VaultEventsSyncConfig | undefined>(() => {
    if (!isVaultEncrypted || !initialVaultBundle) return undefined;
    return {
      isEncrypted: true,
      initialEvents: initialVaultBundle.events,
      onEncryptedEventsChange: handleEncryptedEventsChange,
    };
  }, [handleEncryptedEventsChange, initialVaultBundle, isVaultEncrypted]);

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

  const isWorkspaceEmpty = events.length === 0 && projects.length === 0;
  const hasSampleData = useMemo(
    () => projects.some(isSampleProjectItem) || events.some(isSampleEventItem),
    [projects, events]
  );

  const handleLoadSampleData = useCallback(() => {
    const prevProjects = projects;
    const prevEvents = events;
    const prevSelectedIds = selectedProjectIds;
    const dataset = createSampleWorkspaceDataset(selectedDate);

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
    projects,
    events,
    selectedProjectIds,
    selectedDate,
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

  // 자리 비움 자동 잠금 타이머 (AES-256-GCM 활성 시)
  useEffect(() => {
    if (!isVaultEncrypted || autoLockMinutes <= 0) return;

    const timeoutMs = autoLockMinutes * 60 * 1000;
    let timerId: ReturnType<typeof setTimeout> = setTimeout(onLockNow, timeoutMs);
    let lastReset = Date.now();

    const resetTimer = () => {
      const now = Date.now();
      if (now - lastReset < 2000) return;
      lastReset = now;
      clearTimeout(timerId);
      timerId = setTimeout(onLockNow, timeoutMs);
    };

    window.addEventListener('pointerdown', resetTimer, { passive: true });
    window.addEventListener('keydown', resetTimer, { passive: true });
    window.addEventListener('mousemove', resetTimer, { passive: true });
    window.addEventListener('touchstart', resetTimer, { passive: true });

    return () => {
      clearTimeout(timerId);
      window.removeEventListener('pointerdown', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
    };
  }, [autoLockMinutes, isVaultEncrypted, onLockNow]);

  const selectedEventHasConflict = useMemo(() => {
    if (!selectedEvent) return false;
    return hasEventConflict(
      toViewerProjectedEvent(selectedEvent, tzPrefs.viewerTimeZone),
      mapEventsToViewerZone(events, tzPrefs.viewerTimeZone)
    );
  }, [selectedEvent, events, tzPrefs.viewerTimeZone]);

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
                onSelectEvent={(ev) => {
                  setSelectedEvent(ev);
                  setSelectedDate(
                    projectEventToViewerTimeZone(ev, tzPrefs.viewerTimeZone).localDate
                  );
                }}
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
                onSelectEvent={(ev) => {
                  setSelectedEvent(ev);
                  setSelectedDate(
                    projectEventToViewerTimeZone(ev, tzPrefs.viewerTimeZone).localDate
                  );
                }}
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
                onShareEvent={(ev) => setShareTarget({ kind: 'event', event: ev })}
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
  );
};

export default function App() {
  const [urlSharedPayload, setUrlSharedPayload] = useState<SharedPassPayload | null>(null);
  const [isDecodingShareUrl, setIsDecodingShareUrl] = useState<boolean>(() =>
    Boolean(extractShareTokenFromLocation())
  );

  const activeVaultSessionRef = useRef<ActiveVaultCryptoSession | null>(null);
  const lastEncryptedSignatureRef = useRef<string>('');
  const encryptionQueueRef = useRef<Promise<void>>(Promise.resolve());

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

  const clearActiveSessionMemory = useCallback(() => {
    if (activeVaultSessionRef.current?.rawDekBytes) {
      activeVaultSessionRef.current.rawDekBytes.fill(0);
    }
    activeVaultSessionRef.current = null;
    lastEncryptedSignatureRef.current = '';
  }, []);

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
    const session = activeVaultSessionRef.current;
    if (!session) return;

    const serialized = JSON.stringify(bundle);
    if (serialized === lastEncryptedSignatureRef.current) return;
    lastEncryptedSignatureRef.current = serialized;

    encryptionQueueRef.current = encryptionQueueRef.current
      .then(async () => {
        const currentSession = activeVaultSessionRef.current;
        if (!currentSession) return;
        await persistVaultDataWithActiveDek(currentSession.dekKey, bundle);
      })
      .catch((err) => {
        console.warn('AES-GCM 볼트 저장 실패:', err);
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

      activeVaultSessionRef.current = {
        dekKey,
        rawDekBytes: new Uint8Array(rawDekBytes),
        pinLength: envelope.pinLength,
      };
      lastEncryptedSignatureRef.current = JSON.stringify(initialBundle);
      setIsBiometricEnabled(false);

      setGateState({
        mode: 'unlocked_vault',
        initialBundle,
        sessionId: Date.now(),
      });
    },
    []
  );

  const handleUnlockVaultFromGate = useCallback(async (pin: string) => {
    saveLegalConsent();
    const { dekKey, rawDekBytes, envelope, payload } = await unlockEncryptedVault(pin);

    activeVaultSessionRef.current = {
      dekKey,
      rawDekBytes: new Uint8Array(rawDekBytes),
      pinLength: envelope.pinLength,
    };
    lastEncryptedSignatureRef.current = JSON.stringify(payload);
    setIsBiometricEnabled(isBiometricUnlockEnabled());

    setGateState({
      mode: 'unlocked_vault',
      initialBundle: payload,
      sessionId: Date.now(),
    });
  }, []);

  const handleUnlockVaultWithBiometricsFromGate = useCallback(async () => {
    saveLegalConsent();
    const { dekKey, rawDekBytes, envelope, payload } =
      await unlockEncryptedVaultWithBiometrics();

    activeVaultSessionRef.current = {
      dekKey,
      rawDekBytes: new Uint8Array(rawDekBytes),
      pinLength: envelope.pinLength,
    };
    lastEncryptedSignatureRef.current = JSON.stringify(payload);
    setIsBiometricEnabled(isBiometricUnlockEnabled());

    setGateState({
      mode: 'unlocked_vault',
      initialBundle: payload,
      sessionId: Date.now(),
    });
  }, []);

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

    await enableVaultBiometrics(new Uint8Array(session.rawDekBytes));
    setIsBiometricEnabled(true);
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

      const { dekKey, rawDekBytes, envelope } = await createEncryptedVault(
        newPin,
        pinLength,
        currentBundle,
        existingRawDek
      );

      activeVaultSessionRef.current = {
        dekKey,
        rawDekBytes: new Uint8Array(rawDekBytes),
        pinLength: envelope.pinLength,
      };
      lastEncryptedSignatureRef.current = JSON.stringify(currentBundle);

      let bioRegistered = false;
      if (enableBiometricsAfterSetup && !existingRawDek) {
        try {
          await enableVaultBiometrics(new Uint8Array(rawDekBytes));
          setIsBiometricEnabled(true);
          bioRegistered = true;
        } catch {
          setIsBiometricEnabled(false);
        }
      } else {
        setIsBiometricEnabled(isBiometricUnlockEnabled());
      }

      setGateState((prev) => {
        if (prev.mode === 'unlocked_vault') {
          return prev;
        }
        setTransitionNotice(
          bioRegistered
            ? 'AES-256-GCM 볼트 및 생체 인증 잠금 해제가 활성화되었습니다.'
            : 'AES-256-GCM 볼트 암호화가 활성화되었습니다.'
        );
        return {
          mode: 'unlocked_vault',
          initialBundle: currentBundle,
          sessionId: Date.now(),
        };
      });
    },
    []
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
      initialVaultBundle={
        gateState.mode === 'unlocked_vault' ? gateState.initialBundle : undefined
      }
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
