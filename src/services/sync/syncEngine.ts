import {
  CalendarEventItem,
  CalendarSyncMode,
  ConnectedCalendarAccount,
  ExternalProviderType,
  PendingOutboundDeletion,
  SubscribedExternalCalendar,
  SyncConflictItem,
} from '../../types';
import { NormalizedRemoteEventPayload } from '../../shared/icsSyncCodec';

/**
 * Deterministic digest of sync-relevant event fields for 3-way merge comparison.
 * Local-only hybrid enrichments (e.g. projectId, isCompleted, completedDates) are
 * intentionally excluded from the base remote hash unless synced via description metadata.
 */
export function computeSyncableEventHash(ev: Pick<
  CalendarEventItem,
  | 'title'
  | 'date'
  | 'endDate'
  | 'startTime'
  | 'endTime'
  | 'timeZone'
  | 'isAllDay'
  | 'location'
  | 'locationAddress'
  | 'content'
  | 'recurrence'
  | 'excludedDates'
>): string {
  const canonical = JSON.stringify({
    t: (ev.title || '').trim(),
    d: ev.date,
    ed: ev.endDate || '',
    st: ev.isAllDay ? 'ALLDAY' : ev.startTime,
    et: ev.isAllDay ? 'ALLDAY' : ev.endTime,
    tz: ev.isAllDay ? '' : ev.timeZone || '',
    loc: (ev.location || '').trim(),
    addr: (ev.locationAddress || '').trim(),
    c: (ev.content || '').trim(),
    rec: ev.recurrence
      ? `${ev.recurrence.frequency}|${ev.recurrence.until || ''}|${ev.recurrence.count || ''}`
      : '',
    ex: (ev.excludedDates || []).slice().sort().join(','),
  });

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i++) {
    const ch = canonical.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
}

export function buildCalendarEventFromRemotePayload(params: {
  payload: NormalizedRemoteEventPayload;
  account: ConnectedCalendarAccount;
  calendar: SubscribedExternalCalendar;
  existingLocal?: CalendarEventItem;
  nowIso: string;
}): CalendarEventItem {
  const { payload, account, calendar, existingLocal, nowIso } = params;
  const isMasked = calendar.syncMode === 'read_only_masking';
  const readOnly = isMasked || Boolean(calendar.readOnlyRemote);

  const maskTitle = (calendar.maskLabel || '').trim() || `외부 일정 (${calendar.name})`;

  // In Read-only Masking Sync, strip ALL sensitive PII (title, description, location, checklist, geo)
  const effectiveTitle = isMasked ? maskTitle : payload.title;
  const effectiveContent = isMasked ? undefined : payload.content;
  const effectiveLocation = isMasked ? undefined : payload.location;
  const effectiveAddress = isMasked ? undefined : payload.locationAddress;
  const effectiveLat = isMasked ? undefined : payload.locationLat;
  const effectiveLng = isMasked ? undefined : payload.locationLng;

  // Hybrid preservation: keep local projectId, completion state, and local checklist if remote has none
  const preservedProjectId = existingLocal?.projectId ?? calendar.boundProjectId;
  const preservedCategory =
    isMasked
      ? calendar.defaultCategory || '기타'
      : payload.category || existingLocal?.category || calendar.defaultCategory || '업무';
  const preservedChecklist = isMasked
    ? undefined
    : payload.checklist && payload.checklist.length > 0
    ? payload.checklist
    : existingLocal?.checklist;

  const unmaskedEquivalentHash = computeSyncableEventHash({
    title: isMasked ? effectiveTitle : payload.title,
    date: payload.date,
    endDate: payload.endDate,
    startTime: payload.startTime,
    endTime: payload.endTime,
    timeZone: payload.timeZone,
    isAllDay: payload.isAllDay,
    location: effectiveLocation,
    locationAddress: effectiveAddress,
    content: effectiveContent,
    recurrence: payload.recurrence,
    excludedDates: payload.excludedDates,
  });

  return {
    id:
      existingLocal?.id ||
      `ext-${account.provider}-${calendar.id}-${payload.remoteUid.replace(/[^A-Za-z0-9_-]/g, '').slice(-28)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`,
    title: effectiveTitle,
    date: payload.date,
    endDate: payload.endDate,
    startTime: payload.startTime,
    endTime: payload.endTime,
    timeZone: payload.timeZone,
    isAllDay: payload.isAllDay,
    category: preservedCategory,
    projectId: preservedProjectId,
    location: effectiveLocation,
    locationAddress: effectiveAddress,
    locationLat: effectiveLat,
    locationLng: effectiveLng,
    content: effectiveContent,
    isCompleted: existingLocal?.isCompleted ?? false,
    completedDates: existingLocal?.completedDates,
    checklist: preservedChecklist,
    recurrence: payload.recurrence,
    excludedDates: payload.excludedDates,
    externalSync: {
      accountId: account.id,
      calendarId: calendar.id,
      calendarName: calendar.name,
      provider: account.provider,
      remoteUid: payload.remoteUid,
      remoteIcalUid: payload.remoteIcalUid,
      remoteEtag: payload.remoteEtag ?? existingLocal?.externalSync?.remoteEtag,
      remoteHref: payload.remoteHref ?? existingLocal?.externalSync?.remoteHref,
      syncMode: calendar.syncMode,
      isMasked,
      readOnly,
      lastSyncedAt: nowIso,
      baseSnapshotHash: unmaskedEquivalentHash,
    },
  };
}

export interface InboundReconcileResult {
  nextEvents: CalendarEventItem[];
  newConflicts: SyncConflictItem[];
  importedCount: number;
  updatedCount: number;
  deletedCount: number;
  skippedDuplicatesCount: number;
}

/**
 * Reconciles incoming remote delta payloads against local AES-256-GCM vault events
 * using deterministic 3-way merge (`baseSnapshotHash` vs `localCurrentHash` vs `remoteHash`).
 */
export function reconcileInboundCalendarDelta(params: {
  currentEvents: CalendarEventItem[];
  existingConflicts: SyncConflictItem[];
  account: ConnectedCalendarAccount;
  calendar: SubscribedExternalCalendar;
  upsertedPayloads: NormalizedRemoteEventPayload[];
  deletedHrefs?: string[];
  fullResetApplied?: boolean;
}): InboundReconcileResult {
  const {
    currentEvents,
    existingConflicts,
    account,
    calendar,
    upsertedPayloads,
    deletedHrefs = [],
  } = params;

  const nowIso = new Date().toISOString();
  let workingEvents = [...currentEvents];
  const newConflicts: SyncConflictItem[] = [];

  let importedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let skippedDuplicatesCount = 0;

  // Map existing events belonging to THIS subscribed calendar by remoteUid and remoteHref
  const localByRemoteUid = new Map<string, CalendarEventItem>();
  const localByHref = new Map<string, CalendarEventItem>();
  // Cross-provider iCalUID index to prevent duplicate imports across Google + Outlook + CalDAV
  const otherCalendarIcalUids = new Set<string>();

  for (const ev of workingEvents) {
    const sync = ev.externalSync;
    if (!sync) continue;
    if (sync.accountId === account.id && sync.calendarId === calendar.id) {
      localByRemoteUid.set(sync.remoteUid, ev);
      if (sync.remoteHref) {
        localByHref.set(sync.remoteHref, ev);
      }
    } else if (sync.remoteIcalUid) {
      otherCalendarIcalUids.add(sync.remoteIcalUid);
    }
  }

  // Handle CalDAV deleted href tombstones
  if (deletedHrefs.length > 0) {
    const deletedSet = new Set(deletedHrefs);
    const idsToRemove = new Set<string>();

    for (const href of deletedSet) {
      const matched = localByHref.get(href);
      if (!matched) continue;
      const localHash = computeSyncableEventHash(matched);
      const isLocallyDirty =
        calendar.syncMode === 'bidirectional_hybrid' &&
        matched.externalSync &&
        localHash !== matched.externalSync.baseSnapshotHash;

      if (!isLocallyDirty || calendar.conflictPolicy === 'prefer_remote') {
        idsToRemove.add(matched.id);
        deletedCount += 1;
      }
    }

    if (idsToRemove.size > 0) {
      workingEvents = workingEvents.filter((e) => !idsToRemove.has(e.id));
    }
  }

  const upsertedMapById = new Map<string, CalendarEventItem>();
  const newlyAdded: CalendarEventItem[] = [];
  const removedIds = new Set<string>();

  for (const payload of upsertedPayloads) {
    // Skip transparent/free availability events in Read-only Masking mode so "Free" reminders don't block slots
    if (calendar.syncMode === 'read_only_masking' && payload.showAsFree) {
      continue;
    }

    const existing = localByRemoteUid.get(payload.remoteUid);

    if (payload.status === 'cancelled') {
      if (existing) {
        const localHash = computeSyncableEventHash(existing);
        const isLocallyDirty =
          calendar.syncMode === 'bidirectional_hybrid' &&
          existing.externalSync &&
          localHash !== existing.externalSync.baseSnapshotHash;

        if (!isLocallyDirty || calendar.conflictPolicy === 'prefer_remote') {
          removedIds.add(existing.id);
          deletedCount += 1;
        }
      }
      continue;
    }

    if (!existing) {
      // Cross-provider iCalUID deduplication check
      if (payload.remoteIcalUid && otherCalendarIcalUids.has(payload.remoteIcalUid)) {
        skippedDuplicatesCount += 1;
        continue;
      }

      const created = buildCalendarEventFromRemotePayload({
        payload,
        account,
        calendar,
        nowIso,
      });
      newlyAdded.push(created);
      localByRemoteUid.set(payload.remoteUid, created);
      importedCount += 1;
      continue;
    }

    // Existing event found -> 3-way merge check
    const candidateRemote = buildCalendarEventFromRemotePayload({
      payload,
      account,
      calendar,
      existingLocal: existing,
      nowIso,
    });

    const baseHash = existing.externalSync?.baseSnapshotHash || '';
    const currentLocalHash = computeSyncableEventHash(existing);
    const incomingRemoteHash = candidateRemote.externalSync!.baseSnapshotHash;

    // If neither changed in substance, only refresh ETag/syncMode metadata
    if (currentLocalHash === incomingRemoteHash && existing.externalSync?.isMasked === candidateRemote.externalSync?.isMasked) {
      if (
        existing.externalSync?.remoteEtag !== candidateRemote.externalSync?.remoteEtag ||
        existing.externalSync?.syncMode !== candidateRemote.externalSync?.syncMode
      ) {
        upsertedMapById.set(existing.id, candidateRemote);
      }
      continue;
    }

    const isLocalDirty =
      calendar.syncMode === 'bidirectional_hybrid' &&
      Boolean(baseHash) &&
      currentLocalHash !== baseHash;
    const isRemoteChanged = !baseHash || incomingRemoteHash !== baseHash;

    if (!isLocalDirty && isRemoteChanged) {
      upsertedMapById.set(existing.id, candidateRemote);
      updatedCount += 1;
      continue;
    }

    if (isLocalDirty && !isRemoteChanged) {
      // Keep local unpushed modifications intact for outbound push phase
      continue;
    }

    // True 3-way conflict: BOTH local vault and remote cloud diverged from baseSnapshotHash
    if (calendar.conflictPolicy === 'prefer_remote' || calendar.syncMode === 'read_only_masking') {
      upsertedMapById.set(existing.id, candidateRemote);
      updatedCount += 1;
    } else if (calendar.conflictPolicy === 'prefer_local') {
      // Keep local event, update remoteEtag so next outbound push overwrites cleanly
      upsertedMapById.set(existing.id, {
        ...existing,
        externalSync: {
          ...existing.externalSync!,
          remoteEtag: candidateRemote.externalSync?.remoteEtag,
          remoteHref: candidateRemote.externalSync?.remoteHref,
        },
      });
    } else {
      // Manual review conflict
      const alreadyQueued = existingConflicts.some(
        (c) => c.localEventId === existing.id && c.remoteUid === payload.remoteUid
      );
      if (!alreadyQueued) {
        newConflicts.push({
          id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          accountId: account.id,
          calendarId: calendar.id,
          calendarName: calendar.name,
          provider: account.provider,
          localEventId: existing.id,
          remoteUid: payload.remoteUid,
          remoteEtag: payload.remoteEtag,
          remoteHref: payload.remoteHref,
          localSnapshot: existing,
          remoteSnapshot: candidateRemote,
          detectedAt: nowIso,
        });
      }
    }
  }

  workingEvents = workingEvents
    .filter((ev) => !removedIds.has(ev.id))
    .map((ev) => upsertedMapById.get(ev.id) ?? ev);

  if (newlyAdded.length > 0) {
    workingEvents = [...newlyAdded, ...workingEvents];
  }

  return {
    nextEvents: workingEvents,
    newConflicts,
    importedCount,
    updatedCount,
    deletedCount,
    skippedDuplicatesCount,
  };
}

export interface OutboundMutationPlanItem {
  id: string;
  op: 'create' | 'update' | 'delete';
  accountId: string;
  accountLabel: string;
  provider: ExternalProviderType;
  calendarId: string;
  remoteCalendarId: string;
  calendarName: string;
  localEventId?: string;
  remoteUid?: string;
  remoteEtag?: string;
  remoteHref?: string;
  eventTitle: string;
  eventDate: string;
  event?: CalendarEventItem;
  deletionRecordId?: string;
}

/**
 * Computes all pending outbound mutations for `bidirectional_hybrid` calendars.
 * These are NEVER executed silently — they are presented in OutboundSyncConfirmModal
 * for explicit user approval first.
 */
export function buildOutboundMutationPlan(params: {
  events: CalendarEventItem[];
  accounts: ConnectedCalendarAccount[];
  pendingDeletions: PendingOutboundDeletion[];
  conflicts: SyncConflictItem[];
  targetAccountId?: string;
}): OutboundMutationPlanItem[] {
  const { events, accounts, pendingDeletions, conflicts, targetAccountId } = params;
  const conflictEventIds = new Set(conflicts.map((c) => c.localEventId));
  const plan: OutboundMutationPlanItem[] = [];

  const activeAccounts = targetAccountId
    ? accounts.filter((a) => a.id === targetAccountId)
    : accounts;

  for (const account of activeAccounts) {
    for (const cal of account.calendars) {
      if (!cal.enabled || cal.syncMode !== 'bidirectional_hybrid' || cal.readOnlyRemote) {
        continue;
      }

      // 1. Locally deleted events awaiting remote deletion
      for (const del of pendingDeletions) {
        if (del.accountId === account.id && del.calendarId === cal.id) {
          plan.push({
            id: `out-del-${del.id}`,
            op: 'delete',
            accountId: account.id,
            accountLabel: account.accountEmail,
            provider: account.provider,
            calendarId: cal.id,
            remoteCalendarId: cal.remoteCalendarId,
            calendarName: cal.name,
            remoteUid: del.remoteUid,
            remoteEtag: del.remoteEtag,
            remoteHref: del.remoteHref,
            eventTitle: del.eventTitle,
            eventDate: del.eventDate,
            deletionRecordId: del.id,
          });
        }
      }

      // 2. Modified synced events + Newly created local events bound to this calendar's project
      for (const ev of events) {
        if (ev.recurrenceMasterId || ev.isSample) continue;
        if (conflictEventIds.has(ev.id)) continue;

        const sync = ev.externalSync;
        if (sync && sync.accountId === account.id && sync.calendarId === cal.id) {
          if (sync.readOnly || sync.isMasked) continue;
          const currentHash = computeSyncableEventHash(ev);
          if (currentHash !== sync.baseSnapshotHash) {
            plan.push({
              id: `out-upd-${ev.id}`,
              op: 'update',
              accountId: account.id,
              accountLabel: account.accountEmail,
              provider: account.provider,
              calendarId: cal.id,
              remoteCalendarId: cal.remoteCalendarId,
              calendarName: cal.name,
              localEventId: ev.id,
              remoteUid: sync.remoteUid,
              remoteEtag: sync.remoteEtag,
              remoteHref: sync.remoteHref,
              eventTitle: ev.title,
              eventDate: ev.date,
              event: ev,
            });
          }
          continue;
        }

        // Unsynced local event belonging to boundProjectId when pushLocalProjectEvents is enabled
        if (
          !sync &&
          cal.pushLocalProjectEvents &&
          cal.boundProjectId &&
          ev.projectId === cal.boundProjectId
        ) {
          plan.push({
            id: `out-crt-${cal.id}-${ev.id}`,
            op: 'create',
            accountId: account.id,
            accountLabel: account.accountEmail,
            provider: account.provider,
            calendarId: cal.id,
            remoteCalendarId: cal.remoteCalendarId,
            calendarName: cal.name,
            localEventId: ev.id,
            remoteUid: `vibe-${ev.id}@vibecalendar.local`,
            eventTitle: ev.title,
            eventDate: ev.date,
            event: ev,
          });
        }
      }
    }
  }

  return plan;
}

/**
 * Transitions existing local events when a user toggles a calendar's syncMode
 * (e.g. switching from bidirectional_hybrid -> read_only_masking immediately masks local copies).
 */
export function applySyncModeTransitionToEvents(
  events: CalendarEventItem[],
  accountId: string,
  calendarId: string,
  nextMode: CalendarSyncMode,
  maskLabel: string,
  calendarName: string
): CalendarEventItem[] {
  const effectiveMask = maskLabel.trim() || `외부 일정 (${calendarName})`;
  return events.map((ev) => {
    const sync = ev.externalSync;
    if (!sync || sync.accountId !== accountId || sync.calendarId !== calendarId) {
      return ev;
    }

    if (nextMode === 'read_only_masking') {
      const masked: CalendarEventItem = {
        ...ev,
        title: effectiveMask,
        content: undefined,
        location: undefined,
        locationAddress: undefined,
        locationLat: undefined,
        locationLng: undefined,
        checklist: undefined,
      };
      return {
        ...masked,
        externalSync: {
          ...sync,
          syncMode: 'read_only_masking',
          isMasked: true,
          readOnly: true,
          originalTitleSnapshot: sync.isMasked ? sync.originalTitleSnapshot : ev.title,
          baseSnapshotHash: computeSyncableEventHash(masked),
        },
      };
    }

    // Switching to bidirectional_hybrid unlocks editing and triggers fresh unmasked pull
    const restoredTitle = sync.originalTitleSnapshot || ev.title;
    const unlocked: CalendarEventItem = {
      ...ev,
      title: restoredTitle,
    };
    return {
      ...unlocked,
      externalSync: {
        ...sync,
        syncMode: 'bidirectional_hybrid',
        isMasked: false,
        readOnly: false,
        baseSnapshotHash: computeSyncableEventHash(unlocked),
      },
    };
  });
}
