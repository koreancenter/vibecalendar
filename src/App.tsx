import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { TitleBar } from './components/TitleBar';
import { TimeZoneControl } from './components/TimeZoneControl';
import { AiChatSidebar } from './components/AiChatSidebar';
import { MonthGridView } from './components/MonthGridView';
import { WeekGridView } from './components/WeekGridView';
import { DayAgendaView } from './components/DayAgendaView';
import { OperationsRunsheetView } from './components/OperationsRunsheetView';
import { EventDetailModal } from './components/EventDetailModal';
import { EventComposerModal, EventComposerSeed } from './components/EventComposerModal';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { DeleteConfirmationModal } from './components/DeleteConfirmationModal';
import { ProjectSelectorBar } from './components/ProjectSelectorBar';
import { ProjectModal } from './components/ProjectModal';
import { ProjectManagementModal } from './components/ProjectManagementModal';
import { SharePassModal, ShareModalTarget } from './components/SharePassModal';
import { SharedPassStandaloneView } from './components/SharedPassStandaloneView';
import { PWAInstallButton, OfflineStatusBanner } from './components/PWAInstallButton';
import { VaultIntroGate } from './components/vault/VaultIntroGate';
import { VaultControlMenu } from './components/vault/VaultControlMenu';
import {
  LegalAndColophonDrawer,
  LegalDrawerTab,
} from './components/vault/LegalAndColophonDrawer';
import { EventHistoryPopover } from './components/EventHistoryPopover';
import { useToast } from './hooks/useToast';
import { useCalendarEvents, VaultEventsSyncConfig } from './hooks/useCalendarEvents';
import { EventHistoryProvider } from './hooks/useEventHistory';
import { useProjects, VaultProjectsSyncConfig } from './hooks/useProjects';
import {
  CalendarEventViewModelsProvider,
  useCalendarEventViewModels,
} from './hooks/useCalendarEventViewModels';
import { useTimeZonePreferences } from './hooks/useTimeZonePreferences';
import { useEventReminders } from './hooks/useEventReminders';
import { usePWAInstall } from './hooks/usePWAInstall';
import { LUXURY_PROJECT_COLORS } from './constants/projects';
import { CalendarEventItem, CalendarViewMode, ProjectItem } from './types';
import { addDays } from './shared/dateUtils';
import {
  parseOccurrenceIdentity,
  RECURRENCE_OCCURRENCE_SEP,
  resolveMasterEventId,
} from './shared/recurrenceUtils';
import { hasEventConflict } from './shared/scheduleUtils';
import {
  decodeSharePayload,
  extractShareTokenFromLocation,
  SharedPassPayload,
  sharedEventToCalendarItem,
} from './utils/shareCodec';
import { getEmptyCalendarGuideText } from './utils/emptyStateGuide';
import {
  downloadWorkspaceBackupFile,
  parseIcsContent,
  parseWorkspaceBackupJson,
} from './utils/icsImport';
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

interface PendingSharedImport {
  payload: SharedPassPayload;
  selectedSlotIndex?: number;
}

interface WorkspaceContentProps {
  isVaultEncrypted: boolean;
  isBiometricEnabled: boolean;
  isBiometricHardwareAvailable: boolean;
  getInitialVaultBundle?: () => VaultPlaintextBundle | null;
  onConsumeInitialVaultBundle?: () => void;
  initialToastNotice?: string | null;
  onConsumeToastNotice?: () => void;
  pendingSharedImport?: PendingSharedImport | null;
  onConsumePendingSharedImport?: () => void;
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
  pendingSharedImport,
  onConsumePendingSharedImport,
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
  const pwaInstall = usePWAInstall();

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
    handleCreateManualEvent,
    handleUpdateEventFields,
    handleImportEvents,
    handlePatchEventsLocations,
    clearProjectAssociation,
    handleDeleteEvent,
    handleToggleComplete,
    handleToggleChecklistItem,
    handleAddChecklistItem,
    handleUpdateChecklistItemText,
    handleDeleteChecklistItem,
    handleApplyAgentResponse,
    handleCreateEventFromVenue,
    handleCreateEventFromGroundedSuggestion,
    handleAutoRebalanceSchedule,
    applyEventsWithHistory,
    eventHistory,
  } = useCalendarEvents({
    showToast,
    selectedProjectId,
    selectedProjectIds,
    viewerTimeZone: tzPrefs.viewerTimeZone,
    vaultEventsConfig,
  });

  const { reminderLeadMinutes, setReminderLeadMinutes } = useEventReminders({
    events,
    viewerTimeZone: tzPrefs.viewerTimeZone,
    onInAppReminder: (msg) => showToast(msg),
  });

  const handleImportSharedPassPayload = useCallback(
    (payload: SharedPassPayload, selectedSlotIndex?: number) => {
      const prevProjects = projects;
      const prevEvents = events;
      const prevSelectedIds = selectedProjectIds;
      const nowStamp = Date.now();

      if (payload.kind === 'event' && payload.event) {
        const baseItem = sharedEventToCalendarItem(payload.event);
        const chosenSlot =
          selectedSlotIndex !== undefined
            ? payload.event.proposedSlots?.[selectedSlotIndex]
            : undefined;

        let targetProjectId: string | undefined;
        let createdProject: ProjectItem | null = null;
        const projNameTrimmed = payload.event.projectName?.trim();
        if (projNameTrimmed) {
          const existingProj = projects.find(
            (p) => p.name.trim().toLowerCase() === projNameTrimmed.toLowerCase()
          );
          if (existingProj) {
            targetProjectId = existingProj.id;
          } else {
            const palette =
              LUXURY_PROJECT_COLORS[projects.length % LUXURY_PROJECT_COLORS.length];
            createdProject = {
              id: `proj-pass-${nowStamp}`,
              name: projNameTrimmed,
              color: palette.hex,
              status: 'active',
              createdAt: new Date().toISOString(),
            };
            targetProjectId = createdProject.id;
          }
        }

        const importedEvent: CalendarEventItem = {
          ...baseItem,
          id: `pass-evt-${nowStamp}-${Math.random().toString(36).slice(2, 6)}`,
          projectId: targetProjectId,
          ...(chosenSlot
            ? {
                date: chosenSlot.date,
                endDate: undefined,
                startTime: chosenSlot.startTime,
                endTime: chosenSlot.endTime,
                isAllDay: false,
              }
            : {}),
          checklist: baseItem.checklist?.map((chk, idx) => ({
            ...chk,
            id: `chk-pass-${nowStamp}-${idx}`,
          })),
        };

        if (createdProject) {
          setProjects((curr) => [...curr, createdProject!]);
        }
        const didRecord = applyEventsWithHistory((curr) => [...curr, importedEvent], {
          kind: 'import',
          label: `브리핑 패스 일정 '${importedEvent.title}' 반영`,
          detail: `${importedEvent.date.slice(5)} ${
            importedEvent.isAllDay ? '종일' : `${importedEvent.startTime}~${importedEvent.endTime}`
          }`,
          targetEventId: importedEvent.id,
          targetEventTitle: importedEvent.title,
          focusDate: importedEvent.date,
        });
        setSelectedEvent(importedEvent);
        jumpToDate(importedEvent.date);

        const slotNote = chosenSlot
          ? ` (${chosenSlot.date.slice(5)} ${chosenSlot.startTime} 확정 슬롯)`
          : '';
        showToast(
          `브리핑 패스 일정 '${importedEvent.title}'${slotNote}을(를) 내 워크스페이스에 반영했습니다.`,
          () => {
            setProjects(prevProjects);
            setSelectedProjectIds(prevSelectedIds);
            if (didRecord) {
              eventHistory.undoStep();
            } else {
              setEvents(prevEvents);
            }
          }
        );
        return;
      }

      if (payload.kind === 'project' && payload.project) {
        const pr = payload.project;
        const existingProj = projects.find(
          (p) =>
            p.name.trim().toLowerCase() === pr.name.trim().toLowerCase() ||
            (pr.code && p.code && p.code.trim().toLowerCase() === pr.code.trim().toLowerCase())
        );

        const palette =
          LUXURY_PROJECT_COLORS[projects.length % LUXURY_PROJECT_COLORS.length];
        const targetProject: ProjectItem = existingProj || {
          id: `proj-pass-${nowStamp}`,
          name: pr.name,
          code: pr.code,
          clientOrOrg: pr.clientOrOrg,
          description: pr.description,
          startDate: pr.startDate,
          endDate: pr.endDate,
          color: palette.hex,
          status: 'active',
          createdAt: new Date().toISOString(),
        };

        const importedEvents: CalendarEventItem[] = pr.events.map((ev, idx) => {
          const item = sharedEventToCalendarItem(ev);
          return {
            ...item,
            id: `pass-evt-${nowStamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
            projectId: targetProject.id,
            checklist: item.checklist?.map((chk, cIdx) => ({
              ...chk,
              id: `chk-pass-${nowStamp}-${idx}-${cIdx}`,
            })),
          };
        });

        if (!existingProj) {
          setProjects((curr) => [...curr, targetProject]);
        }
        let didRecord = false;
        if (importedEvents.length > 0) {
          didRecord = applyEventsWithHistory((curr) => [...curr, ...importedEvents], {
            kind: 'import',
            label: `공유 프로젝트 '${pr.name}' 일정 반영 (${importedEvents.length}건)`,
            detail: importedEvents[0] ? `'${importedEvents[0].title}' 외` : undefined,
            focusDate: importedEvents[0]?.date || pr.startDate,
          });
        }
        setSelectedProjectId(targetProject.id);
        setSelectedCategory('전체');
        const anchorDate = importedEvents[0]?.date || pr.startDate;
        if (anchorDate) {
          jumpToDate(anchorDate);
        }
        if (importedEvents[0]) {
          setSelectedEvent(importedEvents[0]);
        }

        showToast(
          `공유 프로젝트 '${pr.name}' 및 런시트 일정 ${importedEvents.length}건을 내 워크스페이스에 반영했습니다.`,
          () => {
            setProjects(prevProjects);
            setSelectedProjectIds(prevSelectedIds);
            if (didRecord) {
              eventHistory.undoStep();
            } else {
              setEvents(prevEvents);
            }
          }
        );
      }
    },
    [
      applyEventsWithHistory,
      eventHistory,
      events,
      jumpToDate,
      projects,
      selectedProjectIds,
      setEvents,
      setProjects,
      setSelectedCategory,
      setSelectedEvent,
      setSelectedProjectId,
      setSelectedProjectIds,
      showToast,
    ]
  );

  useEffect(() => {
    if (!pendingSharedImport) return;
    const queued = pendingSharedImport;
    onConsumePendingSharedImport?.();
    handleImportSharedPassPayload(queued.payload, queued.selectedSlotIndex);
  }, [handleImportSharedPassPayload, onConsumePendingSharedImport, pendingSharedImport]);

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
    const didRecord = applyEventsWithHistory(
      (curr) => {
        const userOnly = curr.filter((e) => !isSampleEventItem(e));
        return [...dataset.events, ...userOnly];
      },
      {
        kind: 'import',
        label: `샘플 일정 불러오기 (${dataset.events.length}건)`,
        detail: '가상 장소 기반 샘플 일정 반영',
        focusDate: dataset.focusDate,
      }
    );
    setSelectedProjectId('all');
    setSelectedCategory('전체');
    jumpToDate(dataset.focusDate);

    showToast('가상 장소 기반 샘플 데이터를 불러왔습니다.', () => {
      setProjects(prevProjects);
      setSelectedProjectIds(prevSelectedIds);
      if (didRecord) {
        eventHistory.undoStep();
      } else {
        setEvents(prevEvents);
      }
    });
  }, [
    applyEventsWithHistory,
    eventHistory,
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
    const sampleCount = prevEvents.filter(isSampleEventItem).length;

    setProjects((curr) => curr.filter((p) => !isSampleProjectItem(p)));
    const didRecord = applyEventsWithHistory((curr) => curr.filter((e) => !isSampleEventItem(e)), {
      kind: 'delete',
      label: '샘플 일정 일괄 비우기',
      detail: sampleCount > 0 ? `샘플 일정 ${sampleCount}건 제거` : undefined,
    });
    setSelectedEvent((curr) => (curr && isSampleEventItem(curr) ? null : curr));

    showToast('샘플 데이터를 모두 비웠습니다.', () => {
      setProjects(prevProjects);
      setSelectedProjectIds(prevSelectedIds);
      if (didRecord) {
        eventHistory.undoStep();
      } else {
        setEvents(prevEvents);
      }
    });
  }, [
    applyEventsWithHistory,
    eventHistory,
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

  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [composerSeed, setComposerSeed] = useState<EventComposerSeed | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [historyOpenTick, setHistoryOpenTick] = useState(0);
  const [externalPromptRequest, setExternalPromptRequest] = useState<{
    id: number;
    prompt: string;
    autoSend?: boolean;
  } | null>(null);
  const paletteIcsInputRef = useRef<HTMLInputElement>(null);

  const [legalDrawer, setLegalDrawer] = useState<{
    isOpen: boolean;
    tab: LegalDrawerTab;
  }>({
    isOpen: false,
    tab: 'disclaimer',
  });

  const handleOpenCreateEvent = useCallback(
    (seedOverrides?: Partial<EventComposerSeed>) => {
      const defaultProjId =
        selectedProjectId && selectedProjectId !== 'all'
          ? selectedProjectId
          : selectedProjectIds.length === 1
          ? selectedProjectIds[0]
          : undefined;
      const defaultCat =
        selectedCategory && selectedCategory !== '전체' ? selectedCategory : undefined;

      setComposerSeed({
        date: selectedDate,
        projectId: defaultProjId,
        category: defaultCat,
        ...seedOverrides,
      });
    },
    [selectedDate, selectedProjectId, selectedProjectIds, selectedCategory]
  );

  const handleOpenCreateEventFromSlot = useCallback(
    (date: string, startTime?: string, endTime?: string) => {
      handleOpenCreateEvent({
        date,
        startTime,
        endTime,
        isAllDay: false,
      });
    },
    [handleOpenCreateEvent]
  );

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
    if (viewMode === 'month' || viewMode === 'ops') {
      handlePrevMonth();
      return;
    }
    const offset = viewMode === 'week' ? -7 : -1;
    const newDate = addDays(selectedDate, offset);
    setSelectedDate(newDate);
    syncYearMonthFromDate(newDate);
  }, [viewMode, handlePrevMonth, selectedDate, setSelectedDate, syncYearMonthFromDate]);

  const handleNext = useCallback(() => {
    if (viewMode === 'month' || viewMode === 'ops') {
      handleNextMonth();
      return;
    }
    const offset = viewMode === 'week' ? 7 : 1;
    const newDate = addDays(selectedDate, offset);
    setSelectedDate(newDate);
    syncYearMonthFromDate(newDate);
  }, [viewMode, handleNextMonth, selectedDate, setSelectedDate, syncYearMonthFromDate]);

  const handleImportIcsFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const defaultProjId =
          selectedProjectId && selectedProjectId !== 'all'
            ? selectedProjectId
            : selectedProjectIds.length === 1
            ? selectedProjectIds[0]
            : undefined;

        const parsed = parseIcsContent(text, {
          existingEvents: events,
          defaultProjectId: defaultProjId,
          viewerTimeZone: tzPrefs.viewerTimeZone,
        });

        if (parsed.events.length === 0) {
          showToast(
            parsed.skippedDuplicates > 0
              ? `중복 일정 ${parsed.skippedDuplicates}건을 제외하여 새로 추가할 일정이 없습니다.`
              : '파일에서 가져올 수 있는 표준 일정(VEVENT)을 찾지 못했습니다.'
          );
          return;
        }

        const dupSuffix =
          parsed.skippedDuplicates > 0 ? ` (중복 ${parsed.skippedDuplicates}건 제외)` : '';
        handleImportEvents(
          parsed.events,
          `'${file.name}'에서 일정 ${parsed.events.length}건을 가져왔습니다.${dupSuffix}`
        );
      } catch (err: unknown) {
        showToast(
          err instanceof Error && err.message
            ? err.message
            : 'ICS 일정 파일을 읽는 중 오류가 발생했습니다.'
        );
      }
    },
    [events, handleImportEvents, selectedProjectId, selectedProjectIds, showToast, tzPrefs.viewerTimeZone]
  );

  const handleExportWorkspaceJson = useCallback(() => {
    downloadWorkspaceBackupFile(events, projects);
    showToast(
      `프로젝트 ${projects.length}개 · 일정 ${events.length}건 통합 백업(.json) 파일이 다운로드되었습니다.`
    );
  }, [events, projects, showToast]);

  const handleImportWorkspaceJsonFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const restored = parseWorkspaceBackupJson(text);
        const prevProjects = projects;
        const prevEvents = events;
        const prevSelectedIds = selectedProjectIds;

        if (restored.projects.length > 0) {
          setProjects(restored.projects);
        }
        const didRecord = applyEventsWithHistory(restored.events, {
          kind: 'import',
          label: `백업 파일 복원 (${restored.events.length}건)`,
          detail: `'${file.name}' 워크스페이스 복원`,
          focusDate: restored.events[0]?.date,
        });
        setSelectedProjectId('all');
        setSelectedCategory('전체');
        setSelectedEvent(restored.events[0] || null);
        if (restored.events[0]?.date) {
          jumpToDate(restored.events[0].date);
        }

        showToast(
          `백업 파일에서 프로젝트 ${restored.projects.length}개 · 일정 ${restored.events.length}건을 복원했습니다.`,
          () => {
            setProjects(prevProjects);
            setSelectedProjectIds(prevSelectedIds);
            if (didRecord) {
              eventHistory.undoStep();
            } else {
              setEvents(prevEvents);
            }
          }
        );
      } catch (err: unknown) {
        showToast(
          err instanceof Error && err.message
            ? err.message
            : '백업 JSON 파일 복원 중 오류가 발생했습니다.'
        );
      }
    },
    [
      applyEventsWithHistory,
      eventHistory,
      events,
      jumpToDate,
      projects,
      selectedProjectIds,
      setEvents,
      setProjects,
      setSelectedCategory,
      setSelectedEvent,
      setSelectedProjectId,
      setSelectedProjectIds,
      showToast,
    ]
  );

  const handleRequestReverseMilestones = useCallback(
    (customPrompt?: string) => {
      const activeProj =
        selectedProjectId && selectedProjectId !== 'all'
          ? projects.find((p) => p.id === selectedProjectId)
          : selectedProjectIds.length === 1
          ? projects.find((p) => p.id === selectedProjectIds[0])
          : undefined;

      const anchorDate = activeProj?.endDate || activeProj?.startDate || selectedDate;
      const subjectLabel = activeProj?.name || '본 행사';
      const resolvedPrompt =
        customPrompt ||
        `'${subjectLabel}' 개최일(${anchorDate})을 D-Day로 잡고 D-30, D-14, D-7, D-3, D-1 핵심 역산 준비 공정 일정과 각 단계별 사전 체크리스트를 캘린더에 일괄 설계해서 등록해 줘.`;

      setIsSidebarOpen(true);
      setExternalPromptRequest({
        id: Date.now(),
        prompt: resolvedPrompt,
        autoSend: true,
      });
    },
    [projects, selectedDate, selectedProjectId, selectedProjectIds]
  );

  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    title: string;
    itemName: string;
    itemType: '일정' | '프로젝트';
    isRecurringSeries?: boolean;
    occurrenceDateLabel?: string;
    onConfirmSingleOccurrence?: () => void;
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
      const { masterId, occurrenceDate } = parseOccurrenceIdentity(eventId);
      const target = events.find((e) => e.id === masterId);
      if (!target) return;

      const isRecurring = Boolean(target.recurrence);
      const resolvedOccDate =
        occurrenceDate ||
        (selectedEvent && resolveMasterEventId(selectedEvent.id) === masterId
          ? selectedEvent.occurrenceDate || selectedEvent.date
          : undefined) ||
        target.date;

      setDeleteModalState({
        isOpen: true,
        title: isRecurring ? '반복 일정 삭제 확인' : '일정 삭제 확인',
        itemName: target.title,
        itemType: '일정',
        isRecurringSeries: isRecurring,
        occurrenceDateLabel: isRecurring ? resolvedOccDate : undefined,
        onConfirmSingleOccurrence: isRecurring
          ? () => {
              handleDeleteEvent(
                `${masterId}${RECURRENCE_OCCURRENCE_SEP}${resolvedOccDate}`,
                'single'
              );
            }
          : undefined,
        onConfirm: () => {
          handleDeleteEvent(masterId, 'all');
        },
      });
    },
    [events, handleDeleteEvent, selectedEvent]
  );

  const requestDeleteProject = useCallback(
    (project: ProjectItem) => {
      setDeleteModalState({
        isOpen: true,
        title: '프로젝트 삭제 확인',
        itemName: project.name,
        itemType: '프로젝트',
        isRecurringSeries: false,
        occurrenceDateLabel: undefined,
        onConfirmSingleOccurrence: undefined,
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

  // 글로벌 단축키: Cmd/Ctrl+K (통합 검색·명령 팔레트), Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z (수정 히스토리), Cmd/Ctrl+L (볼트 잠금), /, N, C, T, M, W, D, O, H
  useEffect(() => {
    const isEditableElement = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable || el.closest('[contenteditable="true"]')) return true;
      return false;
    };

    const handleShortcut = (e: KeyboardEvent) => {
      const lowerKey = e.key.toLowerCase();

      if ((e.metaKey || e.ctrlKey) && lowerKey === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && lowerKey === 'l') {
        e.preventDefault();
        if (isVaultEncrypted) {
          onLockNow();
        } else {
          onReturnToIntroGate();
        }
        return;
      }

      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.isComposing &&
        !isEditableElement(e.target) &&
        !isEditableElement(document.activeElement)
      ) {
        if (lowerKey === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            eventHistory.redoStep();
          } else {
            eventHistory.undoStep();
          }
          return;
        }
        if (!e.shiftKey && lowerKey === 'y') {
          e.preventDefault();
          eventHistory.redoStep();
          return;
        }
      }

      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (isEditableElement(e.target) || isEditableElement(document.activeElement)) return;

      const hasBlockingOverlay =
        Boolean(composerSeed) ||
        isCommandPaletteOpen ||
        Boolean(selectedEvent && viewMode !== 'agenda' && viewMode !== 'ops') ||
        isProjectModalOpen ||
        isProjectManagementOpen ||
        Boolean(shareTarget) ||
        Boolean(previewSharedPayload) ||
        legalDrawer.isOpen ||
        deleteModalState.isOpen;

      if (hasBlockingOverlay) return;

      if (e.key === '/') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      } else if (lowerKey === 'n' || lowerKey === 'c') {
        e.preventDefault();
        handleOpenCreateEvent();
      } else if (lowerKey === 't') {
        e.preventDefault();
        handleToday();
      } else if (lowerKey === 'm') {
        e.preventDefault();
        setViewMode('month');
      } else if (lowerKey === 'w') {
        e.preventDefault();
        setViewMode('week');
      } else if (lowerKey === 'd') {
        e.preventDefault();
        setViewMode('agenda');
      } else if (lowerKey === 'o') {
        e.preventDefault();
        setViewMode('ops');
      } else if (lowerKey === 'h') {
        e.preventDefault();
        setHistoryOpenTick(Date.now());
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [
    composerSeed,
    deleteModalState.isOpen,
    eventHistory,
    handleOpenCreateEvent,
    handleToday,
    isCommandPaletteOpen,
    isProjectManagementOpen,
    isProjectModalOpen,
    isVaultEncrypted,
    legalDrawer.isOpen,
    onLockNow,
    onReturnToIntroGate,
    previewSharedPayload,
    selectedEvent,
    shareTarget,
    viewMode,
  ]);

  return (
    <CalendarEventViewModelsProvider value={workspaceViewModels}>
      <EventHistoryProvider value={eventHistory}>
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0a0c10] text-neutral-200 font-sans antialiased">
      <input
        ref={paletteIcsInputRef}
        type="file"
        accept=".ics,text/calendar"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) {
            void handleImportIcsFile(file);
          }
        }}
      />

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
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenCreateEvent={() => handleOpenCreateEvent()}
        onImportIcsFile={(file) => void handleImportIcsFile(file)}
        onExportWorkspaceJson={handleExportWorkspaceJson}
        onImportWorkspaceJsonFile={(file) => void handleImportWorkspaceJsonFile(file)}
        selectedDate={selectedDate}
        events={filteredEvents}
        projects={projects}
        selectedProjectIds={selectedProjectIds}
        selectedCategory={selectedCategory}
        historySlot={<EventHistoryPopover externalOpenRequest={historyOpenTick} />}
        timeZoneSlot={
          <TimeZoneControl
            now={tzPrefs.now}
            viewerMeta={tzPrefs.viewerMeta}
            viewerClock={tzPrefs.viewerClock}
            secondaryMeta={tzPrefs.secondaryMeta}
            secondaryClock={tzPrefs.secondaryClock}
            secondaryDiffLabel={tzPrefs.secondaryDiffLabel}
            isManualPrimary={tzPrefs.isManualPrimary}
            onSelectSecondaryTimeZone={(tz) => {
              tzPrefs.setSecondaryTimeZone(tz);
              showToast(
                tz
                  ? '글로벌 보조 시간대(듀얼 타임라인 축)가 활성화되었습니다.'
                  : '보조 시간대 표시가 해제되었습니다.'
              );
            }}
            onSelectPrimaryTimeZone={(tz) => {
              tzPrefs.setManualViewerTimeZone(tz);
              if (tz) {
                showToast('기준 시간대가 수동 전환되었습니다.');
              }
            }}
            onResetPrimaryToSystem={() => {
              tzPrefs.resetViewerTimeZoneToSystem();
              showToast('기기 현재 위치 시간대 자동 감지로 복원되었습니다.');
            }}
            onSwapTimeZones={() => {
              tzPrefs.swapPrimaryAndSecondary();
              showToast('기준 시간대와 보조 시간대를 맞바꿨습니다.');
            }}
          />
        }
        vaultSlot={
          <div className="flex items-center gap-1.5 shrink-0">
            <PWAInstallButton
              variant="toolbar"
              onInstalled={() => showToast('오프라인 현장 앱 설치가 완료되었습니다.')}
            />
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
              reminderLeadMinutes={reminderLeadMinutes}
              onChangeReminderLeadMinutes={(lead) => {
                void setReminderLeadMinutes(lead);
                showToast(
                  lead === 0
                    ? '임박 일정 로컬 알림이 해제되었습니다.'
                    : `일정 시작 ${lead}분 전 로컬 알림이 활성화되었습니다.`
                );
              }}
              onPwaInstalled={() => showToast('오프라인 현장 앱 설치가 완료되었습니다.')}
            />
          </div>
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
              onPatchEventsLocations={handlePatchEventsLocations}
              onCreateEventFromVenue={handleCreateEventFromVenue}
              onAddGroundedSuggestion={handleCreateEventFromGroundedSuggestion}
              onJumpToDate={jumpToDate}
              onUpdateTimeSlot={handleUpdateTimeSlot}
              showToast={showToast}
              projects={projects}
              selectedProjectId={selectedProjectId}
              selectedProjectIds={selectedProjectIds}
              externalPromptRequest={externalPromptRequest}
              onConsumeExternalPrompt={() => setExternalPromptRequest(null)}
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
                onOpenCreateEvent={(date) => handleOpenCreateEvent({ date })}
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
                secondaryTimeZone={tzPrefs.secondaryTimeZone}
                secondaryShortCode={tzPrefs.secondaryMeta?.shortCode}
                projects={projects}
                comparedProjectIds={selectedProjectIds}
                emptyGuideText={emptyGuideText}
                isWorkspaceEmpty={isWorkspaceEmpty}
                onLoadSampleData={handleLoadSampleData}
                onSelectDate={setSelectedDate}
                onSelectEvent={handleSelectCalendarEvent}
                onMoveEventDate={handleMoveEventDate}
                onOpenCreateEvent={handleOpenCreateEventFromSlot}
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
                secondaryTimeZone={tzPrefs.secondaryTimeZone}
                projects={projects}
                comparedProjectIds={selectedProjectIds}
                onUpdateProject={handleUpdateEventProject}
                onUpdateTimeZone={handleUpdateEventTimeZone}
                onUpdateLocation={handleUpdateEventLocation}
                onUpdateEventFields={handleUpdateEventFields}
                onAddChecklistItem={handleAddChecklistItem}
                onUpdateChecklistItemText={handleUpdateChecklistItemText}
                onDeleteChecklistItem={handleDeleteChecklistItem}
                onOpenCreateEvent={handleOpenCreateEventFromSlot}
                onSelectEvent={setSelectedEvent}
                onDeleteEvent={requestDeleteEvent}
                onToggleComplete={handleToggleComplete}
                onToggleChecklistItem={handleToggleChecklistItem}
                onMoveEventDate={handleMoveEventDate}
                onQuickAiPromptForDate={handleQuickAiPromptForDate}
                onShareEvent={handleShareEvent}
                onAutoRebalanceDate={(date) => {
                  handleAutoRebalanceSchedule(date);
                }}
                emptyGuideText={emptyGuideText}
                isWorkspaceEmpty={isWorkspaceEmpty}
                onLoadSampleData={handleLoadSampleData}
              />
            </div>
          )}

          {viewMode === 'ops' && (
            <div className="flex-1 h-full overflow-hidden flex flex-col">
              <OperationsRunsheetView
                events={filteredEvents}
                selectedDate={selectedDate}
                selectedDateEvents={selectedDateEvents}
                selectedEvent={selectedEvent}
                viewerTimeZone={tzPrefs.viewerTimeZone}
                projects={projects}
                selectedProjectId={selectedProjectId}
                comparedProjectIds={selectedProjectIds}
                emptyGuideText={emptyGuideText}
                isWorkspaceEmpty={isWorkspaceEmpty}
                onLoadSampleData={handleLoadSampleData}
                onSelectDate={(date) => {
                  setSelectedDate(date);
                  syncYearMonthFromDate(date);
                }}
                onSelectEvent={setSelectedEvent}
                onDeleteEvent={requestDeleteEvent}
                onToggleComplete={handleToggleComplete}
                onToggleChecklistItem={handleToggleChecklistItem}
                onUpdateProject={handleUpdateEventProject}
                onUpdateTimeZone={handleUpdateEventTimeZone}
                onUpdateLocation={handleUpdateEventLocation}
                onUpdateEventFields={handleUpdateEventFields}
                onAddChecklistItem={handleAddChecklistItem}
                onUpdateChecklistItemText={handleUpdateChecklistItemText}
                onDeleteChecklistItem={handleDeleteChecklistItem}
                onOpenCreateEvent={(date) => handleOpenCreateEvent({ date })}
                onShareEvent={handleShareEvent}
                onQuickAiPromptForDate={handleQuickAiPromptForDate}
                onRequestReverseMilestones={(prompt) => handleRequestReverseMilestones(prompt)}
                onAutoRebalance={() => {
                  handleAutoRebalanceSchedule();
                }}
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
        isRecurringSeries={deleteModalState.isRecurringSeries}
        occurrenceDateLabel={deleteModalState.occurrenceDateLabel}
        onConfirmSingleOccurrence={deleteModalState.onConfirmSingleOccurrence}
        onConfirm={deleteModalState.onConfirm}
        onClose={() => setDeleteModalState((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* 4. 일정 상세 모달 */}
      {viewMode !== 'agenda' && viewMode !== 'ops' && (
        <EventDetailModal
          event={selectedEvent}
          viewerTimeZone={tzPrefs.viewerTimeZone}
          projects={projects}
          onUpdateProject={handleUpdateEventProject}
          onUpdateTimeZone={handleUpdateEventTimeZone}
          onUpdateLocation={handleUpdateEventLocation}
          onUpdateEventFields={handleUpdateEventFields}
          onAddChecklistItem={handleAddChecklistItem}
          onUpdateChecklistItemText={handleUpdateChecklistItemText}
          onDeleteChecklistItem={handleDeleteChecklistItem}
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

      {/* 4-2. 수동 새 일정 빠른 등록 모달 */}
      {composerSeed && (
        <EventComposerModal
          isOpen={Boolean(composerSeed)}
          seed={composerSeed}
          viewerTimeZone={tzPrefs.viewerTimeZone}
          existingEvents={events}
          projects={projects}
          onClose={() => setComposerSeed(null)}
          onSubmit={(draft) => {
            handleCreateManualEvent(draft);
            setComposerSeed(null);
          }}
        />
      )}

      {/* 4-3. 통합 검색 및 빠른 명령 팔레트 (Cmd/Ctrl + K) */}
      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        events={events}
        projects={projects}
        selectedProjectId={selectedProjectId}
        viewMode={viewMode}
        isSidebarOpen={isSidebarOpen}
        isVaultEncrypted={isVaultEncrypted}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectEvent={(ev) => {
          jumpToDate(ev.date);
          handleSelectCalendarEvent(ev);
        }}
        onSelectProject={(projId) => {
          setSelectedProjectId(projId);
          if (projId !== 'all') {
            const proj = projects.find((p) => p.id === projId);
            if (proj?.startDate) {
              jumpToDate(proj.startDate);
            }
          }
        }}
        onOpenCreateEvent={(prefillTitle) => {
          handleOpenCreateEvent(prefillTitle ? { title: prefillTitle } : undefined);
        }}
        onOpenCreateProject={() => {
          setEditingProject(null);
          setIsProjectModalOpen(true);
        }}
        onChangeViewMode={setViewMode}
        onToday={handleToday}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        onLockVault={() => {
          if (isVaultEncrypted) {
            onLockNow();
          } else {
            onReturnToIntroGate();
          }
        }}
        onTriggerReverseMilestones={() => handleRequestReverseMilestones()}
        onTriggerImportIcs={() => paletteIcsInputRef.current?.click()}
        onExportWorkspaceJson={handleExportWorkspaceJson}
        onAutoRebalance={() => {
          handleAutoRebalanceSchedule(viewMode === 'agenda' ? selectedDate : undefined);
        }}
        hasDualTimeZone={Boolean(tzPrefs.secondaryTimeZone)}
        onToggleDualTimeZone={() => {
          if (tzPrefs.secondaryTimeZone) {
            tzPrefs.setSecondaryTimeZone(null);
            showToast('보조 시간대 표시가 해제되었습니다.');
          } else {
            const fallbackSecondary =
              tzPrefs.viewerTimeZone === 'UTC' ? 'Asia/Seoul' : 'UTC';
            tzPrefs.setSecondaryTimeZone(fallbackSecondary);
            showToast(
              `글로벌 보조 시간대(${fallbackSecondary === 'UTC' ? 'UTC' : 'KST'}) 듀얼 축이 활성화되었습니다.`
            );
          }
        }}
        reminderLeadMinutes={reminderLeadMinutes}
        onChangeReminderLeadMinutes={(lead) => {
          void setReminderLeadMinutes(lead);
          showToast(
            lead === 0
              ? '임박 일정 로컬 알림이 해제되었습니다.'
              : `일정 시작 ${lead}분 전 로컬 알림이 활성화되었습니다.`
          );
        }}
        canInstallPwa={!pwaInstall.isInstalled && pwaInstall.isInstallable}
        onInstallPwa={() => {
          void pwaInstall.install().then((accepted) => {
            if (accepted) {
              showToast('오프라인 현장 앱 설치가 완료되었습니다.');
            }
          });
        }}
        onOpenHistoryPopover={() => setHistoryOpenTick(Date.now())}
      />

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
            onImportToWorkspace={(pl, slotIdx) => {
              setPreviewSharedPayload(null);
              handleImportSharedPassPayload(pl, slotIdx);
            }}
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
      </EventHistoryProvider>
    </CalendarEventViewModelsProvider>
  );
};

export default function App() {
  const [urlSharedPayload, setUrlSharedPayload] = useState<SharedPassPayload | null>(null);
  const [pendingSharedImport, setPendingSharedImport] = useState<PendingSharedImport | null>(
    null
  );
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

  const handleImportFromUrlSharePass = useCallback(
    (payload: SharedPassPayload, selectedSlotIndex?: number) => {
      handleExitUrlShareMode();
      setPendingSharedImport({ payload, selectedSlotIndex });
      if (gateStateRef.current.mode === 'onboarding') {
        saveLegalConsent();
        setBrowseSessionActive(true);
        setGateState({
          mode: 'unlocked_browse',
          sessionId: Date.now(),
        });
      }
    },
    [handleExitUrlShareMode]
  );

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
      <>
        <SharedPassStandaloneView
          payload={urlSharedPayload}
          isPreviewMode={false}
          onImportToWorkspace={handleImportFromUrlSharePass}
          onExit={handleExitUrlShareMode}
        />
        <OfflineStatusBanner />
      </>
    );
  }

  if (gateState.mode === 'onboarding' || gateState.mode === 'locked') {
    return (
      <>
        {pendingSharedImport && gateState.mode === 'locked' && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-xl bg-[#13161f]/95 border border-white/[0.12] text-xs text-neutral-200 shadow-2xl backdrop-blur-md whitespace-nowrap">
            암호화 볼트 잠금을 해제하면 공유 브리핑 패스가 내 워크스페이스에 자동 반영됩니다.
          </div>
        )}
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
        <OfflineStatusBanner />
      </>
    );
  }

  return (
    <>
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
        pendingSharedImport={pendingSharedImport}
        onConsumePendingSharedImport={() => setPendingSharedImport(null)}
        autoLockMinutes={autoLockMinutes}
        onChangeAutoLockMinutes={handleChangeAutoLockMinutes}
        onToggleBiometrics={handleToggleBiometrics}
        onPersistEncryptedBundle={handlePersistEncryptedBundle}
        onLockNow={handleLockNow}
        onReturnToIntroGate={handleReturnToIntroGate}
        onSetupOrChangePin={handleSetupOrChangePinInWorkspace}
        onDisableVaultEncryption={handleDisableVaultEncryptionInWorkspace}
      />
      <OfflineStatusBanner />
    </>
  );
}
