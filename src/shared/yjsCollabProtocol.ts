import { CalendarCategory } from '../types';
import { ShareCardTheme } from '../utils/shareCodec';

export const YJS_SHARE_WS_PATH = '/ws/sharepass';
export const YJS_SHARE_API_BASE = '/api/sharepass/workspaces';
export const YJS_COMPACTION_THRESHOLD = 35;
export const MAX_ENCRYPTED_DELTAS_PER_DOC = 240;

export interface EncryptedBinaryEnvelope {
  /** 12-byte AES-GCM IV encoded as Base64URL */
  iv: string;
  /** Ciphertext + 16-byte GCM authentication tag encoded as Base64URL */
  ct: string;
}

export interface EncryptedCrdtDeltaRecord {
  seq: number;
  senderId: string;
  envelope: EncryptedBinaryEnvelope;
  createdAt: string;
}

export interface CreateEncryptedWorkspaceRequest {
  docId?: string;
  /** SHA-256 hex digest of HKDF-derived authCapability (Zero-Knowledge proof of key possession) */
  authVerifierHash: string;
  /** Initial Y.encodeStateAsUpdate(ydoc) encrypted with AES-256-GCM */
  encryptedSnapshot: EncryptedBinaryEnvelope;
}

export interface CreateEncryptedWorkspaceResponse {
  docId: string;
  snapshotSeq: number;
  createdAt: string;
}

export interface EncryptedWorkspaceServerState {
  docId: string;
  snapshotSeq: number;
  encryptedSnapshot: EncryptedBinaryEnvelope;
  deltas: EncryptedCrdtDeltaRecord[];
  createdAt: string;
  updatedAt: string;
}

export type YjsE2eeClientWsMessage =
  | {
      type: 'yjs:auth';
      docId: string;
      peerId: string;
      authCapability: string;
      knownSeq?: number;
    }
  | {
      type: 'yjs:update';
      envelope: EncryptedBinaryEnvelope;
    }
  | {
      type: 'yjs:compact';
      baseSeq: number;
      encryptedSnapshot: EncryptedBinaryEnvelope;
    }
  | {
      type: 'yjs:awareness';
      envelope: EncryptedBinaryEnvelope;
    }
  | {
      type: 'yjs:leave';
    };

export type YjsE2eeServerWsMessage =
  | {
      type: 'yjs:sync_init';
      docId: string;
      snapshotSeq: number;
      encryptedSnapshot: EncryptedBinaryEnvelope;
      deltas: EncryptedCrdtDeltaRecord[];
      peerCount: number;
    }
  | {
      type: 'yjs:remote_update';
      delta: EncryptedCrdtDeltaRecord;
    }
  | {
      type: 'yjs:compacted';
      snapshotSeq: number;
    }
  | {
      type: 'yjs:remote_awareness';
      peerId: string;
      envelope: EncryptedBinaryEnvelope;
    }
  | {
      type: 'yjs:peer_left';
      peerId: string;
    }
  | {
      type: 'yjs:peer_count';
      peerCount: number;
    }
  | {
      type: 'yjs:error';
      code: string;
      message: string;
    };

export type SharePassRsvpStatus = 'attending' | 'maybe' | 'declined';
export type SharePassSlotVoteStatus = 'available' | 'tentative' | 'unavailable';

export interface CrdtEventRsvpEntry {
  participantId: string;
  displayName: string;
  colorHex: string;
  timeZone: string;
  status: SharePassRsvpStatus;
  note?: string;
  updatedAt: string;
}

export interface CrdtChecklistEntry {
  id: string;
  text: string;
  done: boolean;
  updatedBy?: string;
  updatedAt: string;
}

export interface CrdtSlotVoteEntry {
  participantId: string;
  displayName: string;
  colorHex: string;
  timeZone: string;
  status: SharePassSlotVoteStatus;
  updatedAt: string;
}

export interface CrdtProposedSlotItem {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  label?: string;
  createdBy: string;
  votes: Record<string, CrdtSlotVoteEntry>;
}

export interface CrdtCollaborativeEventItem {
  id: string;
  sourceLocalEventId?: string;
  title: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  isAllDay: boolean;
  category: CalendarCategory;
  projectName?: string;
  location?: string;
  locationAddress?: string;
  locationLat?: number;
  locationLng?: number;
  content?: string;
  isCompleted: boolean;
  lastEditedBy?: string;
  updatedAt: string;
  checklist: CrdtChecklistEntry[];
  rsvps: Record<string, CrdtEventRsvpEntry>;
}

export interface CrdtCommentEntry {
  id: string;
  targetId: string; // 'general' | eventId | slotId
  authorId: string;
  authorName: string;
  authorColor: string;
  authorTimeZone: string;
  body: string;
  createdAt: string;
}

export interface CrdtAwarenessPeerState {
  clientId: number;
  peerId: string;
  participantId: string;
  displayName: string;
  colorHex: string;
  timeZone: string;
  activeField?: string; // e.g., 'notes' | `event:${id}:title` | `event:${id}`
  activeLabel?: string;
  updatedAt: number;
}

export interface CollaborativeSharePassView {
  kind: 'event' | 'project';
  title: string;
  subtitle?: string;
  projectCode?: string;
  clientOrOrg?: string;
  startDate?: string;
  endDate?: string;
  theme: ShareCardTheme;
  senderNote: string;
  sourceTimeZone: string;
  issuedAt: string;
  hostParticipantId: string;
  hostDisplayName: string;
  finalizedSlotId: string | null;
  sharedNotes: string;
  events: CrdtCollaborativeEventItem[];
  proposedSlots: CrdtProposedSlotItem[];
  comments: CrdtCommentEntry[];
}
