import {
  CollabChecklistItem,
  CollabCommentItem,
  CollabProposalSlot,
  CollabRoomSnapshot,
  CollabSharedEvent,
  CreateCollabRoomRequest,
} from '../shared/collabSchema';

const E2EE_PREFIX = 'e2e1:';
const COLLAB_AAD_BYTES = new TextEncoder().encode('vibe-collab-e2ee-v1');

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64u: string): Uint8Array {
  const padded = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function isCollabCryptoSupported(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined'
  );
}

/**
 * URL 해시 프래그먼트(#rk=...) 전용 256-bit AES-GCM 대칭키 생성.
 * 해시 프래그먼트는 브라우저 표준에 따라 HTTP 요청 및 WebSocket 핸드셰이크 URL로 절대 전송되지 않습니다.
 */
export function generateCollabRoomKeyBase64Url(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return bytesToBase64Url(raw);
}

export async function importCollabRoomKey(base64UrlKey: string): Promise<CryptoKey | null> {
  if (!base64UrlKey || !isCollabCryptoSupported()) return null;
  try {
    const rawBytes = base64UrlToBytes(base64UrlKey.trim());
    if (rawBytes.byteLength !== 32 && rawBytes.byteLength !== 16) return null;
    return await crypto.subtle.importKey(
      'raw',
      rawBytes as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  } catch {
    return null;
  }
}

export async function encryptCollabText(
  plainText: string | undefined,
  cryptoKey: CryptoKey | null
): Promise<string> {
  if (!plainText) return '';
  if (!cryptoKey) return plainText;
  if (plainText.startsWith(E2EE_PREFIX)) return plainText;

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(plainText);
  const cipherBuf = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      additionalData: COLLAB_AAD_BYTES as BufferSource,
    },
    cryptoKey,
    encoded as BufferSource
  );
  return `${E2EE_PREFIX}${bytesToBase64Url(iv)}:${bytesToBase64Url(new Uint8Array(cipherBuf))}`;
}

export async function decryptCollabText(
  maybeCipher: string | undefined,
  cryptoKey: CryptoKey | null
): Promise<string> {
  if (!maybeCipher) return '';
  if (!maybeCipher.startsWith(E2EE_PREFIX)) return maybeCipher;
  if (!cryptoKey) return '종단간 암호화 보호된 항목 (초대 링크 키 필요)';

  const payload = maybeCipher.slice(E2EE_PREFIX.length);
  const sepIdx = payload.indexOf(':');
  if (sepIdx <= 0) return '암호화된 항목';

  try {
    const iv = base64UrlToBytes(payload.slice(0, sepIdx));
    const ct = base64UrlToBytes(payload.slice(sepIdx + 1));
    const plainBuf = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as BufferSource,
        additionalData: COLLAB_AAD_BYTES as BufferSource,
      },
      cryptoKey,
      ct as BufferSource
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    return '복호화할 수 없는 암호화 항목 (초대 링크 확인 필요)';
  }
}

export async function encryptSharedEventFields(
  ev: CollabSharedEvent,
  cryptoKey: CryptoKey | null
): Promise<CollabSharedEvent> {
  if (!cryptoKey) return ev;
  const [title, location, content, checklist] = await Promise.all([
    encryptCollabText(ev.title, cryptoKey),
    ev.location ? encryptCollabText(ev.location, cryptoKey) : Promise.resolve(undefined),
    ev.content ? encryptCollabText(ev.content, cryptoKey) : Promise.resolve(undefined),
    Promise.all(
      ev.checklist.map(async (item) => ({
        ...item,
        text: await encryptCollabText(item.text, cryptoKey),
      }))
    ),
  ]);
  return {
    ...ev,
    title,
    location,
    content,
    checklist,
  };
}

export async function decryptSharedEventFields(
  ev: CollabSharedEvent,
  cryptoKey: CryptoKey | null
): Promise<CollabSharedEvent> {
  const [title, location, content, checklist] = await Promise.all([
    decryptCollabText(ev.title, cryptoKey),
    ev.location ? decryptCollabText(ev.location, cryptoKey) : Promise.resolve(undefined),
    ev.content ? decryptCollabText(ev.content, cryptoKey) : Promise.resolve(undefined),
    Promise.all(
      ev.checklist.map(async (item) => ({
        ...item,
        text: await decryptCollabText(item.text, cryptoKey),
      }))
    ),
  ]);
  return {
    ...ev,
    title,
    location,
    content,
    checklist,
  };
}

export async function decryptChecklistList(
  checklist: CollabChecklistItem[],
  cryptoKey: CryptoKey | null
): Promise<CollabChecklistItem[]> {
  return Promise.all(
    checklist.map(async (item) => ({
      ...item,
      text: await decryptCollabText(item.text, cryptoKey),
    }))
  );
}

export async function decryptProposalSlot(
  slot: CollabProposalSlot,
  cryptoKey: CryptoKey | null
): Promise<CollabProposalSlot> {
  return {
    ...slot,
    label: slot.label ? await decryptCollabText(slot.label, cryptoKey) : undefined,
  };
}

export async function decryptCommentItem(
  comment: CollabCommentItem,
  cryptoKey: CryptoKey | null
): Promise<CollabCommentItem> {
  if (comment.isSystem) return comment;
  return {
    ...comment,
    body: await decryptCollabText(comment.body, cryptoKey),
  };
}

export async function encryptRoomCreationRequest(
  req: CreateCollabRoomRequest,
  cryptoKey: CryptoKey | null
): Promise<CreateCollabRoomRequest> {
  if (!req.isE2ee || !cryptoKey) return req;

  const [title, subtitle, location, proposedSlots, events] = await Promise.all([
    encryptCollabText(req.title, cryptoKey),
    req.subtitle ? encryptCollabText(req.subtitle, cryptoKey) : Promise.resolve(undefined),
    req.location ? encryptCollabText(req.location, cryptoKey) : Promise.resolve(undefined),
    req.proposedSlots
      ? Promise.all(
          req.proposedSlots.map(async (s) => ({
            ...s,
            label: s.label ? await encryptCollabText(s.label, cryptoKey) : undefined,
          }))
        )
      : Promise.resolve(undefined),
    req.events
      ? Promise.all(req.events.map((ev) => encryptSharedEventFields(ev, cryptoKey)))
      : Promise.resolve(undefined),
  ]);

  return {
    ...req,
    title,
    subtitle,
    location,
    proposedSlots,
    events,
  };
}

export async function decryptRoomSnapshot(
  room: CollabRoomSnapshot,
  cryptoKey: CryptoKey | null
): Promise<CollabRoomSnapshot> {
  if (!room.isE2ee) return room;

  const [title, subtitle, location, proposedSlots, events, comments] = await Promise.all([
    decryptCollabText(room.title, cryptoKey),
    room.subtitle ? decryptCollabText(room.subtitle, cryptoKey) : Promise.resolve(undefined),
    room.location ? decryptCollabText(room.location, cryptoKey) : Promise.resolve(undefined),
    Promise.all(room.proposedSlots.map((s) => decryptProposalSlot(s, cryptoKey))),
    Promise.all(room.events.map((ev) => decryptSharedEventFields(ev, cryptoKey))),
    Promise.all(room.comments.map((c) => decryptCommentItem(c, cryptoKey))),
  ]);

  return {
    ...room,
    title,
    subtitle,
    location,
    proposedSlots,
    events,
    comments,
  };
}

export interface ParsedCollabUrlInvite {
  roomId: string;
  roomKeyBase64Url?: string;
}

export function buildCollabInviteUrl(roomId: string, roomKeyBase64Url?: string): string {
  if (typeof window === 'undefined') {
    return `?collab=${encodeURIComponent(roomId)}${
      roomKeyBase64Url ? `#rk=${encodeURIComponent(roomKeyBase64Url)}` : ''
    }`;
  }
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('collab', roomId);
  if (roomKeyBase64Url) {
    url.hash = `rk=${encodeURIComponent(roomKeyBase64Url)}`;
  }
  return url.toString();
}

export function parseCollabInviteFromUrl(rawInput: string): ParsedCollabUrlInvite | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // 순수 룸 ID 코드만 입력한 경우
  if (/^[a-zA-Z0-9_-]{6,36}$/.test(trimmed)) {
    return { roomId: trimmed };
  }

  try {
    const parsed = new URL(
      trimmed,
      typeof window !== 'undefined' ? window.location.origin : 'https://vibecalendar.local'
    );
    let roomId = parsed.searchParams.get('collab')?.trim() || '';
    let roomKeyBase64Url: string | undefined;

    const hashRaw = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    if (hashRaw) {
      const hashParams = new URLSearchParams(hashRaw);
      const hashCollab = hashParams.get('collab')?.trim();
      const hashRk = hashParams.get('rk')?.trim();
      if (!roomId && hashCollab) {
        roomId = hashCollab;
      }
      if (hashRk) {
        roomKeyBase64Url = hashRk;
      }
    }

    if (!roomId || !/^[a-zA-Z0-9_-]{6,36}$/.test(roomId)) {
      return null;
    }
    return { roomId, roomKeyBase64Url };
  } catch {
    return null;
  }
}

export function extractCollabInviteFromLocation(): ParsedCollabUrlInvite | null {
  if (typeof window === 'undefined') return null;
  return parseCollabInviteFromUrl(window.location.href);
}
