import { useCallback, useEffect, useState } from 'react';
import { CalendarCategory, CalendarEventItem, ProjectItem, SavedCollabRoomItem } from '../types';
import { addDays } from '../shared/dateUtils';
import { calculateFreeTimeSlots, minutesToTime, timeToMinutes } from '../shared/scheduleUtils';
import {
  convertLocalSlotToEventZone,
  projectEventToViewerTimeZone,
  resolveEventTimeZone,
  toViewerProjectedEvent,
} from '../shared/timeZoneUtils';
import {
  CollabSharedEvent,
  CreateCollabRoomRequest,
  CreateCollabRoomResponse,
  pickDeterministicCollabColor,
} from '../shared/collabSchema';
import {
  buildCollabInviteUrl,
  encryptRoomCreationRequest,
  generateCollabRoomKeyBase64Url,
  importCollabRoomKey,
} from '../utils/collabCrypto';

const STORAGE_COLLAB_PROFILE_KEY = 'vibe_collab_profile_v1';
const STORAGE_COLLAB_ROOMS_KEY = 'vibe_collab_rooms_v1';

export interface LocalCollabProfile {
  participantId: string;
  displayName: string;
  colorHex: string;
}

export interface VaultCollabRoomsConfig {
  isEncrypted: boolean;
  initialRooms?: SavedCollabRoomItem[];
  onEncryptedRoomsChange: (rooms: SavedCollabRoomItem[]) => void;
}

export function readOrCreateCollabProfile(): LocalCollabProfile {
  if (typeof window === 'undefined') {
    return {
      participantId: 'p_server',
      displayName: '주최자',
      colorHex: '#818cf8',
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_COLLAB_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalCollabProfile>;
      if (parsed.participantId && parsed.displayName) {
        return {
          participantId: parsed.participantId,
          displayName: parsed.displayName.slice(0, 40),
          colorHex: parsed.colorHex || pickDeterministicCollabColor(parsed.participantId),
        };
      }
    }
  } catch {
    // ignore storage read error
  }

  const randomId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
      : `usr_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

  const created: LocalCollabProfile = {
    participantId: randomId,
    displayName: '참여자',
    colorHex: pickDeterministicCollabColor(randomId),
  };

  try {
    window.localStorage.setItem(STORAGE_COLLAB_PROFILE_KEY, JSON.stringify(created));
  } catch {
    // ignore
  }
  return created;
}

export function persistCollabProfile(profile: LocalCollabProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_COLLAB_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

export function readPlaintextSavedRooms(): SavedCollabRoomItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_COLLAB_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedCollabRoomItem =>
        Boolean(item && typeof item.roomId === 'string' && typeof item.localTitle === 'string')
    );
  } catch {
    return [];
  }
}

export function computeSmartProposalCandidateSlots(
  seedEvent: {
    id?: string;
    date: string;
    startTime: string;
    endTime: string;
    timeZone?: string;
    isAllDay?: boolean;
  },
  existingEvents: CalendarEventItem[],
  viewerTimeZone: string
): Array<{
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  label: string;
}> {
  const sourceTz = seedEvent.timeZone || viewerTimeZone;
  const startMin = timeToMinutes(seedEvent.startTime || '10:00');
  const endMin = timeToMinutes(seedEvent.endTime || '11:00');
  const duration = Math.max(30, endMin > startMin ? endMin - startMin : 60);

  const primaryStart = seedEvent.isAllDay ? '10:00' : seedEvent.startTime;
  const primaryEnd = seedEvent.isAllDay ? minutesToTime(600 + duration) : seedEvent.endTime;

  const slots: Array<{
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    timeZone: string;
    label: string;
  }> = [
    {
      id: 'slot_1',
      date: seedEvent.date,
      startTime: primaryStart,
      endTime: primaryEnd,
      timeZone: sourceTz,
      label: '1순위 제안',
    },
  ];

  const projectedSeed = projectEventToViewerTimeZone(
    {
      id: seedEvent.id || 'seed',
      title: 'seed',
      date: seedEvent.date,
      startTime: primaryStart,
      endTime: primaryEnd,
      timeZone: sourceTz,
      isAllDay: false,
      category: '업무',
    },
    viewerTimeZone
  );

  const projectedPool = existingEvents
    .filter((other) => other.id !== seedEvent.id && !other.isAllDay)
    .map((other) => toViewerProjectedEvent(other, viewerTimeZone));

  for (let dayOffset = 0; dayOffset <= 2 && slots.length < 3; dayOffset++) {
    const checkLocalDate =
      dayOffset === 0 ? projectedSeed.localDate : addDays(projectedSeed.localDate, dayOffset);
    const dayEvents = projectedPool.filter((other) => other.date === checkLocalDate);
    const gaps = calculateFreeTimeSlots(dayEvents, duration);

    for (const gap of gaps) {
      const gStart = timeToMinutes(gap.startTime);
      const gEnd = timeToMinutes(gap.endTime);
      for (
        let candStart = gStart;
        candStart + duration <= gEnd && slots.length < 3;
        candStart += 60
      ) {
        const candStartStr = minutesToTime(candStart);
        const candEndStr = minutesToTime(candStart + duration);
        const inSource = convertLocalSlotToEventZone(
          checkLocalDate,
          candStartStr,
          candEndStr,
          viewerTimeZone,
          sourceTz
        );
        const duplicate = slots.some(
          (s) =>
            s.date === inSource.date &&
            s.startTime === inSource.startTime &&
            s.endTime === inSource.endTime
        );
        if (!duplicate) {
          slots.push({
            id: `slot_${slots.length + 1}`,
            date: inSource.date,
            startTime: inSource.startTime,
            endTime: inSource.endTime,
            timeZone: sourceTz,
            label: dayOffset === 0 ? '당일 가용 대안' : `${dayOffset}일 후 대안`,
          });
        }
      }
    }
  }

  return slots;
}

export function useCollabWorkspace(
  viewerTimeZone: string,
  vaultConfig?: VaultCollabRoomsConfig
) {
  const [profile, setProfile] = useState<LocalCollabProfile>(() => readOrCreateCollabProfile());
  const [savedRooms, setSavedRooms] = useState<SavedCollabRoomItem[]>(() => {
    if (vaultConfig?.isEncrypted) {
      return vaultConfig.initialRooms ?? [];
    }
    return readPlaintextSavedRooms();
  });
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  useEffect(() => {
    if (vaultConfig?.isEncrypted) {
      vaultConfig.onEncryptedRoomsChange(savedRooms);
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_COLLAB_ROOMS_KEY, JSON.stringify(savedRooms));
    } catch {
      // ignore storage quota errors
    }
  }, [savedRooms, vaultConfig]);

  const updateDisplayName = useCallback((nextName: string) => {
    const clean = nextName.trim().slice(0, 40);
    if (!clean) return;
    setProfile((prev) => {
      const updated = { ...prev, displayName: clean };
      try {
        window.localStorage.setItem(STORAGE_COLLAB_PROFILE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const upsertSavedRoom = useCallback((record: SavedCollabRoomItem) => {
    setSavedRooms((curr) => {
      const existing = curr.find((r) => r.roomId === record.roomId);
      const merged: SavedCollabRoomItem = existing
        ? {
            ...existing,
            ...record,
            hostSecret: record.hostSecret || existing.hostSecret,
            roomKeyBase64Url: record.roomKeyBase64Url || existing.roomKeyBase64Url,
            linkedEventId: record.linkedEventId || existing.linkedEventId,
            linkedProjectId: record.linkedProjectId || existing.linkedProjectId,
          }
        : record;
      return [merged, ...curr.filter((r) => r.roomId !== record.roomId)].slice(0, 40);
    });
  }, []);

  const removeSavedRoom = useCallback((roomId: string) => {
    setSavedRooms((curr) => curr.filter((r) => r.roomId !== roomId));
  }, []);

  const createProposalRoom = useCallback(
    async (params: {
      title: string;
      subtitle?: string;
      location?: string;
      category?: CalendarCategory;
      sourceTimeZone?: string;
      durationMinutes?: number;
      isE2ee?: boolean;
      linkedEventId?: string;
      existingEvents: CalendarEventItem[];
      seedEvent?: CalendarEventItem;
      customSlots?: Array<{
        date: string;
        startTime: string;
        endTime: string;
        timeZone?: string;
        label?: string;
      }>;
    }): Promise<{ record: SavedCollabRoomItem; inviteUrl: string }> => {
      setIsCreatingRoom(true);
      try {
        const useE2ee = params.isE2ee ?? true;
        const roomKeyBase64Url = useE2ee ? generateCollabRoomKeyBase64Url() : undefined;
        const cryptoKey = roomKeyBase64Url ? await importCollabRoomKey(roomKeyBase64Url) : null;

        const effectiveSourceTz =
          params.sourceTimeZone ||
          (params.seedEvent ? resolveEventTimeZone(params.seedEvent, viewerTimeZone) : viewerTimeZone);

        const rawSlots =
          params.customSlots && params.customSlots.length > 0
            ? params.customSlots.map((s, idx) => ({
                id: `slot_${idx + 1}`,
                date: s.date,
                startTime: s.startTime,
                endTime: s.endTime,
                timeZone: s.timeZone || effectiveSourceTz,
                label: s.label,
                createdByName: profile.displayName,
              }))
            : computeSmartProposalCandidateSlots(
                params.seedEvent || {
                  date: new Date().toISOString().slice(0, 10),
                  startTime: '10:00',
                  endTime: '11:00',
                  timeZone: effectiveSourceTz,
                },
                params.existingEvents,
                viewerTimeZone
              ).map((s) => ({
                ...s,
                createdByName: profile.displayName,
              }));

        const plainRequest: CreateCollabRoomRequest = {
          kind: 'proposal',
          isE2ee: Boolean(useE2ee && cryptoKey),
          hostDisplayName: profile.displayName,
          title: params.title.trim(),
          subtitle: params.subtitle?.trim() || undefined,
          location: params.location?.trim() || undefined,
          sourceTimeZone: effectiveSourceTz,
          durationMinutes: params.durationMinutes || 60,
          category: params.category || params.seedEvent?.category || '업무',
          proposedSlots: rawSlots,
        };

        const wireRequest = await encryptRoomCreationRequest(plainRequest, cryptoKey);
        const res = await fetch('/api/collab/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wireRequest),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || '시간대 조율 룸 생성에 실패했습니다.');
        }

        const data = (await res.json()) as CreateCollabRoomResponse;
        const nowIso = new Date().toISOString();
        const record: SavedCollabRoomItem = {
          roomId: data.room.roomId,
          kind: 'proposal',
          localTitle: params.title.trim(),
          isE2ee: plainRequest.isE2ee,
          roomKeyBase64Url: plainRequest.isE2ee ? roomKeyBase64Url : undefined,
          hostSecret: data.hostSecret,
          linkedEventId: params.linkedEventId || params.seedEvent?.id,
          createdAt: nowIso,
          lastOpenedAt: nowIso,
        };

        upsertSavedRoom(record);
        const inviteUrl = buildCollabInviteUrl(record.roomId, record.roomKeyBase64Url);
        return { record, inviteUrl };
      } finally {
        setIsCreatingRoom(false);
      }
    },
    [profile.displayName, upsertSavedRoom, viewerTimeZone]
  );

  const createRunsheetRoom = useCallback(
    async (params: {
      title: string;
      subtitle?: string;
      project?: ProjectItem;
      events: CalendarEventItem[];
      isE2ee?: boolean;
    }): Promise<{ record: SavedCollabRoomItem; inviteUrl: string }> => {
      setIsCreatingRoom(true);
      try {
        const useE2ee = params.isE2ee ?? true;
        const roomKeyBase64Url = useE2ee ? generateCollabRoomKeyBase64Url() : undefined;
        const cryptoKey = roomKeyBase64Url ? await importCollabRoomKey(roomKeyBase64Url) : null;
        const nowIso = new Date().toISOString();

        const sharedEvents: CollabSharedEvent[] = params.events
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
          .slice(0, 80)
          .map((ev) => ({
            id: `cevt_${ev.id}`,
            sourceLocalEventId: ev.id,
            title: ev.title,
            date: ev.date,
            endDate: ev.endDate,
            startTime: ev.startTime,
            endTime: ev.endTime,
            timeZone: resolveEventTimeZone(ev, viewerTimeZone),
            isAllDay: ev.isAllDay,
            category: ev.category,
            location: ev.location,
            content: ev.content,
            isCompleted: Boolean(ev.isCompleted),
            checklist: (ev.checklist || []).map((c) => ({
              id: c.id,
              text: c.text,
              done: c.done,
              updatedAt: nowIso,
            })),
            updatedAt: nowIso,
          }));

        const plainRequest: CreateCollabRoomRequest = {
          kind: 'runsheet',
          isE2ee: Boolean(useE2ee && cryptoKey),
          hostDisplayName: profile.displayName,
          title: params.title.trim(),
          subtitle: params.subtitle?.trim() || params.project?.description || undefined,
          sourceTimeZone: viewerTimeZone,
          durationMinutes: 60,
          category: '행사·세미나',
          events: sharedEvents,
        };

        const wireRequest = await encryptRoomCreationRequest(plainRequest, cryptoKey);
        const res = await fetch('/api/collab/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wireRequest),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || '공동 런시트 룸 생성에 실패했습니다.');
        }

        const data = (await res.json()) as CreateCollabRoomResponse;
        const record: SavedCollabRoomItem = {
          roomId: data.room.roomId,
          kind: 'runsheet',
          localTitle: params.title.trim(),
          isE2ee: plainRequest.isE2ee,
          roomKeyBase64Url: plainRequest.isE2ee ? roomKeyBase64Url : undefined,
          hostSecret: data.hostSecret,
          linkedProjectId: params.project?.id,
          createdAt: nowIso,
          lastOpenedAt: nowIso,
        };

        upsertSavedRoom(record);
        const inviteUrl = buildCollabInviteUrl(record.roomId, record.roomKeyBase64Url);
        return { record, inviteUrl };
      } finally {
        setIsCreatingRoom(false);
      }
    },
    [profile.displayName, upsertSavedRoom, viewerTimeZone]
  );

  return {
    profile,
    updateDisplayName,
    savedRooms,
    isCreatingRoom,
    upsertSavedRoom,
    removeSavedRoom,
    createProposalRoom,
    createRunsheetRoom,
  };
}
