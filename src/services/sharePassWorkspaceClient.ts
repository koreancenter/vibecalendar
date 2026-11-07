import * as Y from 'yjs';
import { SavedCollabRoomItem } from '../types';
import { SharedPassPayload } from '../utils/shareCodec';
import {
  CreateEncryptedWorkspaceRequest,
  CreateEncryptedWorkspaceResponse,
  EncryptedBinaryEnvelope,
  YJS_SHARE_API_BASE,
} from '../shared/yjsCollabProtocol';
import {
  buildE2eeSharePassUrl,
  deriveSharePassKeyBundle,
  encryptYjsBinary,
  generateSharePassDocId,
  generateSharePassMasterKey,
} from '../utils/yjsE2eeCrypto';
import { initializeYDocFromSharePayload } from './yjsSharePassDoc';

const LOCAL_YJS_CACHE_PREFIX = 'vibe_e2ee_yjs_doc_v1:';

export function writeLocalEncryptedYjsCache(
  docId: string,
  envelope: EncryptedBinaryEnvelope
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${LOCAL_YJS_CACHE_PREFIX}${docId}`, JSON.stringify(envelope));
  } catch {
    // ignore storage quota errors
  }
}

export function readLocalEncryptedYjsCache(docId: string): EncryptedBinaryEnvelope | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${LOCAL_YJS_CACHE_PREFIX}${docId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EncryptedBinaryEnvelope>;
    if (typeof parsed.iv === 'string' && typeof parsed.ct === 'string') {
      return { iv: parsed.iv, ct: parsed.ct };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Initializes a Y.Doc from a privacy-filtered `SharedPassPayload`, encrypts its binary CRDT state
 * with a newly generated 256-bit master key (`AES-256-GCM`), registers the opaque ciphertext on
 * the relay server, and returns the Zero-Knowledge `#sk=` collaborative URL.
 */
export async function createE2eeSharePassWorkspace(params: {
  payload: SharedPassPayload;
  host: {
    participantId: string;
    displayName: string;
    colorHex: string;
    timeZone: string;
  };
  linkedEventId?: string;
  linkedProjectId?: string;
}): Promise<{
  docId: string;
  masterKeyB64u: string;
  inviteUrl: string;
  record: SavedCollabRoomItem;
}> {
  const { payload, host, linkedEventId, linkedProjectId } = params;
  const docId = generateSharePassDocId();
  const masterKeyB64u = generateSharePassMasterKey();
  const keys = await deriveSharePassKeyBundle(masterKeyB64u, docId);

  const ydoc = new Y.Doc();
  let initialStateBytes: Uint8Array;
  try {
    initializeYDocFromSharePayload(ydoc, payload, host);
    initialStateBytes = Y.encodeStateAsUpdate(ydoc);
  } finally {
    ydoc.destroy();
  }

  const encryptedSnapshot = await encryptYjsBinary(
    initialStateBytes,
    keys.docKey,
    `doc:${docId}`
  );

  const wireBody: CreateEncryptedWorkspaceRequest = {
    docId,
    authVerifierHash: keys.authVerifierHash,
    encryptedSnapshot,
  };

  const res = await fetch(YJS_SHARE_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wireBody),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || '실시간 E2EE 공동편집 패스 생성에 실패했습니다.');
  }

  const created = (await res.json()) as CreateEncryptedWorkspaceResponse;
  const effectiveDocId = created.docId || docId;

  // Cache encrypted snapshot locally for instant offline access
  writeLocalEncryptedYjsCache(effectiveDocId, encryptedSnapshot);

  const title =
    payload.kind === 'event'
      ? payload.event?.title || '일정 공동편집 패스'
      : payload.project?.name || '프로젝트 공동편집 패스';

  const nowIso = new Date().toISOString();
  const record: SavedCollabRoomItem = {
    roomId: effectiveDocId,
    kind: 'sharepass-crdt',
    shareKind: payload.kind,
    localTitle: title,
    isE2ee: true,
    roomKeyBase64Url: masterKeyB64u,
    linkedEventId,
    linkedProjectId,
    autoSyncToVault: true,
    createdAt: created.createdAt || nowIso,
    lastOpenedAt: nowIso,
  };

  const inviteUrl = buildE2eeSharePassUrl(effectiveDocId, masterKeyB64u);
  return {
    docId: effectiveDocId,
    masterKeyB64u,
    inviteUrl,
    record,
  };
}
