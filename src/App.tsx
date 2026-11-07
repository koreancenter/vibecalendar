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
import { ApiSettingsModal } from './components/ApiSettingsModal';
import { ExternalSyncHubModal } from './components/sync/ExternalSyncHubModal';
import { OutboundSyncConfirmModal } from './components/sync/OutboundSyncConfirmModal';
import { NotificationSettingsModal } from './components/notifications/NotificationSettingsModal';
import { CollabHubModal } from './components/collab/CollabHubModal';
import { LiveCollabRoomView } from './components/collab/LiveCollabRoomView';
import { SharePassCollaborativeWorkspace } from './components/collab/SharePassCollaborativeWorkspace';
import { createE2eeSharePassWorkspace } from './services/sharePassWorkspaceClient';
import { purgeAllNotificationIdbData } from './services/notifications/notificationIdb';
import { subscribeCloudKeyUnauthorized } from './utils/cloudApiKeyStorage';
import { useToast } from './hooks/useToast';
import { useCalendarEvents, VaultEventsSyncConfig } from './hooks/useCalendarEvents';
import {
  useExternalCalendarSync,
  VaultSyncStateConfig,
} from './hooks/useExternalCalendarSync';
import { EventHistoryProvider } from './hooks/useEventHistory';
import { useProjects, VaultProjectsSyncConfig } from './hooks/useProjects';
import {
  CalendarEventViewModelsProvider,
  useCalendarEventViewModels,
} from './hooks/useCalendarEventViewModels';
import { useTimeZonePreferences } from './hooks/useTimeZonePreferences';
import {
  useEventReminders,
  VaultNotificationPrefsConfig,
} from './hooks/useEventReminders';
import {
  persistCollabProfile,
  readOrCreateCollabProfile,
  readPlaintextSavedRooms,
  useCollabWorkspace,
  VaultCollabRoomsConfig,
} from './hooks/useCollabWorkspace';
import { usePWAInstall } from './hooks/usePWAInstall';
import { LUXURY_PROJECT_COLORS } from './constants/projects';
import {
  CalendarEventItem,
  CalendarViewMode,
  NotificationEnginePreferences,
  ProjectItem,
  SavedCollabRoomItem,
  VaultExternalSyncState,
} from './types';
import { addDays } from './shared/dateUtils';
import {
  parseOccurrenceIdentity,
  RECURRENCE_OCCURRENCE_SEP,
  resolveMasterEventId,
} from './shared/recurrenceUtils';
import { hasEventConflict, timeToMinutes } from './shared/scheduleUtils';
import { CollabProposalSlot, CollabRoomSnapshot } from './shared/collabSchema';
import { CollaborativeSharePassView } from './shared/yjsCollabProtocol';
import {
  extractCollabInviteFromLocation,
  ParsedCollabUrlInvite,
} from './utils/collabCrypto';
import {
  extractE2eeSharePassFromLocation,
  ParsedE2eeSharePassInvite,
} from './utils/yjsE2eeCrypto';
import {
  buildProjectSharePayload,
  buildSingleEventSharePayload,
  decodeSharePayload,
  extractShareTokenFromLocation,
  SharedPassPayload,
  SharedProposedSlot,
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

type PendingCollabAction =
  | {
      kind: 'save_only';
      invite: ParsedCollabUrlInvite;
    }
  | {
      kind: 'import_proposal';
      invite: ParsedCollabUrlInvite;
      room: CollabRoomSnapshot;
      chosenSlot: CollabProposalSlot;
    }
  | {
      kind: 'import_runsheet';
      invite: ParsedCollabUrlInvite;
      room: CollabRoomSnapshot;
    }
  | {
      kind: 'save_sharepass_crdt';
      invite: ParsedE2eeSharePassInvite;
    }
  | {
      kind: 'sync_sharepass_crdt';
      invite: ParsedE2eeSharePassInvite;
      view: CollaborativeSharePassView;
    };

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
  pendingCollabAction?: PendingCollabAction | null;
  onConsumePendingCollabAction?: () => void;
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
  pendingCollabAction,
  onConsumePendingCollabAction,
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
          syncState: bootstrapBundle?.syncState,
          notificationPrefs: bootstrapBundle?.notificationPrefs,
          collabRooms: bootstrapBundle?.collabRooms,
        }
      : null
  );

  const handleEncryptedProjectsChange = useCallback(
    (nextProjects: ProjectItem[], nextSelectedIds: string[]) => {
      const nextBundle: VaultPlaintextBundle = {
        events: latestBundleRef.current?.events ?? [],
        projects: nextProjects,
        selectedProjectIds: nextSelectedIds,
        syncState: latestBundleRef.current?.syncState,
        notificationPrefs: latestBundleRef.current?.notificationPrefs,
        collabRooms: latestBundleRef.current?.collabRooms,
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
        syncState: latestBundleRef.current?.syncState,
        notificationPrefs: latestBundleRef.current?.notificationPrefs,
        collabRooms: latestBundleRef.current?.collabRooms,
      };
      latestBundleRef.current = nextBundle;
      onPersistEncryptedBundle(nextBundle);
    },
    [onPersistEncryptedBundle]
  );

  const handleEncryptedSyncStateChange = useCallback(
    (nextSyncState: VaultExternalSyncState) => {
      const nextBundle: VaultPlaintextBundle = {
        events: latestBundleRef.current?.events ?? [],
        projects: latestBundleRef.current?.projects ?? [],
        selectedProjectIds: latestBundleRef.current?.selectedProjectIds ?? [],
        syncState: nextSyncState,
        notificationPrefs: latestBundleRef.current?.notificationPrefs,
        collabRooms: latestBundleRef.current?.collabRooms,
      };
      latestBundleRef.current = nextBundle;
      onPersistEncryptedBundle(nextBundle);
    },
    [onPersistEncryptedBundle]
  );

  const handleEncryptedNotificationPrefsChange = useCallback(
    (nextNotificationPrefs: NotificationEnginePreferences) => {
      const nextBundle: VaultPlaintextBundle = {
        events: latestBundleRef.current?.events ?? [],
        projects: latestBundleRef.current?.projects ?? [],
        selectedProjectIds: latestBundleRef.current?.selectedProjectIds ?? [],
        syncState: latestBundleRef.current?.syncState,
        notificationPrefs: nextNotificationPrefs,
        collabRooms: latestBundleRef.current?.collabRooms,
      };
      latestBundleRef.current = nextBundle;
      onPersistEncryptedBundle(nextBundle);
    },
    [onPersistEncryptedBundle]
  );

  const handleEncryptedCollabRoomsChange = useCallback(
    (nextCollabRooms: SavedCollabRoomItem[]) => {
      const nextBundle: VaultPlaintextBundle = {
        events: latestBundleRef.current?.events ?? [],
        projects: latestBundleRef.current?.projects ?? [],
        selectedProjectIds: latestBundleRef.current?.selectedProjectIds ?? [],
        syncState: latestBundleRef.current?.syncState,
        notificationPrefs: latestBundleRef.current?.notificationPrefs,
        collabRooms: nextCollabRooms,
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

  const vaultSyncConfig = useMemo<VaultSyncStateConfig | undefined>(() => {
    if (!isVaultEncrypted) return undefined;
    const initialBundle = bootstrapReleased ? null : (getInitialVaultBundle?.() ?? null);
    return {
      isEncrypted: true,
      initialSyncState: initialBundle?.syncState,
      onEncryptedSyncStateChange: handleEncryptedSyncStateChange,
    };
  }, [
    bootstrapReleased,
    getInitialVaultBundle,
    handleEncryptedSyncStateChange,
    isVaultEncrypted,
  ]);

  const vaultNotificationPrefsConfig = useMemo<VaultNotificationPrefsConfig | undefined>(() => {
    if (!isVaultEncrypted) return undefined;
    const initialBundle = bootstrapReleased ? null : (getInitialVaultBundle?.() ?? null);
    return {
      isEncrypted: true,
      initialPrefs: initialBundle?.notificationPrefs,
      onEncryptedPrefsChange: handleEncryptedNotificationPrefsChange,
    };
  }, [
    bootstrapReleased,
    getInitialVaultBundle,
    handleEncryptedNotificationPrefsChange,
    isVaultEncrypted,
  ]);

  const vaultCollabRoomsConfig = useMemo<VaultCollabRoomsConfig | undefined>(() => {
    if (!isVaultEncrypted) return undefined;
    const initialBundle = bootstrapReleased ? null : (getInitialVaultBundle?.() ?? null);
    return {
      isEncrypted: true,
      initialRooms: initialBundle?.collabRooms,
      onEncryptedRoomsChange: handleEncryptedCollabRoomsChange,
    };
  }, [
    bootstrapReleased,
    getInitialVaultBundle,
    handleEncryptedCollabRoomsChange,
    isVaultEncrypted,
  ]);

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

  const onExternalSyncedEventDeletedRef = useRef<((ev: CalendarEventItem) => void) | null>(null);
  const handleBeforeDeleteEvent = useCallback((ev: CalendarEventItem) => {
    onExternalSyncedEventDeletedRef.current?.(ev);
  }, []);

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
    onBeforeDeleteEvent: handleBeforeDeleteEvent,
  });

  const externalSync = useExternalCalendarSync({
    events,
    viewerTimeZone: tzPrefs.viewerTimeZone,
    applyEventsWithHistory,
    showToast,
    vaultSyncConfig,
  });
  onExternalSyncedEventDeletedRef.current = externalSync.recordLocalSyncedDeletion;

  const handleFocusEventFromNotification = useCallback(
    (targetEventId: string, targetDate?: string) => {
      const { masterId, occurrenceDate } = parseOccurrenceIdentity(targetEventId);
      const found = events.find((e) => e.id === targetEventId || e.id === masterId);
      const effectiveDate =
        targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
          ? targetDate
          : occurrenceDate || found?.date;

      if (effectiveDate) {
        jumpToDate(effectiveDate);
      }
      if (found) {
        setSelectedEvent(found);
      }
    },
    [events, jumpToDate, setSelectedEvent]
  );

  const handleCompleteEventFromNotification = useCallback(
    (targetEventId: string) => {
      const { masterId, occurrenceDate } = parseOccurrenceIdentity(targetEventId);
      const master = events.find((e) => e.id === masterId);
      if (!master) return;

      if (master.recurrence) {
        const occDate = occurrenceDate || master.date;
        const completedSet = new Set(
          master.completedDates || (master.isCompleted ? [master.date] : [])
        );
        if (completedSet.has(occDate)) return;
      } else if (master.isCompleted) {
        return;
      }

      handleToggleComplete(targetEventId);
    },
    [events, handleToggleComplete]
  );

  const reminders = useEventReminders({
    events,
    viewerTimeZone: tzPrefs.viewerTimeZone,
    vaultPrefsConfig: vaultNotificationPrefsConfig,
    onInAppReminder: (msg) => showToast(msg),
    onFocusEvent: handleFocusEventFromNotification,
    onCompleteEvent: handleCompleteEventFromNotification,
    onExecuteBackgroundSync: async () => {
      if (externalSync.stats.accountCount > 0) {
        await externalSync.syncAccounts();
      }
    },
  });
  const { reminderLeadMinutes, setReminderLeadMinutes } = reminders;

  // 앱 종료 상태에서 시스템 알림 클릭으로 진입한 딥링크(?focusEvent=...&date=...) 처리
  const handledUrlDeepLinkRef = useRef(false);
  useEffect(() => {
    if (handledUrlDeepLinkRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const focusEventId = params.get('focusEvent');
    if (!focusEventId) return;

    const focusDate = params.get('date') || undefined;
    const { masterId } = parseOccurrenceIdentity(focusEventId);
    const matched = events.find((e) => e.id === focusEventId || e.id === masterId);
    if (!matched && events.length === 0) {
      return;
    }

    handledUrlDeepLinkRef.current = true;
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('focusEvent');
    cleanUrl.searchParams.delete('date');
    window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);

    handleFocusEventFromNotification(focusEventId, focusDate);
  }, [events, handleFocusEventFromNotification]);

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

  const collab = useCollabWorkspace(tzPrefs.viewerTimeZone, vaultCollabRoomsConfig);

  const handleApplyProposalToWorkspace = useCallback(
    (params: {
      room: CollabRoomSnapshot;
      chosenSlot: CollabProposalSlot;
      linkedEventId?: string;
    }) => {
      const { room, chosenSlot, linkedEventId } = params;
      const savedEntry = collab.savedRooms.find((r) => r.roomId === room.roomId);
      const effectiveLinkedId = linkedEventId || savedEntry?.linkedEventId;
      const matchedLocalEvent = effectiveLinkedId
        ? events.find((e) => e.id === effectiveLinkedId)
        : undefined;

      if (matchedLocalEvent) {
        handleUpdateEventFields(
          matchedLocalEvent.id,
          {
            date: chosenSlot.date,
            endDate: undefined,
            startTime: chosenSlot.startTime,
            endTime: chosenSlot.endTime,
            timeZone: chosenSlot.timeZone,
            isAllDay: false,
          },
          `협업 확정 시간대(${chosenSlot.date.slice(5)} ${chosenSlot.startTime})가 '${matchedLocalEvent.title}' 일정에 반영되었습니다.`
        );
        jumpToDate(chosenSlot.date);
        return;
      }

      const nowStamp = Date.now();
      const targetProjId =
        selectedProjectId && selectedProjectId !== 'all'
          ? selectedProjectId
          : selectedProjectIds.length === 1
          ? selectedProjectIds[0]
          : undefined;

      const createdEvent: CalendarEventItem = {
        id: `collab-evt-${nowStamp}-${Math.random().toString(36).slice(2, 6)}`,
        title: room.title,
        date: chosenSlot.date,
        startTime: chosenSlot.startTime,
        endTime: chosenSlot.endTime,
        timeZone: chosenSlot.timeZone,
        isAllDay: false,
        category: room.category || '업무',
        location: room.location,
        content: room.subtitle,
        projectId: targetProjId,
      };

      const prevEvents = events;
      const didRecord = applyEventsWithHistory((curr) => [...curr, createdEvent], {
        kind: 'import',
        label: `라이브 조율 확정 일정 '${createdEvent.title}' 반영`,
        detail: `${chosenSlot.date.slice(5)} ${chosenSlot.startTime}~${chosenSlot.endTime}`,
        targetEventId: createdEvent.id,
        targetEventTitle: createdEvent.title,
        focusDate: createdEvent.date,
      });

      collab.upsertSavedRoom({
        roomId: room.roomId,
        kind: 'proposal',
        localTitle: room.title,
        isE2ee: room.isE2ee,
        linkedEventId: createdEvent.id,
        createdAt: room.createdAt,
        lastOpenedAt: new Date().toISOString(),
      });

      setSelectedEvent(createdEvent);
      jumpToDate(createdEvent.date);
      showToast(
        `확정 일정 '${createdEvent.title}'(${chosenSlot.date.slice(5)} ${chosenSlot.startTime})이 내 캘린더에 등록되었습니다.`,
        () => {
          if (didRecord) {
            eventHistory.undoStep();
          } else {
            setEvents(prevEvents);
          }
        }
      );
    },
    [
      applyEventsWithHistory,
      collab,
      eventHistory,
      events,
      handleUpdateEventFields,
      jumpToDate,
      selectedProjectId,
      selectedProjectIds,
      setEvents,
      setSelectedEvent,
      showToast,
    ]
  );

  const handlePullRunsheetToWorkspace = useCallback(
    (params: { room: CollabRoomSnapshot; linkedProjectId?: string }) => {
      const { room, linkedProjectId } = params;
      if (room.events.length === 0) {
        showToast('공동 런시트에 반영할 일정 항목이 없습니다.');
        return;
      }

      const prevProjects = projects;
      const prevEvents = events;
      const prevSelectedIds = selectedProjectIds;
      const nowStamp = Date.now();

      const savedEntry = collab.savedRooms.find((r) => r.roomId === room.roomId);
      const effectiveProjId = linkedProjectId || savedEntry?.linkedProjectId;

      let targetProject =
        (effectiveProjId ? projects.find((p) => p.id === effectiveProjId) : undefined) ||
        projects.find(
          (p) => p.name.trim().toLowerCase() === room.title.trim().toLowerCase()
        );

      let createdNewProject = false;
      if (!targetProject) {
        const palette =
          LUXURY_PROJECT_COLORS[projects.length % LUXURY_PROJECT_COLORS.length];
        targetProject = {
          id: `proj-collab-${nowStamp}`,
          name: room.title,
          description: room.subtitle,
          color: palette.hex,
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        createdNewProject = true;
      }

      const finalProjId = targetProject.id;
      let updatedCount = 0;
      let addedCount = 0;

      const didRecord = applyEventsWithHistory(
        (curr) => {
          const nextList = [...curr];
          for (let idx = 0; idx < room.events.length; idx++) {
            const sharedEv = room.events[idx];
            const existingIndex = nextList.findIndex(
              (localEv) =>
                (sharedEv.sourceLocalEventId && localEv.id === sharedEv.sourceLocalEventId) ||
                localEv.id === sharedEv.id
            );

            if (existingIndex >= 0) {
              const prevLocal = nextList[existingIndex];
              nextList[existingIndex] = {
                ...prevLocal,
                title: sharedEv.title,
                date: sharedEv.date,
                endDate: sharedEv.endDate,
                startTime: sharedEv.startTime,
                endTime: sharedEv.endTime,
                timeZone: sharedEv.timeZone,
                isAllDay: sharedEv.isAllDay,
                category: sharedEv.category,
                location: sharedEv.location ?? prevLocal.location,
                content: sharedEv.content ?? prevLocal.content,
                isCompleted: sharedEv.isCompleted,
                checklist: sharedEv.checklist.map((c) => ({
                  id: c.id,
                  text: c.text,
                  done: c.done,
                })),
              };
              updatedCount += 1;
            } else {
              nextList.push({
                id:
                  sharedEv.sourceLocalEventId &&
                  !nextList.some((item) => item.id === sharedEv.sourceLocalEventId)
                    ? sharedEv.sourceLocalEventId
                    : `collab-run-${nowStamp}-${idx}`,
                title: sharedEv.title,
                date: sharedEv.date,
                endDate: sharedEv.endDate,
                startTime: sharedEv.startTime,
                endTime: sharedEv.endTime,
                timeZone: sharedEv.timeZone,
                isAllDay: sharedEv.isAllDay,
                category: sharedEv.category,
                location: sharedEv.location,
                content: sharedEv.content,
                projectId: finalProjId,
                isCompleted: sharedEv.isCompleted,
                checklist: sharedEv.checklist.map((c) => ({
                  id: c.id,
                  text: c.text,
                  done: c.done,
                })),
              });
              addedCount += 1;
            }
          }
          return nextList;
        },
        {
          kind: 'import',
          label: `라이브 공동 런시트 '${room.title}' 동기화`,
          detail: `갱신 ${updatedCount}건 · 신규 ${addedCount}건`,
          focusDate: room.events[0]?.date,
        }
      );

      if (createdNewProject) {
        setProjects((curr) => [...curr, targetProject!]);
      }

      collab.upsertSavedRoom({
        roomId: room.roomId,
        kind: 'runsheet',
        localTitle: room.title,
        isE2ee: room.isE2ee,
        linkedProjectId: finalProjId,
        createdAt: room.createdAt,
        lastOpenedAt: new Date().toISOString(),
      });

      setSelectedProjectId(finalProjId);
      if (room.events[0]?.date) {
        jumpToDate(room.events[0].date);
      }

      showToast(
        `공동 런시트 '${room.title}' 변경분(체크리스트·완료 상태)이 내 워크스페이스에 반영되었습니다.`,
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
    },
    [
      applyEventsWithHistory,
      collab,
      eventHistory,
      events,
      jumpToDate,
      projects,
      selectedProjectIds,
      setEvents,
      setProjects,
      setSelectedProjectId,
      setSelectedProjectIds,
      showToast,
    ]
  );

  const handleSyncYjsWorkspaceToLocalVault = useCallback(
    (params: {
      docId: string;
      view: CollaborativeSharePassView;
      linkedEventId?: string;
      linkedProjectId?: string;
      silent?: boolean;
    }) => {
      const { docId, view, linkedEventId, linkedProjectId, silent = false } = params;
      if (view.events.length === 0) {
        if (!silent) {
          showToast('공동편집 워크스페이스에 반영할 일정 항목이 없습니다.');
        }
        return;
      }

      const savedEntry = collab.savedRooms.find((r) => r.roomId === docId);
      const effectiveLinkedEventId = linkedEventId || savedEntry?.linkedEventId;
      const effectiveLinkedProjectId = linkedProjectId || savedEntry?.linkedProjectId;

      let resolvedProjectId: string | undefined = effectiveLinkedProjectId;
      let createdNewProject: ProjectItem | null = null;

      if (view.kind === 'project') {
        const matchedProj =
          (effectiveLinkedProjectId
            ? projects.find((p) => p.id === effectiveLinkedProjectId)
            : undefined) ||
          projects.find(
            (p) => p.name.trim().toLowerCase() === view.title.trim().toLowerCase()
          );

        if (matchedProj) {
          resolvedProjectId = matchedProj.id;
        } else {
          const deterministicProjId = `proj-sp-${docId}`;
          const alreadyCreated = projects.find((p) => p.id === deterministicProjId);
          if (alreadyCreated) {
            resolvedProjectId = alreadyCreated.id;
          } else {
            const palette =
              LUXURY_PROJECT_COLORS[projects.length % LUXURY_PROJECT_COLORS.length];
            createdNewProject = {
              id: deterministicProjId,
              name: view.title,
              code: view.projectCode,
              clientOrOrg: view.clientOrOrg,
              description: view.subtitle || undefined,
              startDate: view.startDate,
              endDate: view.endDate,
              color: palette.hex,
              status: 'active',
              createdAt: new Date().toISOString(),
            };
            resolvedProjectId = createdNewProject.id;
          }
        }
      } else if (!resolvedProjectId) {
        resolvedProjectId =
          selectedProjectId && selectedProjectId !== 'all'
            ? selectedProjectId
            : selectedProjectIds.length === 1
            ? selectedProjectIds[0]
            : undefined;
      }

      const reconcileEventsList = (
        curr: CalendarEventItem[]
      ): { nextList: CalendarEventItem[]; updatedCount: number; addedCount: number } => {
        let updatedCount = 0;
        let addedCount = 0;
        let mutated = false;
        const nextList = [...curr];

        for (let idx = 0; idx < view.events.length; idx++) {
          const sharedEv = view.events[idx];
          const deterministicId = `sp-sync-${docId}-${sharedEv.id}`;
          const existingIndex = nextList.findIndex(
            (localEv) =>
              (idx === 0 && effectiveLinkedEventId && localEv.id === effectiveLinkedEventId) ||
              (sharedEv.sourceLocalEventId && localEv.id === sharedEv.sourceLocalEventId) ||
              localEv.id === deterministicId ||
              localEv.id === sharedEv.id
          );

          const nextChecklist = sharedEv.checklist.map((c) => ({
            id: c.id,
            text: c.text,
            done: c.done,
          }));

          if (existingIndex >= 0) {
            const prevLocal = nextList[existingIndex];
            const prevChkJson = JSON.stringify(prevLocal.checklist || []);
            const nextChkJson = JSON.stringify(nextChecklist);
            const nextLoc = sharedEv.location || prevLocal.location;
            const nextAddr = sharedEv.locationAddress || prevLocal.locationAddress;
            const nextContent =
              sharedEv.content !== undefined && sharedEv.content !== ''
                ? sharedEv.content
                : prevLocal.content;

            const hasDiff =
              prevLocal.title !== sharedEv.title ||
              prevLocal.date !== sharedEv.date ||
              (prevLocal.endDate || undefined) !== (sharedEv.endDate || undefined) ||
              prevLocal.startTime !== sharedEv.startTime ||
              prevLocal.endTime !== sharedEv.endTime ||
              prevLocal.timeZone !== sharedEv.timeZone ||
              Boolean(prevLocal.isAllDay) !== Boolean(sharedEv.isAllDay) ||
              prevLocal.category !== sharedEv.category ||
              prevLocal.location !== nextLoc ||
              prevLocal.locationAddress !== nextAddr ||
              prevLocal.content !== nextContent ||
              Boolean(prevLocal.isCompleted) !== Boolean(sharedEv.isCompleted) ||
              prevChkJson !== nextChkJson;

            if (hasDiff) {
              nextList[existingIndex] = {
                ...prevLocal,
                title: sharedEv.title,
                date: sharedEv.date,
                endDate: sharedEv.endDate,
                startTime: sharedEv.startTime,
                endTime: sharedEv.endTime,
                timeZone: sharedEv.timeZone,
                isAllDay: sharedEv.isAllDay,
                category: sharedEv.category,
                location: nextLoc,
                locationAddress: nextAddr,
                locationLat: sharedEv.locationLat ?? prevLocal.locationLat,
                locationLng: sharedEv.locationLng ?? prevLocal.locationLng,
                content: nextContent,
                isCompleted: sharedEv.isCompleted,
                checklist: nextChecklist,
              };
              updatedCount += 1;
              mutated = true;
            }
          } else {
            const preferredNewId =
              sharedEv.sourceLocalEventId &&
              !nextList.some((item) => item.id === sharedEv.sourceLocalEventId)
                ? sharedEv.sourceLocalEventId
                : deterministicId;
            nextList.push({
              id: preferredNewId,
              title: sharedEv.title,
              date: sharedEv.date,
              endDate: sharedEv.endDate,
              startTime: sharedEv.startTime,
              endTime: sharedEv.endTime,
              timeZone: sharedEv.timeZone,
              isAllDay: sharedEv.isAllDay,
              category: sharedEv.category,
              location: sharedEv.location,
              locationAddress: sharedEv.locationAddress,
              locationLat: sharedEv.locationLat,
              locationLng: sharedEv.locationLng,
              content: sharedEv.content || undefined,
              projectId: resolvedProjectId,
              isCompleted: sharedEv.isCompleted,
              checklist: nextChecklist,
            });
            addedCount += 1;
            mutated = true;
          }
        }

        return {
          nextList: mutated ? nextList : curr,
          updatedCount,
          addedCount,
        };
      };

      if (silent) {
        if (createdNewProject) {
          setProjects((curr) =>
            curr.some((p) => p.id === createdNewProject!.id)
              ? curr
              : [...curr, createdNewProject!]
          );
        }
        setEvents((curr) => reconcileEventsList(curr).nextList);
        return;
      }

      const prevProjects = projects;
      const prevEvents = events;
      const prevSelectedIds = selectedProjectIds;

      if (createdNewProject) {
        setProjects((curr) =>
          curr.some((p) => p.id === createdNewProject!.id)
            ? curr
            : [...curr, createdNewProject!]
        );
      }

      let summaryUpdated = 0;
      let summaryAdded = 0;
      const didRecord = applyEventsWithHistory(
        (curr) => {
          const res = reconcileEventsList(curr);
          summaryUpdated = res.updatedCount;
          summaryAdded = res.addedCount;
          return res.nextList;
        },
        {
          kind: 'import',
          label: `E2EE 공동편집 '${view.title}' 캘린더 반영`,
          detail: `갱신 ${summaryUpdated}건 · 신규 ${summaryAdded}건`,
          focusDate: view.events[0]?.date,
        }
      );

      if (savedEntry) {
        collab.upsertSavedRoom({
          ...savedEntry,
          localTitle: view.title || savedEntry.localTitle,
          linkedEventId: effectiveLinkedEventId,
          linkedProjectId:
            view.kind === 'project' ? resolvedProjectId : effectiveLinkedProjectId,
          lastOpenedAt: new Date().toISOString(),
        });
      }

      if (view.kind === 'project' && resolvedProjectId) {
        setSelectedProjectId(resolvedProjectId);
      }
      if (view.events[0]?.date) {
        jumpToDate(view.events[0].date);
      }

      showToast(
        `E2EE 공동편집 '${view.title}' 변경분이 내 암호화 워크스페이스에 반영되었습니다.`,
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
    },
    [
      applyEventsWithHistory,
      collab,
      eventHistory,
      events,
      jumpToDate,
      projects,
      selectedProjectId,
      selectedProjectIds,
      setEvents,
      setProjects,
      setSelectedProjectId,
      setSelectedProjectIds,
      showToast,
    ]
  );

  useEffect(() => {
    if (!pendingCollabAction) return;
    const action = pendingCollabAction;
    onConsumePendingCollabAction?.();

    const nowIso = new Date().toISOString();
    if (action.kind === 'save_only') {
      collab.upsertSavedRoom({
        roomId: action.invite.roomId,
        kind: 'proposal',
        localTitle: `협업 룸 (${action.invite.roomId.slice(-6)})`,
        isE2ee: Boolean(action.invite.roomKeyBase64Url),
        roomKeyBase64Url: action.invite.roomKeyBase64Url,
        createdAt: nowIso,
        lastOpenedAt: nowIso,
      });
      return;
    }

    if (action.kind === 'save_sharepass_crdt') {
      const existing = collab.savedRooms.find((r) => r.roomId === action.invite.docId);
      collab.upsertSavedRoom({
        roomId: action.invite.docId,
        kind: 'sharepass-crdt',
        shareKind: existing?.shareKind || 'event',
        localTitle:
          existing?.localTitle || `E2EE 공동편집 패스 (${action.invite.docId.slice(-6)})`,
        isE2ee: true,
        roomKeyBase64Url: action.invite.masterKeyB64u,
        linkedEventId: existing?.linkedEventId,
        linkedProjectId: existing?.linkedProjectId,
        autoSyncToVault: existing?.autoSyncToVault ?? false,
        createdAt: existing?.createdAt || nowIso,
        lastOpenedAt: nowIso,
      });
      return;
    }

    if (action.kind === 'sync_sharepass_crdt') {
      const existing = collab.savedRooms.find((r) => r.roomId === action.invite.docId);
      collab.upsertSavedRoom({
        roomId: action.invite.docId,
        kind: 'sharepass-crdt',
        shareKind: action.view.kind,
        localTitle: action.view.title || 'E2EE 공동편집 패스',
        isE2ee: true,
        roomKeyBase64Url: action.invite.masterKeyB64u,
        linkedEventId: existing?.linkedEventId,
        linkedProjectId: existing?.linkedProjectId,
        autoSyncToVault: existing?.autoSyncToVault ?? true,
        createdAt: existing?.createdAt || nowIso,
        lastOpenedAt: nowIso,
      });
      handleSyncYjsWorkspaceToLocalVault({
        docId: action.invite.docId,
        view: action.view,
        linkedEventId: existing?.linkedEventId,
        linkedProjectId: existing?.linkedProjectId,
        silent: false,
      });
      return;
    }

    if (action.kind === 'import_proposal') {
      collab.upsertSavedRoom({
        roomId: action.invite.roomId,
        kind: 'proposal',
        localTitle: action.room.title,
        isE2ee: action.room.isE2ee,
        roomKeyBase64Url: action.invite.roomKeyBase64Url,
        createdAt: action.room.createdAt,
        lastOpenedAt: nowIso,
      });
      handleApplyProposalToWorkspace({
        room: action.room,
        chosenSlot: action.chosenSlot,
      });
      return;
    }

    if (action.kind === 'import_runsheet') {
      collab.upsertSavedRoom({
        roomId: action.invite.roomId,
        kind: 'runsheet',
        localTitle: action.room.title,
        isE2ee: action.room.isE2ee,
        roomKeyBase64Url: action.invite.roomKeyBase64Url,
        createdAt: action.room.createdAt,
        lastOpenedAt: nowIso,
      });
      handlePullRunsheetToWorkspace({
        room: action.room,
      });
    }
  }, [
    collab,
    handleApplyProposalToWorkspace,
    handlePullRunsheetToWorkspace,
    handleSyncYjsWorkspaceToLocalVault,
    onConsumePendingCollabAction,
    pendingCollabAction,
  ]);

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
  const [isExternalSyncHubOpen, setIsExternalSyncHubOpen] = useState(false);
  const [isNotificationSettingsOpen, setIsNotificationSettingsOpen] = useState(false);
  const [isCollabHubOpen, setIsCollabHubOpen] = useState(false);
  const [activeCollabRoom, setActiveCollabRoom] = useState<{
    roomId: string;
    roomKeyBase64Url?: string;
    hostSecret?: string;
    linkedEventId?: string;
    linkedProjectId?: string;
  } | null>(null);
  const [activeYjsWorkspace, setActiveYjsWorkspace] = useState<{
    docId: string;
    masterKeyB64u?: string;
    linkedEventId?: string;
    linkedProjectId?: string;
  } | null>(null);
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

  const [apiSettingsModal, setApiSettingsModal] = useState<{
    isOpen: boolean;
    alertMessage: string | null;
  }>({
    isOpen: false,
    alertMessage: null,
  });

  useEffect(() => {
    return subscribeCloudKeyUnauthorized((evt) => {
      setApiSettingsModal({
        isOpen: true,
        alertMessage: evt.message,
      });
      showToast(evt.message);
    });
  }, [showToast]);

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
        syncState: externalSync.syncState,
        notificationPrefs: reminders.prefs,
        collabRooms: collab.savedRooms,
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

  const handleLaunchE2eeSharePass = useCallback(
    async (payload: SharedPassPayload, target: ShareModalTarget) => {
      try {
        const linkedEventId = target.kind === 'event' ? target.event.id : undefined;
        const linkedProjectId = target.kind === 'project' ? target.project.id : undefined;

        const { docId, masterKeyB64u, inviteUrl, record } =
          await createE2eeSharePassWorkspace({
            payload,
            host: {
              participantId: collab.profile.participantId,
              displayName: collab.profile.displayName,
              colorHex: collab.profile.colorHex,
              timeZone: tzPrefs.viewerTimeZone,
            },
            linkedEventId,
            linkedProjectId,
          });

        collab.upsertSavedRoom(record);
        try {
          await navigator.clipboard.writeText(inviteUrl);
        } catch {
          // ignore clipboard restrictions
        }

        setShareTarget(null);
        setIsCollabHubOpen(false);
        setActiveYjsWorkspace({
          docId,
          masterKeyB64u,
          linkedEventId,
          linkedProjectId,
        });
        showToast(
          '실시간 E2EE 공동편집 스페이스가 개설되었으며 영지식 암호화 링크(#sk)가 복사되었습니다.'
        );
      } catch (err: unknown) {
        showToast(
          err instanceof Error && err.message
            ? err.message
            : '실시간 E2EE 공동편집 스페이스 개설 중 오류가 발생했습니다.'
        );
      }
    },
    [collab, showToast, tzPrefs.viewerTimeZone]
  );

  const handleLaunchLiveCollabFromShareModal = useCallback(
    async (target: ShareModalTarget, proposedSlots: SharedProposedSlot[]) => {
      try {
        if (target.kind === 'event') {
          const ev = target.event;
          const startMin = timeToMinutes(ev.startTime || '10:00');
          const endMin = timeToMinutes(ev.endTime || '11:00');
          const durationMinutes = ev.isAllDay
            ? 60
            : Math.max(30, endMin > startMin ? endMin - startMin : 60);

          const { record, inviteUrl } = await collab.createProposalRoom({
            title: ev.title,
            subtitle: ev.content,
            location: ev.location,
            category: ev.category,
            durationMinutes,
            isE2ee: true,
            linkedEventId: ev.id,
            existingEvents: events,
            seedEvent: ev,
            customSlots:
              proposedSlots.length > 0
                ? proposedSlots.map((s) => ({
                    date: s.date,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    label: s.label,
                  }))
                : undefined,
          });

          try {
            await navigator.clipboard.writeText(inviteUrl);
          } catch {
            // ignore clipboard permission errors
          }

          setShareTarget(null);
          setActiveCollabRoom({
            roomId: record.roomId,
            roomKeyBase64Url: record.roomKeyBase64Url,
            hostSecret: record.hostSecret,
            linkedEventId: record.linkedEventId,
          });
          showToast('종단간 암호화(E2EE) 시간대 조율 룸이 개설되어 초대 링크가 복사되었습니다.');
          return;
        }

        const proj = target.project;
        const projEvents = events.filter((e) => e.projectId === proj.id);
        const { record, inviteUrl } = await collab.createRunsheetRoom({
          title: proj.name,
          subtitle: proj.description,
          project: proj,
          events: projEvents.length > 0 ? projEvents : filteredEvents,
          isE2ee: true,
        });

        try {
          await navigator.clipboard.writeText(inviteUrl);
        } catch {
          // ignore
        }

        setShareTarget(null);
        setActiveCollabRoom({
          roomId: record.roomId,
          roomKeyBase64Url: record.roomKeyBase64Url,
          hostSecret: record.hostSecret,
          linkedProjectId: record.linkedProjectId,
        });
        showToast('실시간 공동 런시트 룸이 개설되어 초대 링크가 복사되었습니다.');
      } catch (err: unknown) {
        showToast(
          err instanceof Error && err.message
            ? err.message
            : '실시간 협업 룸 개설 중 오류가 발생했습니다.'
        );
      }
    },
    [collab, events, filteredEvents, showToast]
  );

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
        isExternalSyncHubOpen ||
        isNotificationSettingsOpen ||
        isCollabHubOpen ||
        Boolean(activeCollabRoom) ||
        Boolean(activeYjsWorkspace) ||
        Boolean(externalSync.pendingOutboundPlan) ||
        Boolean(selectedEvent && viewMode !== 'agenda' && viewMode !== 'ops') ||
        isProjectModalOpen ||
        isProjectManagementOpen ||
        Boolean(shareTarget) ||
        Boolean(previewSharedPayload) ||
        legalDrawer.isOpen ||
        apiSettingsModal.isOpen ||
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
      } else if (lowerKey === 's') {
        e.preventDefault();
        setIsExternalSyncHubOpen(true);
      } else if (lowerKey === 'b') {
        e.preventDefault();
        setIsNotificationSettingsOpen(true);
      } else if (lowerKey === 'r') {
        e.preventDefault();
        setIsCollabHubOpen(true);
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [
    activeCollabRoom,
    activeYjsWorkspace,
    apiSettingsModal.isOpen,
    composerSeed,
    deleteModalState.isOpen,
    eventHistory,
    externalSync.pendingOutboundPlan,
    handleOpenCreateEvent,
    handleToday,
    isCollabHubOpen,
    isCommandPaletteOpen,
    isExternalSyncHubOpen,
    isNotificationSettingsOpen,
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
        onOpenExternalSync={() => setIsExternalSyncHubOpen(true)}
        syncedAccountCount={externalSync.stats.accountCount}
        syncConflictCount={externalSync.stats.conflictCount}
        isExternalSyncing={externalSync.isSyncing}
        onOpenNotificationSettings={() => setIsNotificationSettingsOpen(true)}
        isNotificationEnabled={reminders.prefs.enabled}
        scheduledAlertCount={reminders.upcomingAlerts.length}
        onOpenCollabHub={() => setIsCollabHubOpen(true)}
        collabRoomCount={collab.savedRooms.length}
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
                    syncState: externalSync.syncState,
                    notificationPrefs: reminders.prefs,
                    collabRooms: collab.savedRooms,
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
                  syncState: externalSync.syncState,
                  notificationPrefs: reminders.prefs,
                  collabRooms: collab.savedRooms,
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
              notificationSummaryLabel={reminders.summaryLabel}
              onOpenNotificationSettings={() => setIsNotificationSettingsOpen(true)}
              onOpenExternalSync={() => setIsExternalSyncHubOpen(true)}
              onOpenCollabHub={() => setIsCollabHubOpen(true)}
              onOpenApiSettings={() =>
                setApiSettingsModal({ isOpen: true, alertMessage: null })
              }
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
        notificationSummaryLabel={reminders.summaryLabel}
        onOpenNotificationSettings={() => setIsNotificationSettingsOpen(true)}
        canInstallPwa={!pwaInstall.isInstalled && pwaInstall.isInstallable}
        onInstallPwa={() => {
          void pwaInstall.install().then((accepted) => {
            if (accepted) {
              showToast('오프라인 현장 앱 설치가 완료되었습니다.');
            }
          });
        }}
        onOpenHistoryPopover={() => setHistoryOpenTick(Date.now())}
        onOpenExternalSync={() => setIsExternalSyncHubOpen(true)}
        onSyncAllExternal={() => {
          void externalSync.syncAccounts();
        }}
        syncedAccountCount={externalSync.stats.accountCount}
        onOpenCollabHub={() => setIsCollabHubOpen(true)}
        collabRoomCount={collab.savedRooms.length}
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

      {/* 6-2. 일정·프로젝트 브리핑 패스 공유 모달 (정적 스냅샷 + 실시간 Yjs E2EE 공동편집) */}
      <SharePassModal
        target={shareTarget}
        events={events}
        projects={projects}
        viewerTimeZone={tzPrefs.viewerTimeZone}
        onClose={() => setShareTarget(null)}
        onPreviewStandalone={(payload) => setPreviewSharedPayload(payload)}
        onLaunchE2eeSharePass={handleLaunchE2eeSharePass}
        onLaunchLiveCollab={handleLaunchLiveCollabFromShareModal}
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

      {/* 6-5. Cloud API 설정 모달 (저장된 키 401 만료·권한 오류 시 자동 오픈) */}
      <ApiSettingsModal
        isOpen={apiSettingsModal.isOpen}
        alertMessage={apiSettingsModal.alertMessage}
        onClose={() => setApiSettingsModal({ isOpen: false, alertMessage: null })}
        showToast={showToast}
      />

      {/* 6-6. 외부 캘린더 & CalDAV 통합 동기화 허브 모달 */}
      <ExternalSyncHubModal
        isOpen={isExternalSyncHubOpen}
        onClose={() => setIsExternalSyncHubOpen(false)}
        isVaultEncrypted={isVaultEncrypted}
        projects={projects}
        syncState={externalSync.syncState}
        googleConfigured={externalSync.stats.googleConfigured}
        hasGoogleSessionToken={externalSync.stats.hasGoogleSessionToken}
        microsoftStatus={externalSync.microsoftStatus}
        isSyncing={externalSync.isSyncing}
        syncingAccountId={externalSync.syncingAccountId}
        hasCalDavPasswordInMemory={externalSync.hasCalDavPasswordInMemory}
        onConnectGoogle={externalSync.connectGoogleAccount}
        onConnectMicrosoft={externalSync.connectMicrosoftAccount}
        onConnectCalDav={externalSync.connectCalDavAccount}
        onDisconnectAccount={externalSync.disconnectAccount}
        onUpdateCalendar={externalSync.updateSubscribedCalendar}
        onSetSessionCalDavPassword={externalSync.setSessionCalDavPassword}
        onSyncAll={() => externalSync.syncAccounts()}
        onSyncAccount={(accId) => externalSync.syncAccounts(accId)}
        onResolveConflict={externalSync.resolveSyncConflict}
      />

      {/* 6-7. 외부 클라우드 캘린더 원격 반영(생성·수정·삭제) 사전 승인 확인 모달 */}
      <OutboundSyncConfirmModal
        plan={externalSync.pendingOutboundPlan}
        isExecuting={externalSync.isExecutingOutbound}
        onConfirm={() => {
          void externalSync.confirmAndExecuteOutboundPlan();
        }}
        onCancel={externalSync.cancelOutboundPlan}
      />

      {/* 6-8. 고급 알림 엔진 · 커스텀 리드타임 · 백그라운드 푸시 설정 모달 */}
      <NotificationSettingsModal
        isOpen={isNotificationSettingsOpen}
        onClose={() => setIsNotificationSettingsOpen(false)}
        isVaultEncrypted={isVaultEncrypted}
        prefs={reminders.prefs}
        notificationPermission={reminders.notificationPermission}
        capabilities={reminders.capabilities}
        upcomingAlerts={reminders.upcomingAlerts}
        isWebPushSubscribed={reminders.isWebPushSubscribed}
        isPushBusy={reminders.isPushBusy}
        pendingOfflineSyncCount={reminders.pendingOfflineSyncCount}
        onUpdatePrefs={reminders.updateNotificationPrefs}
        onToggleDefaultLeadMinute={reminders.toggleDefaultLeadMinute}
        onAddCustomDefaultLeadMinute={reminders.addCustomDefaultLeadMinute}
        onRequestPermission={reminders.requestBrowserNotificationPermission}
        onEnableWebPush={reminders.enableWebPushSubscription}
        onDisableWebPush={reminders.disableWebPushSubscription}
        onSendTestAlert={reminders.sendTestBackgroundNotification}
        onSnoozeAlert={reminders.snoozeScheduledAlert}
        onDismissAlert={reminders.dismissScheduledAlert}
        onSelectScheduledEvent={(evId, evDate) => {
          handleFocusEventFromNotification(evId, evDate);
        }}
        showToast={showToast}
      />

      {/* 6-9. 실시간 다자간 협업 룸 허브 (E2EE SharePass CRDT · Proposals · 공동 런시트) */}
      <CollabHubModal
        isOpen={isCollabHubOpen}
        onClose={() => setIsCollabHubOpen(false)}
        events={events}
        projects={projects}
        selectedDate={selectedDate}
        selectedProjectId={selectedProjectId}
        profile={collab.profile}
        onUpdateDisplayName={collab.updateDisplayName}
        savedRooms={collab.savedRooms}
        isCreatingRoom={collab.isCreatingRoom}
        onOpenRoom={(rm) => {
          const existing = collab.savedRooms.find((s) => s.roomId === rm.roomId);
          const resolvedKind = rm.kind || existing?.kind || 'proposal';
          collab.upsertSavedRoom({
            roomId: rm.roomId,
            kind: resolvedKind,
            shareKind: existing?.shareKind,
            localTitle:
              existing?.localTitle || `협업 룸 (${rm.roomId.slice(-6)})`,
            isE2ee: Boolean(rm.roomKeyBase64Url || existing?.isE2ee),
            roomKeyBase64Url: rm.roomKeyBase64Url || existing?.roomKeyBase64Url,
            hostSecret: rm.hostSecret || existing?.hostSecret,
            linkedEventId: rm.linkedEventId || existing?.linkedEventId,
            linkedProjectId: rm.linkedProjectId || existing?.linkedProjectId,
            autoSyncToVault: existing?.autoSyncToVault,
            createdAt: existing?.createdAt || new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
          });
          setIsCollabHubOpen(false);
          if (resolvedKind === 'sharepass-crdt') {
            setActiveYjsWorkspace({
              docId: rm.roomId,
              masterKeyB64u: rm.roomKeyBase64Url || existing?.roomKeyBase64Url,
              linkedEventId: rm.linkedEventId || existing?.linkedEventId,
              linkedProjectId: rm.linkedProjectId || existing?.linkedProjectId,
            });
          } else {
            setActiveCollabRoom(rm);
          }
        }}
        onJoinRoomByInvite={(roomId, roomKeyBase64Url) => {
          const existing = collab.savedRooms.find((s) => s.roomId === roomId);
          const nowIso = new Date().toISOString();
          collab.upsertSavedRoom({
            roomId,
            kind: existing?.kind || 'proposal',
            localTitle: existing?.localTitle || `참여 협업 룸 (${roomId.slice(-6)})`,
            isE2ee: Boolean(roomKeyBase64Url || existing?.isE2ee),
            roomKeyBase64Url: roomKeyBase64Url || existing?.roomKeyBase64Url,
            hostSecret: existing?.hostSecret,
            linkedEventId: existing?.linkedEventId,
            linkedProjectId: existing?.linkedProjectId,
            createdAt: existing?.createdAt || nowIso,
            lastOpenedAt: nowIso,
          });
          setIsCollabHubOpen(false);
          setActiveCollabRoom({
            roomId,
            roomKeyBase64Url: roomKeyBase64Url || existing?.roomKeyBase64Url,
            hostSecret: existing?.hostSecret,
            linkedEventId: existing?.linkedEventId,
            linkedProjectId: existing?.linkedProjectId,
          });
        }}
        onJoinSharePassByInvite={(docId, masterKeyB64u) => {
          const existing = collab.savedRooms.find((s) => s.roomId === docId);
          const nowIso = new Date().toISOString();
          collab.upsertSavedRoom({
            roomId: docId,
            kind: 'sharepass-crdt',
            shareKind: existing?.shareKind || 'event',
            localTitle: existing?.localTitle || `E2EE 공동편집 (${docId.slice(-6)})`,
            isE2ee: true,
            roomKeyBase64Url: masterKeyB64u,
            linkedEventId: existing?.linkedEventId,
            linkedProjectId: existing?.linkedProjectId,
            autoSyncToVault: existing?.autoSyncToVault ?? false,
            createdAt: existing?.createdAt || nowIso,
            lastOpenedAt: nowIso,
          });
          setIsCollabHubOpen(false);
          setActiveYjsWorkspace({
            docId,
            masterKeyB64u,
            linkedEventId: existing?.linkedEventId,
            linkedProjectId: existing?.linkedProjectId,
          });
        }}
        onCreateSharePassWorkspace={async ({ scope, event, project }) => {
          if (scope === 'event' && event) {
            const projName = event.projectId
              ? projects.find((p) => p.id === event.projectId)?.name
              : undefined;
            const payload = buildSingleEventSharePayload({
              event,
              viewerTimeZone: tzPrefs.viewerTimeZone,
              projectName: projName,
              theme: 'obsidian',
              includeMemo: true,
              includeChecklist: true,
            });
            await handleLaunchE2eeSharePass(payload, { kind: 'event', event });
            return;
          }
          if (scope === 'project' && project) {
            const payload = buildProjectSharePayload({
              project,
              events,
              viewerTimeZone: tzPrefs.viewerTimeZone,
              theme: 'obsidian',
              includeMemo: true,
              includeCompleted: true,
            });
            await handleLaunchE2eeSharePass(payload, { kind: 'project', project });
          }
        }}
        onRemoveSavedRoom={collab.removeSavedRoom}
        onCreateProposalRoom={(params) =>
          collab.createProposalRoom({
            ...params,
            existingEvents: events,
            linkedEventId: params.seedEvent?.id,
          })
        }
        onCreateRunsheetRoom={(params) => collab.createRunsheetRoom(params)}
        showToast={showToast}
      />

      {/* 6-10. 실시간 라이브 협업 스튜디오 모달 (WebSocket + E2EE Proposals / Runsheet) */}
      {activeCollabRoom && (
        <LiveCollabRoomView
          mode="modal"
          roomId={activeCollabRoom.roomId}
          roomKeyBase64Url={activeCollabRoom.roomKeyBase64Url}
          hostSecret={activeCollabRoom.hostSecret}
          linkedEventId={activeCollabRoom.linkedEventId}
          linkedProjectId={activeCollabRoom.linkedProjectId}
          linkedProjectEvents={
            activeCollabRoom.linkedProjectId
              ? events.filter((e) => e.projectId === activeCollabRoom.linkedProjectId)
              : undefined
          }
          participantId={collab.profile.participantId}
          displayName={collab.profile.displayName}
          colorHex={collab.profile.colorHex}
          viewerTimeZone={tzPrefs.viewerTimeZone}
          onUpdateDisplayName={collab.updateDisplayName}
          onClose={() => setActiveCollabRoom(null)}
          onApplyProposalToWorkspace={handleApplyProposalToWorkspace}
          onPullRunsheetToWorkspace={handlePullRunsheetToWorkspace}
          showToast={showToast}
        />
      )}

      {/* 6-11. 실시간 E2EE 공동편집 SharePass 워크스페이스 모달 (Yjs CRDT + AES-256-GCM) */}
      {activeYjsWorkspace && (
        <SharePassCollaborativeWorkspace
          mode="modal"
          docId={activeYjsWorkspace.docId}
          masterKeyB64u={activeYjsWorkspace.masterKeyB64u}
          linkedEventId={activeYjsWorkspace.linkedEventId}
          linkedProjectId={activeYjsWorkspace.linkedProjectId}
          autoSyncToVault={
            collab.savedRooms.find((r) => r.roomId === activeYjsWorkspace.docId)
              ?.autoSyncToVault ?? false
          }
          onToggleAutoSyncToVault={(enabled) => {
            const existing = collab.savedRooms.find(
              (r) => r.roomId === activeYjsWorkspace.docId
            );
            if (existing) {
              collab.upsertSavedRoom({
                ...existing,
                autoSyncToVault: enabled,
                lastOpenedAt: new Date().toISOString(),
              });
            }
          }}
          participantId={collab.profile.participantId}
          displayName={collab.profile.displayName}
          colorHex={collab.profile.colorHex}
          viewerTimeZone={tzPrefs.viewerTimeZone}
          onUpdateDisplayName={collab.updateDisplayName}
          onClose={() => setActiveYjsWorkspace(null)}
          onSyncWorkspaceToLocalVault={handleSyncYjsWorkspaceToLocalVault}
          showToast={showToast}
        />
      )}

      {/* 7. 하단 알림 토스트 & 실행 취소 배너 */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[80] flex items-center gap-3 bg-[#1e222b] text-neutral-100 text-xs px-4 py-2.5 rounded-xl border border-white/10 shadow-2xl backdrop-blur-md">
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

interface StandaloneCollabScreenProps {
  invite: ParsedCollabUrlInvite;
  onExitToWorkspace: () => void;
  onImportProposal: (room: CollabRoomSnapshot, chosenSlot: CollabProposalSlot) => void;
  onImportRunsheet: (room: CollabRoomSnapshot) => void;
}

const StandaloneCollabScreen: React.FC<StandaloneCollabScreenProps> = ({
  invite,
  onExitToWorkspace,
  onImportProposal,
  onImportRunsheet,
}) => {
  const { toastMessage, showToast } = useToast();
  const [profile, setProfile] = useState(() => readOrCreateCollabProfile());
  const localHostRecord = useMemo(
    () => readPlaintextSavedRooms().find((r) => r.roomId === invite.roomId),
    [invite.roomId]
  );

  const handleUpdateDisplayName = useCallback((nextName: string) => {
    const clean = nextName.trim().slice(0, 40);
    if (!clean) return;
    setProfile((prev) => {
      const updated = { ...prev, displayName: clean };
      persistCollabProfile(updated);
      return updated;
    });
  }, []);

  return (
    <>
      <LiveCollabRoomView
        mode="standalone"
        roomId={invite.roomId}
        roomKeyBase64Url={invite.roomKeyBase64Url || localHostRecord?.roomKeyBase64Url}
        hostSecret={localHostRecord?.hostSecret}
        participantId={profile.participantId}
        displayName={profile.displayName}
        colorHex={profile.colorHex}
        onUpdateDisplayName={handleUpdateDisplayName}
        onClose={onExitToWorkspace}
        onApplyProposalToWorkspace={({ room, chosenSlot }) => onImportProposal(room, chosenSlot)}
        onPullRunsheetToWorkspace={({ room }) => onImportRunsheet(room)}
        showToast={showToast}
      />
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[80] flex items-center gap-3 bg-[#1e222b] text-neutral-100 text-xs px-4 py-2.5 rounded-xl border border-white/10 shadow-2xl backdrop-blur-md">
          <span>{toastMessage}</span>
        </div>
      )}
    </>
  );
};

interface StandaloneYjsSharePassScreenProps {
  invite: ParsedE2eeSharePassInvite;
  onExitToWorkspace: () => void;
  onImportWorkspaceView: (view: CollaborativeSharePassView) => void;
}

const StandaloneYjsSharePassScreen: React.FC<StandaloneYjsSharePassScreenProps> = ({
  invite,
  onExitToWorkspace,
  onImportWorkspaceView,
}) => {
  const { toastMessage, showToast } = useToast();
  const [profile, setProfile] = useState(() => readOrCreateCollabProfile());

  const handleUpdateDisplayName = useCallback((nextName: string) => {
    const clean = nextName.trim().slice(0, 40);
    if (!clean) return;
    setProfile((prev) => {
      const updated = { ...prev, displayName: clean };
      persistCollabProfile(updated);
      return updated;
    });
  }, []);

  return (
    <>
      <SharePassCollaborativeWorkspace
        mode="standalone"
        docId={invite.docId}
        masterKeyB64u={invite.masterKeyB64u}
        participantId={profile.participantId}
        displayName={profile.displayName}
        colorHex={profile.colorHex}
        onUpdateDisplayName={handleUpdateDisplayName}
        onClose={onExitToWorkspace}
        onSyncWorkspaceToLocalVault={({ view }) => onImportWorkspaceView(view)}
        showToast={showToast}
      />
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-[80] flex items-center gap-3 bg-[#1e222b] text-neutral-100 text-xs px-4 py-2.5 rounded-xl border border-white/10 shadow-2xl backdrop-blur-md">
          <span>{toastMessage}</span>
        </div>
      )}
    </>
  );
};

export default function App() {
  const [urlE2eeSharePass, setUrlE2eeSharePass] =
    useState<ParsedE2eeSharePassInvite | null>(() => extractE2eeSharePassFromLocation());
  const [urlCollabInvite, setUrlCollabInvite] = useState<ParsedCollabUrlInvite | null>(() =>
    extractCollabInviteFromLocation()
  );
  const [pendingCollabAction, setPendingCollabAction] = useState<PendingCollabAction | null>(
    null
  );
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

  // 실시간 E2EE 공동편집 SharePass(?spass=sp_...#sk=...) 및 협업 룸(?collab=rm_...#rk=...) 감지 — 볼트 잠금 해제 없이 즉시 협업 참여 보장
  useEffect(() => {
    const syncCollabFromLocation = () => {
      setUrlE2eeSharePass(extractE2eeSharePassFromLocation());
      setUrlCollabInvite(extractCollabInviteFromLocation());
    };
    window.addEventListener('popstate', syncCollabFromLocation);
    window.addEventListener('hashchange', syncCollabFromLocation);
    return () => {
      window.removeEventListener('popstate', syncCollabFromLocation);
      window.removeEventListener('hashchange', syncCollabFromLocation);
    };
  }, []);

  const clearE2eeSharePassUrlParams = useCallback(() => {
    if (typeof window !== 'undefined') {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('spass');
      if (cleanUrl.hash.includes('sk=') || cleanUrl.hash.includes('spass=')) {
        cleanUrl.hash = '';
      }
      window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    }
    setUrlE2eeSharePass(null);
  }, []);

  const handleExitUrlE2eeSharePassToWorkspace = useCallback(() => {
    const activeInvite = urlE2eeSharePass;
    clearE2eeSharePassUrlParams();
    if (activeInvite) {
      setPendingCollabAction({ kind: 'save_sharepass_crdt', invite: activeInvite });
    }
  }, [clearE2eeSharePassUrlParams, urlE2eeSharePass]);

  const handleImportFromStandaloneE2eeSharePass = useCallback(
    (view: CollaborativeSharePassView) => {
      const activeInvite = urlE2eeSharePass;
      clearE2eeSharePassUrlParams();
      if (activeInvite) {
        setPendingCollabAction({
          kind: 'sync_sharepass_crdt',
          invite: activeInvite,
          view,
        });
      }
      if (gateStateRef.current.mode === 'onboarding') {
        saveLegalConsent();
        setBrowseSessionActive(true);
        setGateState({
          mode: 'unlocked_browse',
          sessionId: Date.now(),
        });
      }
    },
    [clearE2eeSharePassUrlParams, urlE2eeSharePass]
  );

  const clearCollabUrlParams = useCallback(() => {
    if (typeof window !== 'undefined') {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('collab');
      if (cleanUrl.hash.includes('rk=') || cleanUrl.hash.includes('collab=')) {
        cleanUrl.hash = '';
      }
      window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    }
    setUrlCollabInvite(null);
  }, []);

  const handleExitUrlCollabToWorkspace = useCallback(() => {
    const activeInvite = urlCollabInvite;
    clearCollabUrlParams();
    if (activeInvite) {
      setPendingCollabAction({ kind: 'save_only', invite: activeInvite });
    }
  }, [clearCollabUrlParams, urlCollabInvite]);

  const handleImportProposalFromStandaloneCollab = useCallback(
    (room: CollabRoomSnapshot, chosenSlot: CollabProposalSlot) => {
      const activeInvite = urlCollabInvite || { roomId: room.roomId };
      clearCollabUrlParams();
      setPendingCollabAction({
        kind: 'import_proposal',
        invite: activeInvite,
        room,
        chosenSlot,
      });
      if (gateStateRef.current.mode === 'onboarding') {
        saveLegalConsent();
        setBrowseSessionActive(true);
        setGateState({
          mode: 'unlocked_browse',
          sessionId: Date.now(),
        });
      }
    },
    [clearCollabUrlParams, urlCollabInvite]
  );

  const handleImportRunsheetFromStandaloneCollab = useCallback(
    (room: CollabRoomSnapshot) => {
      const activeInvite = urlCollabInvite || { roomId: room.roomId };
      clearCollabUrlParams();
      setPendingCollabAction({
        kind: 'import_runsheet',
        invite: activeInvite,
        room,
      });
      if (gateStateRef.current.mode === 'onboarding') {
        saveLegalConsent();
        setBrowseSessionActive(true);
        setGateState({
          mode: 'unlocked_browse',
          sessionId: Date.now(),
        });
      }
    },
    [clearCollabUrlParams, urlCollabInvite]
  );

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

  const handleUpgradeUrlSharePassToLiveE2ee = useCallback(
    async (payload: SharedPassPayload) => {
      const profile = readOrCreateCollabProfile();
      const viewerZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
      const { docId, masterKeyB64u, inviteUrl } = await createE2eeSharePassWorkspace({
        payload,
        host: {
          participantId: profile.participantId,
          displayName: profile.displayName,
          colorHex: profile.colorHex,
          timeZone: viewerZone,
        },
      });

      try {
        await navigator.clipboard.writeText(inviteUrl);
      } catch {
        // ignore clipboard failure
      }

      if (typeof window !== 'undefined') {
        const nextUrl = new URL(inviteUrl);
        window.history.replaceState(
          {},
          '',
          nextUrl.pathname + nextUrl.search + nextUrl.hash
        );
      }
      setUrlSharedPayload(null);
      setUrlE2eeSharePass({ docId, masterKeyB64u });
    },
    []
  );

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
    void purgeAllNotificationIdbData();
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

  if (urlE2eeSharePass) {
    return (
      <>
        <StandaloneYjsSharePassScreen
          invite={urlE2eeSharePass}
          onExitToWorkspace={handleExitUrlE2eeSharePassToWorkspace}
          onImportWorkspaceView={handleImportFromStandaloneE2eeSharePass}
        />
        <OfflineStatusBanner />
      </>
    );
  }

  if (urlCollabInvite) {
    return (
      <>
        <StandaloneCollabScreen
          invite={urlCollabInvite}
          onExitToWorkspace={handleExitUrlCollabToWorkspace}
          onImportProposal={handleImportProposalFromStandaloneCollab}
          onImportRunsheet={handleImportRunsheetFromStandaloneCollab}
        />
        <OfflineStatusBanner />
      </>
    );
  }

  if (urlSharedPayload) {
    return (
      <>
        <SharedPassStandaloneView
          payload={urlSharedPayload}
          isPreviewMode={false}
          onImportToWorkspace={handleImportFromUrlSharePass}
          onUpgradeToLiveE2eeWorkspace={handleUpgradeUrlSharePassToLiveE2ee}
          onExit={handleExitUrlShareMode}
        />
        <OfflineStatusBanner />
      </>
    );
  }

  if (gateState.mode === 'onboarding' || gateState.mode === 'locked') {
    const hasPendingImportAction =
      Boolean(pendingSharedImport) ||
      Boolean(
        pendingCollabAction &&
          pendingCollabAction.kind !== 'save_only' &&
          pendingCollabAction.kind !== 'save_sharepass_crdt'
      );
    return (
      <>
        {hasPendingImportAction && gateState.mode === 'locked' && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-xl bg-[#13161f]/95 border border-white/[0.12] text-xs text-neutral-200 shadow-2xl backdrop-blur-md whitespace-nowrap">
            {pendingCollabAction
              ? '암호화 볼트 잠금을 해제하면 실시간 E2EE 공동편집 일정이 내 워크스페이스에 자동 반영됩니다.'
              : '암호화 볼트 잠금을 해제하면 공유 브리핑 패스가 내 워크스페이스에 자동 반영됩니다.'}
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
        pendingCollabAction={pendingCollabAction}
        onConsumePendingCollabAction={() => setPendingCollabAction(null)}
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
