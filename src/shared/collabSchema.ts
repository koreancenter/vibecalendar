import { CalendarCategory } from '../types';

export const COLLAB_WS_PATH = '/ws/collab';
export const MAX_COLLAB_COMMENTS = 200;
export const MAX_COLLAB_SLOTS = 12;
export const MAX_COLLAB_EVENTS = 80;
export const MAX_COLLAB_CHECKLIST_ITEMS = 40;

export const COLLAB_PARTICIPANT_COLORS = [
  '#818cf8',
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#2dd4bf',
  '#fb923c',
] as const;

export type CollabRoomKind = 'proposal' | 'runsheet';

export type CollabVoteStatus = 'available' | 'tentative' | 'unavailable';

export interface CollabParticipantPresence {
  participantId: string;
  displayName: string;
  colorHex: string;
  timeZone: string;
  role: 'host' | 'guest';
  activeTargetId?: string;
  joinedAt: string;
  lastSeenAt: string;
}

export interface CollabSlotVote {
  participantId: string;
  displayName: string;
  colorHex: string;
  status: CollabVoteStatus;
  timeZone: string;
  updatedAt: string;
}

export interface CollabProposalSlot {
  id: string;
  date: string; // YYYY-MM-DD (in room sourceTimeZone)
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  timeZone: string;
  label?: string; // Plaintext or E2EE ciphertext
  createdByName: string;
  votes: Record<string, CollabSlotVote>;
}

export interface CollabChecklistItem {
  id: string;
  text: string; // Plaintext or E2EE ciphertext
  done: boolean;
  updatedByName?: string;
  updatedAt: string;
}

export interface CollabSharedEvent {
  id: string;
  sourceLocalEventId?: string;
  title: string; // Plaintext or E2EE ciphertext
  date: string; // YYYY-MM-DD
  endDate?: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  isAllDay: boolean;
  category: CalendarCategory;
  location?: string; // Plaintext or E2EE ciphertext
  content?: string; // Plaintext or E2EE ciphertext
  isCompleted: boolean;
  checklist: CollabChecklistItem[];
  updatedAt: string;
}

export interface CollabCommentItem {
  id: string;
  targetId: string; // 'general' | slot.id | event.id
  authorId: string;
  authorName: string;
  authorColor: string;
  authorTimeZone: string;
  body: string; // Plaintext or E2EE ciphertext
  isSystem?: boolean;
  createdAt: string;
}

export interface CollabRoomSnapshot {
  roomId: string;
  kind: CollabRoomKind;
  isE2ee: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  hostDisplayName: string;
  title: string; // Plaintext or E2EE ciphertext
  subtitle?: string; // Plaintext or E2EE ciphertext
  location?: string; // Plaintext or E2EE ciphertext
  sourceTimeZone: string;
  durationMinutes: number;
  category: CalendarCategory;
  finalizedSlotId: string | null;
  proposedSlots: CollabProposalSlot[];
  events: CollabSharedEvent[];
  comments: CollabCommentItem[];
  presence: CollabParticipantPresence[];
}

export interface CreateCollabRoomRequest {
  kind: CollabRoomKind;
  isE2ee: boolean;
  hostDisplayName: string;
  title: string;
  subtitle?: string;
  location?: string;
  sourceTimeZone: string;
  durationMinutes: number;
  category: CalendarCategory;
  proposedSlots?: Array<{
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    timeZone: string;
    label?: string;
    createdByName: string;
  }>;
  events?: CollabSharedEvent[];
}

export interface CreateCollabRoomResponse {
  room: CollabRoomSnapshot;
  hostSecret: string;
}

export interface SavedCollabRoomRecord {
  roomId: string;
  kind: CollabRoomKind;
  localTitle: string;
  isE2ee: boolean;
  roomKeyBase64Url?: string;
  hostSecret?: string;
  linkedEventId?: string;
  linkedProjectId?: string;
  createdAt: string;
  lastOpenedAt: string;
}

export type CollabClientMessage =
  | {
      type: 'room:join';
      roomId: string;
      participantId: string;
      displayName: string;
      colorHex: string;
      timeZone: string;
      hostSecret?: string;
      activeTargetId?: string;
    }
  | {
      type: 'presence:update';
      displayName?: string;
      timeZone?: string;
      activeTargetId?: string;
    }
  | {
      type: 'slot:vote';
      mutationId: string;
      slotId: string;
      status: CollabVoteStatus | null;
    }
  | {
      type: 'slot:propose';
      mutationId: string;
      slot: {
        id: string;
        date: string;
        startTime: string;
        endTime: string;
        timeZone: string;
        label?: string;
      };
    }
  | {
      type: 'proposal:finalize';
      mutationId: string;
      slotId: string | null;
      hostSecret: string;
    }
  | {
      type: 'checklist:toggle';
      mutationId: string;
      eventId: string;
      itemId: string;
      done: boolean;
    }
  | {
      type: 'checklist:add';
      mutationId: string;
      eventId: string;
      item: {
        id: string;
        text: string;
        done: boolean;
      };
    }
  | {
      type: 'event:complete';
      mutationId: string;
      eventId: string;
      isCompleted: boolean;
    }
  | {
      type: 'events:sync';
      mutationId: string;
      events: CollabSharedEvent[];
      hostSecret?: string;
    }
  | {
      type: 'comment:create';
      mutationId: string;
      comment: {
        id: string;
        targetId: string;
        body: string;
      };
    };

export type CollabServerMessage =
  | {
      type: 'room:init';
      room: CollabRoomSnapshot;
      isHost: boolean;
    }
  | {
      type: 'presence:updated';
      presence: CollabParticipantPresence[];
    }
  | {
      type: 'slot:voted';
      revision: number;
      slotId: string;
      votes: Record<string, CollabSlotVote>;
      mutationId: string;
      updatedAt: string;
    }
  | {
      type: 'slot:proposed';
      revision: number;
      slot: CollabProposalSlot;
      mutationId: string;
      updatedAt: string;
    }
  | {
      type: 'proposal:finalized';
      revision: number;
      finalizedSlotId: string | null;
      systemComment?: CollabCommentItem;
      mutationId: string;
      updatedAt: string;
    }
  | {
      type: 'checklist:updated';
      revision: number;
      eventId: string;
      checklist: CollabChecklistItem[];
      mutationId: string;
      updatedAt: string;
    }
  | {
      type: 'event:updated';
      revision: number;
      eventId: string;
      isCompleted: boolean;
      mutationId: string;
      updatedAt: string;
    }
  | {
      type: 'events:synced';
      revision: number;
      events: CollabSharedEvent[];
      mutationId: string;
      updatedAt: string;
    }
  | {
      type: 'comment:created';
      revision: number;
      comment: CollabCommentItem;
      mutationId: string;
      updatedAt: string;
    }
  | {
      type: 'room:error';
      code: string;
      message: string;
    };

export function pickDeterministicCollabColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return COLLAB_PARTICIPANT_COLORS[hash % COLLAB_PARTICIPANT_COLORS.length];
}
