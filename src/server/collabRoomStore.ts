import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CalendarCategory } from '../types';
import {
  CollabChecklistItem,
  CollabCommentItem,
  CollabParticipantPresence,
  CollabProposalSlot,
  CollabRoomKind,
  CollabRoomSnapshot,
  CollabSharedEvent,
  CollabSlotVote,
  CollabVoteStatus,
  CreateCollabRoomRequest,
  MAX_COLLAB_CHECKLIST_ITEMS,
  MAX_COLLAB_COMMENTS,
  MAX_COLLAB_EVENTS,
  MAX_COLLAB_SLOTS,
  pickDeterministicCollabColor,
} from '../shared/collabSchema';

interface StoredAuthoritativeRoom {
  snapshot: Omit<CollabRoomSnapshot, 'presence'>;
  hostSecretHash: string;
  processedMutationIds: string[];
}

const PERSIST_FILE_PATH = path.join(os.tmpdir(), 'vibe-collab-rooms-v1.json');
const MAX_STORED_ROOMS = 200;
const MAX_MUTATION_HISTORY = 400;

const VALID_CATEGORIES = new Set<CalendarCategory>([
  '업무',
  '방문·출장',
  '식사·모임',
  '개인',
  '행사·세미나',
  '기타',
]);

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

function clampString(val: unknown, maxLen: number, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  return val.trim().slice(0, maxLen);
}

function sanitizeDateString(val: unknown, fallback = '2026-11-04'): string {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    return val.trim();
  }
  return fallback;
}

function sanitizeTimeString(val: unknown, fallback = '10:00'): string {
  if (typeof val === 'string' && /^\d{2}:\d{2}$/.test(val.trim())) {
    return val.trim();
  }
  return fallback;
}

function sanitizeCategory(val: unknown): CalendarCategory {
  if (typeof val === 'string' && VALID_CATEGORIES.has(val as CalendarCategory)) {
    return val as CalendarCategory;
  }
  return '업무';
}

class CollabAuthoritativeStore {
  private rooms = new Map<string, StoredAuthoritativeRoom>();
  private livePresence = new Map<string, Map<string, CollabParticipantPresence>>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.loadFromDiskSync();
  }

  private loadFromDiskSync(): void {
    try {
      if (!fs.existsSync(PERSIST_FILE_PATH)) return;
      const raw = fs.readFileSync(PERSIST_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as StoredAuthoritativeRoom[];
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed.slice(0, MAX_STORED_ROOMS)) {
        if (entry?.snapshot?.roomId && typeof entry.hostSecretHash === 'string') {
          this.rooms.set(entry.snapshot.roomId, {
            snapshot: entry.snapshot,
            hostSecretHash: entry.hostSecretHash,
            processedMutationIds: Array.isArray(entry.processedMutationIds)
              ? entry.processedMutationIds.slice(-MAX_MUTATION_HISTORY)
              : [],
          });
        }
      }
    } catch {
      // ignore corrupted temp snapshot
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushToDisk();
    }, 350);
  }

  private flushToDisk(): void {
    try {
      if (this.rooms.size > MAX_STORED_ROOMS) {
        const sorted = Array.from(this.rooms.values()).sort((a, b) =>
          b.snapshot.updatedAt.localeCompare(a.snapshot.updatedAt)
        );
        this.rooms.clear();
        for (const item of sorted.slice(0, MAX_STORED_ROOMS)) {
          this.rooms.set(item.snapshot.roomId, item);
        }
      }
      const serialized = JSON.stringify(Array.from(this.rooms.values()));
      fs.writeFileSync(PERSIST_FILE_PATH, serialized, 'utf8');
    } catch {
      // ignore disk write issues in read-only sandboxes
    }
  }

  private recordMutationIfNew(room: StoredAuthoritativeRoom, mutationId: string): boolean {
    const cleanId = clampString(mutationId, 80);
    if (!cleanId) return true;
    if (room.processedMutationIds.includes(cleanId)) {
      return false;
    }
    room.processedMutationIds.push(cleanId);
    if (room.processedMutationIds.length > MAX_MUTATION_HISTORY) {
      room.processedMutationIds.splice(
        0,
        room.processedMutationIds.length - MAX_MUTATION_HISTORY
      );
    }
    return true;
  }

  public getPresenceList(roomId: string): CollabParticipantPresence[] {
    const map = this.livePresence.get(roomId);
    if (!map) return [];
    return Array.from(map.values()).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }

  public getRoomSnapshot(roomId: string): CollabRoomSnapshot | null {
    const stored = this.rooms.get(roomId);
    if (!stored) return null;
    return {
      ...stored.snapshot,
      presence: this.getPresenceList(roomId),
    };
  }

  public verifyHostSecret(roomId: string, candidateSecret?: string): boolean {
    if (!candidateSecret) return false;
    const stored = this.rooms.get(roomId);
    if (!stored) return false;
    const candidateHash = hashSecret(candidateSecret);
    try {
      return crypto.timingSafeEqual(
        Buffer.from(stored.hostSecretHash, 'hex'),
        Buffer.from(candidateHash, 'hex')
      );
    } catch {
      return false;
    }
  }

  public createRoom(input: CreateCollabRoomRequest): {
    room: CollabRoomSnapshot;
    hostSecret: string;
  } {
    const roomId = `rm_${crypto.randomBytes(7).toString('base64url')}`;
    const hostSecret = crypto.randomBytes(24).toString('base64url');
    const nowIso = new Date().toISOString();

    const kind: CollabRoomKind = input.kind === 'runsheet' ? 'runsheet' : 'proposal';
    const hostDisplayName = clampString(input.hostDisplayName, 40, '호스트');
    const sourceTimeZone = clampString(input.sourceTimeZone, 64, 'Asia/Seoul');
    const durationMinutes =
      typeof input.durationMinutes === 'number' && Number.isFinite(input.durationMinutes)
        ? Math.min(720, Math.max(15, Math.round(input.durationMinutes)))
        : 60;

    const proposedSlots: CollabProposalSlot[] = Array.isArray(input.proposedSlots)
      ? input.proposedSlots.slice(0, MAX_COLLAB_SLOTS).map((raw, idx) => ({
          id: clampString(raw.id, 64, `slot_${idx + 1}`),
          date: sanitizeDateString(raw.date),
          startTime: sanitizeTimeString(raw.startTime, '10:00'),
          endTime: sanitizeTimeString(raw.endTime, '11:00'),
          timeZone: clampString(raw.timeZone, 64, sourceTimeZone),
          label: raw.label ? clampString(raw.label, 512) : undefined,
          createdByName: clampString(raw.createdByName, 40, hostDisplayName),
          votes: {},
        }))
      : [];

    const events: CollabSharedEvent[] = Array.isArray(input.events)
      ? input.events.slice(0, MAX_COLLAB_EVENTS).map((ev, idx) => this.sanitizeSharedEvent(ev, idx, nowIso, sourceTimeZone))
      : [];

    const initialSystemComment: CollabCommentItem = {
      id: `sys_${Date.now()}`,
      targetId: 'general',
      authorId: 'system',
      authorName: '시스템',
      authorColor: '#94a3b8',
      authorTimeZone: sourceTimeZone,
      body:
        kind === 'proposal'
          ? `${hostDisplayName}님이 실시간 시간대 투표 조율 룸을 개설했습니다.`
          : `${hostDisplayName}님이 실시간 공동 런시트 룸을 개설했습니다.`,
      isSystem: true,
      createdAt: nowIso,
    };

    const snapshotBase: Omit<CollabRoomSnapshot, 'presence'> = {
      roomId,
      kind,
      isE2ee: Boolean(input.isE2ee),
      revision: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      hostDisplayName,
      title: clampString(input.title, 1024, '협업 일정 룸'),
      subtitle: input.subtitle ? clampString(input.subtitle, 1024) : undefined,
      location: input.location ? clampString(input.location, 1024) : undefined,
      sourceTimeZone,
      durationMinutes,
      category: sanitizeCategory(input.category),
      finalizedSlotId: null,
      proposedSlots,
      events,
      comments: [initialSystemComment],
    };

    this.rooms.set(roomId, {
      snapshot: snapshotBase,
      hostSecretHash: hashSecret(hostSecret),
      processedMutationIds: [],
    });
    this.schedulePersist();

    return {
      room: { ...snapshotBase, presence: [] },
      hostSecret,
    };
  }

  private sanitizeSharedEvent(
    ev: Partial<CollabSharedEvent>,
    fallbackIdx: number,
    nowIso: string,
    defaultTz: string
  ): CollabSharedEvent {
    const checklist: CollabChecklistItem[] = Array.isArray(ev.checklist)
      ? ev.checklist.slice(0, MAX_COLLAB_CHECKLIST_ITEMS).map((chk, cIdx) => ({
          id: clampString(chk?.id, 64, `chk_${fallbackIdx}_${cIdx}`),
          text: clampString(chk?.text, 1024, ''),
          done: Boolean(chk?.done),
          updatedByName: chk?.updatedByName ? clampString(chk.updatedByName, 40) : undefined,
          updatedAt: clampString(chk?.updatedAt, 40, nowIso),
        }))
      : [];

    return {
      id: clampString(ev.id, 80, `cevt_${fallbackIdx + 1}`),
      sourceLocalEventId: ev.sourceLocalEventId ? clampString(ev.sourceLocalEventId, 80) : undefined,
      title: clampString(ev.title, 1024, '일정'),
      date: sanitizeDateString(ev.date),
      endDate: ev.endDate && /^\d{4}-\d{2}-\d{2}$/.test(ev.endDate) ? ev.endDate : undefined,
      startTime: sanitizeTimeString(ev.startTime, '09:00'),
      endTime: sanitizeTimeString(ev.endTime, '10:00'),
      timeZone: clampString(ev.timeZone, 64, defaultTz),
      isAllDay: Boolean(ev.isAllDay),
      category: sanitizeCategory(ev.category),
      location: ev.location ? clampString(ev.location, 1024) : undefined,
      content: ev.content ? clampString(ev.content, 4096) : undefined,
      isCompleted: Boolean(ev.isCompleted),
      checklist,
      updatedAt: nowIso,
    };
  }

  public upsertPresence(
    roomId: string,
    connectionKey: string,
    participant: {
      participantId: string;
      displayName: string;
      colorHex?: string;
      timeZone: string;
      role: 'host' | 'guest';
      activeTargetId?: string;
    }
  ): CollabParticipantPresence[] {
    let map = this.livePresence.get(roomId);
    if (!map) {
      map = new Map();
      this.livePresence.set(roomId, map);
    }
    const existing = map.get(connectionKey);
    const nowIso = new Date().toISOString();
    const safeId = clampString(participant.participantId, 64, connectionKey);
    map.set(connectionKey, {
      participantId: safeId,
      displayName: clampString(participant.displayName, 40, '참여자'),
      colorHex:
        participant.colorHex && /^#[0-9a-fA-F]{6}$/.test(participant.colorHex)
          ? participant.colorHex
          : pickDeterministicCollabColor(safeId),
      timeZone: clampString(participant.timeZone, 64, 'Asia/Seoul'),
      role: participant.role,
      activeTargetId: participant.activeTargetId
        ? clampString(participant.activeTargetId, 80)
        : existing?.activeTargetId,
      joinedAt: existing?.joinedAt || nowIso,
      lastSeenAt: nowIso,
    });
    return this.getPresenceList(roomId);
  }

  public removePresence(roomId: string, connectionKey: string): CollabParticipantPresence[] {
    const map = this.livePresence.get(roomId);
    if (map) {
      map.delete(connectionKey);
      if (map.size === 0) {
        this.livePresence.delete(roomId);
      }
    }
    return this.getPresenceList(roomId);
  }

  public applySlotVote(params: {
    roomId: string;
    mutationId: string;
    slotId: string;
    participantId: string;
    displayName: string;
    colorHex: string;
    timeZone: string;
    status: CollabVoteStatus | null;
  }): { revision: number; slotId: string; votes: Record<string, CollabSlotVote>; updatedAt: string } | null {
    const stored = this.rooms.get(params.roomId);
    if (!stored) return null;

    const slot = stored.snapshot.proposedSlots.find((s) => s.id === params.slotId);
    if (!slot) return null;

    if (!this.recordMutationIfNew(stored, params.mutationId)) {
      return {
        revision: stored.snapshot.revision,
        slotId: slot.id,
        votes: slot.votes,
        updatedAt: stored.snapshot.updatedAt,
      };
    }

    const nowIso = new Date().toISOString();
    const pId = clampString(params.participantId, 64, 'anon');

    if (params.status === null) {
      delete slot.votes[pId];
    } else if (
      params.status === 'available' ||
      params.status === 'tentative' ||
      params.status === 'unavailable'
    ) {
      slot.votes[pId] = {
        participantId: pId,
        displayName: clampString(params.displayName, 40, '참여자'),
        colorHex:
          params.colorHex && /^#[0-9a-fA-F]{6}$/.test(params.colorHex)
            ? params.colorHex
            : pickDeterministicCollabColor(pId),
        status: params.status,
        timeZone: clampString(params.timeZone, 64, 'Asia/Seoul'),
        updatedAt: nowIso,
      };
    }

    stored.snapshot.revision += 1;
    stored.snapshot.updatedAt = nowIso;
    this.schedulePersist();

    return {
      revision: stored.snapshot.revision,
      slotId: slot.id,
      votes: { ...slot.votes },
      updatedAt: nowIso,
    };
  }

  public applyProposeSlot(params: {
    roomId: string;
    mutationId: string;
    createdByName: string;
    participantId: string;
    colorHex: string;
    timeZone: string;
    slot: {
      id: string;
      date: string;
      startTime: string;
      endTime: string;
      timeZone: string;
      label?: string;
    };
  }): { revision: number; slot: CollabProposalSlot; updatedAt: string } | null {
    const stored = this.rooms.get(params.roomId);
    if (!stored) return null;

    const cleanSlotId = clampString(params.slot.id, 64, `slot_${Date.now()}`);
    const existing = stored.snapshot.proposedSlots.find((s) => s.id === cleanSlotId);
    if (existing || !this.recordMutationIfNew(stored, params.mutationId)) {
      const target = existing || stored.snapshot.proposedSlots[stored.snapshot.proposedSlots.length - 1];
      return target
        ? {
            revision: stored.snapshot.revision,
            slot: target,
            updatedAt: stored.snapshot.updatedAt,
          }
        : null;
    }

    if (stored.snapshot.proposedSlots.length >= MAX_COLLAB_SLOTS) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const pId = clampString(params.participantId, 64, 'anon');
    const authorName = clampString(params.createdByName, 40, '참여자');

    const newSlot: CollabProposalSlot = {
      id: cleanSlotId,
      date: sanitizeDateString(params.slot.date),
      startTime: sanitizeTimeString(params.slot.startTime, '14:00'),
      endTime: sanitizeTimeString(params.slot.endTime, '15:00'),
      timeZone: clampString(params.slot.timeZone, 64, stored.snapshot.sourceTimeZone),
      label: params.slot.label ? clampString(params.slot.label, 512) : undefined,
      createdByName: authorName,
      votes: {
        [pId]: {
          participantId: pId,
          displayName: authorName,
          colorHex:
            params.colorHex && /^#[0-9a-fA-F]{6}$/.test(params.colorHex)
              ? params.colorHex
              : pickDeterministicCollabColor(pId),
          status: 'available',
          timeZone: clampString(params.timeZone, 64, 'Asia/Seoul'),
          updatedAt: nowIso,
        },
      },
    };

    stored.snapshot.proposedSlots.push(newSlot);
    stored.snapshot.revision += 1;
    stored.snapshot.updatedAt = nowIso;
    this.schedulePersist();

    return {
      revision: stored.snapshot.revision,
      slot: newSlot,
      updatedAt: nowIso,
    };
  }

  public applyFinalizeSlot(params: {
    roomId: string;
    mutationId: string;
    slotId: string | null;
    hostSecret: string;
    actorName: string;
  }): {
    revision: number;
    finalizedSlotId: string | null;
    systemComment?: CollabCommentItem;
    updatedAt: string;
  } | null {
    if (!this.verifyHostSecret(params.roomId, params.hostSecret)) {
      return null;
    }
    const stored = this.rooms.get(params.roomId);
    if (!stored) return null;

    if (!this.recordMutationIfNew(stored, params.mutationId)) {
      return {
        revision: stored.snapshot.revision,
        finalizedSlotId: stored.snapshot.finalizedSlotId,
        updatedAt: stored.snapshot.updatedAt,
      };
    }

    if (
      params.slotId !== null &&
      !stored.snapshot.proposedSlots.some((s) => s.id === params.slotId)
    ) {
      return null;
    }

    const nowIso = new Date().toISOString();
    stored.snapshot.finalizedSlotId = params.slotId;

    const matchedSlot = params.slotId
      ? stored.snapshot.proposedSlots.find((s) => s.id === params.slotId)
      : null;

    const sysComment: CollabCommentItem = {
      id: `sys_fin_${Date.now()}`,
      targetId: 'general',
      authorId: 'system',
      authorName: '시스템',
      authorColor: '#34d399',
      authorTimeZone: stored.snapshot.sourceTimeZone,
      body: matchedSlot
        ? `${clampString(params.actorName, 40, '호스트')}님이 최종 일시를 ${matchedSlot.date} ${matchedSlot.startTime}–${matchedSlot.endTime}으로 확정했습니다.`
        : `${clampString(params.actorName, 40, '호스트')}님이 확정 상태를 해제하고 재투표로 전환했습니다.`,
      isSystem: true,
      createdAt: nowIso,
    };

    stored.snapshot.comments.push(sysComment);
    if (stored.snapshot.comments.length > MAX_COLLAB_COMMENTS) {
      stored.snapshot.comments.splice(0, stored.snapshot.comments.length - MAX_COLLAB_COMMENTS);
    }

    stored.snapshot.revision += 1;
    stored.snapshot.updatedAt = nowIso;
    this.schedulePersist();

    return {
      revision: stored.snapshot.revision,
      finalizedSlotId: stored.snapshot.finalizedSlotId,
      systemComment: sysComment,
      updatedAt: nowIso,
    };
  }

  public applyChecklistToggle(params: {
    roomId: string;
    mutationId: string;
    eventId: string;
    itemId: string;
    done: boolean;
    actorName: string;
  }): { revision: number; eventId: string; checklist: CollabChecklistItem[]; updatedAt: string } | null {
    const stored = this.rooms.get(params.roomId);
    if (!stored) return null;
    const ev = stored.snapshot.events.find((e) => e.id === params.eventId);
    if (!ev) return null;

    if (!this.recordMutationIfNew(stored, params.mutationId)) {
      return {
        revision: stored.snapshot.revision,
        eventId: ev.id,
        checklist: ev.checklist,
        updatedAt: stored.snapshot.updatedAt,
      };
    }

    const item = ev.checklist.find((c) => c.id === params.itemId);
    if (!item) return null;

    const nowIso = new Date().toISOString();
    item.done = Boolean(params.done);
    item.updatedByName = clampString(params.actorName, 40, '참여자');
    item.updatedAt = nowIso;
    ev.updatedAt = nowIso;

    stored.snapshot.revision += 1;
    stored.snapshot.updatedAt = nowIso;
    this.schedulePersist();

    return {
      revision: stored.snapshot.revision,
      eventId: ev.id,
      checklist: [...ev.checklist],
      updatedAt: nowIso,
    };
  }

  public applyChecklistAdd(params: {
    roomId: string;
    mutationId: string;
    eventId: string;
    item: { id: string; text: string; done: boolean };
    actorName: string;
  }): { revision: number; eventId: string; checklist: CollabChecklistItem[]; updatedAt: string } | null {
    const stored = this.rooms.get(params.roomId);
    if (!stored) return null;
    const ev = stored.snapshot.events.find((e) => e.id === params.eventId);
    if (!ev) return null;

    const cleanItemId = clampString(params.item.id, 64, `chk_${Date.now()}`);
    const alreadyExists = ev.checklist.some((c) => c.id === cleanItemId);
    if (alreadyExists || !this.recordMutationIfNew(stored, params.mutationId)) {
      return {
        revision: stored.snapshot.revision,
        eventId: ev.id,
        checklist: ev.checklist,
        updatedAt: stored.snapshot.updatedAt,
      };
    }

    if (ev.checklist.length >= MAX_COLLAB_CHECKLIST_ITEMS) return null;
    const cleanText = clampString(params.item.text, 1024);
    if (!cleanText) return null;

    const nowIso = new Date().toISOString();
    ev.checklist.push({
      id: cleanItemId,
      text: cleanText,
      done: Boolean(params.item.done),
      updatedByName: clampString(params.actorName, 40, '참여자'),
      updatedAt: nowIso,
    });
    ev.updatedAt = nowIso;

    stored.snapshot.revision += 1;
    stored.snapshot.updatedAt = nowIso;
    this.schedulePersist();

    return {
      revision: stored.snapshot.revision,
      eventId: ev.id,
      checklist: [...ev.checklist],
      updatedAt: nowIso,
    };
  }

  public applyEventComplete(params: {
    roomId: string;
    mutationId: string;
    eventId: string;
    isCompleted: boolean;
  }): { revision: number; eventId: string; isCompleted: boolean; updatedAt: string } | null {
    const stored = this.rooms.get(params.roomId);
    if (!stored) return null;
    const ev = stored.snapshot.events.find((e) => e.id === params.eventId);
    if (!ev) return null;

    if (!this.recordMutationIfNew(stored, params.mutationId)) {
      return {
        revision: stored.snapshot.revision,
        eventId: ev.id,
        isCompleted: ev.isCompleted,
        updatedAt: stored.snapshot.updatedAt,
      };
    }

    const nowIso = new Date().toISOString();
    ev.isCompleted = Boolean(params.isCompleted);
    ev.updatedAt = nowIso;

    stored.snapshot.revision += 1;
    stored.snapshot.updatedAt = nowIso;
    this.schedulePersist();

    return {
      revision: stored.snapshot.revision,
      eventId: ev.id,
      isCompleted: ev.isCompleted,
      updatedAt: nowIso,
    };
  }

  public applySyncEvents(params: {
    roomId: string;
    mutationId: string;
    events: CollabSharedEvent[];
    hostSecret?: string;
  }): { revision: number; events: CollabSharedEvent[]; updatedAt: string } | null {
    if (!this.verifyHostSecret(params.roomId, params.hostSecret)) {
      return null;
    }
    const stored = this.rooms.get(params.roomId);
    if (!stored) return null;

    if (!this.recordMutationIfNew(stored, params.mutationId)) {
      return {
        revision: stored.snapshot.revision,
        events: stored.snapshot.events,
        updatedAt: stored.snapshot.updatedAt,
      };
    }

    const nowIso = new Date().toISOString();
    const sanitized = params.events
      .slice(0, MAX_COLLAB_EVENTS)
      .map((ev, idx) => this.sanitizeSharedEvent(ev, idx, nowIso, stored.snapshot.sourceTimeZone));

    stored.snapshot.events = sanitized;
    stored.snapshot.revision += 1;
    stored.snapshot.updatedAt = nowIso;
    this.schedulePersist();

    return {
      revision: stored.snapshot.revision,
      events: sanitized,
      updatedAt: nowIso,
    };
  }

  public applyCreateComment(params: {
    roomId: string;
    mutationId: string;
    authorId: string;
    authorName: string;
    authorColor: string;
    authorTimeZone: string;
    comment: { id: string; targetId: string; body: string };
  }): { revision: number; comment: CollabCommentItem; updatedAt: string } | null {
    const stored = this.rooms.get(params.roomId);
    if (!stored) return null;

    const cleanCommentId = clampString(params.comment.id, 64, `msg_${Date.now()}`);
    const existing = stored.snapshot.comments.find((c) => c.id === cleanCommentId);
    if (existing || !this.recordMutationIfNew(stored, params.mutationId)) {
      return existing
        ? {
            revision: stored.snapshot.revision,
            comment: existing,
            updatedAt: stored.snapshot.updatedAt,
          }
        : null;
    }

    const cleanBody = clampString(params.comment.body, 2048);
    if (!cleanBody) return null;

    const nowIso = new Date().toISOString();
    const pId = clampString(params.authorId, 64, 'anon');

    const newComment: CollabCommentItem = {
      id: cleanCommentId,
      targetId: clampString(params.comment.targetId, 80, 'general'),
      authorId: pId,
      authorName: clampString(params.authorName, 40, '참여자'),
      authorColor:
        params.authorColor && /^#[0-9a-fA-F]{6}$/.test(params.authorColor)
          ? params.authorColor
          : pickDeterministicCollabColor(pId),
      authorTimeZone: clampString(params.authorTimeZone, 64, 'Asia/Seoul'),
      body: cleanBody,
      createdAt: nowIso,
    };

    stored.snapshot.comments.push(newComment);
    if (stored.snapshot.comments.length > MAX_COLLAB_COMMENTS) {
      stored.snapshot.comments.splice(0, stored.snapshot.comments.length - MAX_COLLAB_COMMENTS);
    }

    stored.snapshot.revision += 1;
    stored.snapshot.updatedAt = nowIso;
    this.schedulePersist();

    return {
      revision: stored.snapshot.revision,
      comment: newComment,
      updatedAt: nowIso,
    };
  }
}

export const collabStore = new CollabAuthoritativeStore();
