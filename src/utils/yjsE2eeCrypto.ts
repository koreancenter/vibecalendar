import { EncryptedBinaryEnvelope } from '../shared/yjsCollabProtocol';

const AES_IV_BYTES = 12;
const MASTER_KEY_BYTES = 32;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(b64u: string): Uint8Array {
  const padded = b64u
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(b64u.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Generates a 256-bit CSPRNG master key encoded as Base64URL for the URL `#sk=` fragment.
 */
export function generateSharePassMasterKey(): string {
  const raw = new Uint8Array(MASTER_KEY_BYTES);
  crypto.getRandomValues(raw);
  return bytesToBase64Url(raw);
}

/**
 * Generates a URL-safe random CRDT document identifier (`sp_...`).
 */
export function generateSharePassDocId(): string {
  const raw = new Uint8Array(10);
  crypto.getRandomValues(raw);
  return `sp_${bytesToBase64Url(raw)}`;
}

export interface DerivedSharePassKeys {
  docKey: CryptoKey;
  awarenessKey: CryptoKey;
  /** One-way HKDF capability sent to prove possession of masterKey without revealing masterKey */
  authCapability: string;
  /** SHA-256 hex digest of authCapability stored on the relay server */
  authVerifierHash: string;
}

/**
 * Derives cryptographically isolated keys via HKDF-SHA256 from the shared URL `#sk=` master key:
 * 1. `docKey` (AES-256-GCM) for Y.Doc CRDT updates & compacted snapshots
 * 2. `awarenessKey` (AES-256-GCM) for ephemeral Awareness presence/cursors
 * 3. `authCapability` + `authVerifierHash` for zero-knowledge room access control
 */
export async function deriveSharePassKeyBundle(
  masterKeyB64u: string,
  docId: string
): Promise<DerivedSharePassKeys> {
  const rawMaster = base64UrlToBytes(masterKeyB64u.trim());
  if (rawMaster.byteLength < 16) {
    throw new Error('유효하지 않은 E2EE 공유 마스터 키입니다.');
  }

  const encoder = new TextEncoder();
  const hkdfBaseKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(rawMaster),
    'HKDF',
    false,
    ['deriveKey', 'deriveBits']
  );

  const salt = toArrayBuffer(encoder.encode(`vibe-sharepass-crdt-v1:${docId}`));

  const [docKey, awarenessKey, authBits] = await Promise.all([
    crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: toArrayBuffer(encoder.encode('yjs-doc-update-aes256gcm')),
      },
      hkdfBaseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    ),
    crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: toArrayBuffer(encoder.encode('yjs-awareness-aes256gcm')),
      },
      hkdfBaseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    ),
    crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: toArrayBuffer(encoder.encode('yjs-room-auth-capability')),
      },
      hkdfBaseKey,
      256
    ),
  ]);

  const authBytes = new Uint8Array(authBits);
  const authCapability = bytesToBase64Url(authBytes);
  const verifierDigest = await crypto.subtle.digest(
    'SHA-256',
    toArrayBuffer(encoder.encode(authCapability))
  );
  const authVerifierHash = bytesToHex(new Uint8Array(verifierDigest));

  return {
    docKey,
    awarenessKey,
    authCapability,
    authVerifierHash,
  };
}

/**
 * Encrypts binary Yjs CRDT or Awareness payload using AES-256-GCM with AAD room binding.
 */
export async function encryptYjsBinary(
  plainBytes: Uint8Array,
  key: CryptoKey,
  aadLabel: string
): Promise<EncryptedBinaryEnvelope> {
  const iv = new Uint8Array(AES_IV_BYTES);
  crypto.getRandomValues(iv);
  const aad = new TextEncoder().encode(aadLabel);

  const cipherBuf = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad),
    },
    key,
    toArrayBuffer(plainBytes)
  );

  return {
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(new Uint8Array(cipherBuf)),
  };
}

/**
 * Decrypts and authenticates binary Yjs CRDT or Awareness payload using AES-256-GCM.
 */
export async function decryptYjsBinary(
  envelope: EncryptedBinaryEnvelope,
  key: CryptoKey,
  aadLabel: string
): Promise<Uint8Array> {
  const iv = base64UrlToBytes(envelope.iv);
  const ct = base64UrlToBytes(envelope.ct);
  const aad = new TextEncoder().encode(aadLabel);

  const plainBuf = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad),
    },
    key,
    toArrayBuffer(ct)
  );

  return new Uint8Array(plainBuf);
}

export interface ParsedE2eeSharePassInvite {
  docId: string;
  masterKeyB64u: string;
}

/**
 * Builds Zero-Knowledge E2EE SharePass URL (`?spass=<docId>#sk=<masterKey>`).
 * The `#sk` fragment is never sent to the server over HTTP or WebSocket handshakes.
 */
export function buildE2eeSharePassUrl(docId: string, masterKeyB64u: string): string {
  if (typeof window === 'undefined') {
    return `?spass=${encodeURIComponent(docId)}#sk=${encodeURIComponent(masterKeyB64u)}`;
  }
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('spass', docId);
  url.hash = `sk=${encodeURIComponent(masterKeyB64u)}`;
  return url.toString();
}

export function parseE2eeSharePassInvite(rawInput: string): ParsedE2eeSharePassInvite | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(
      trimmed,
      typeof window !== 'undefined' ? window.location.origin : 'https://vibecalendar.local'
    );
    let docId = parsed.searchParams.get('spass')?.trim() || '';
    let masterKeyB64u = '';

    const hashRaw = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    if (hashRaw) {
      const hashParams = new URLSearchParams(hashRaw);
      const hashDoc = hashParams.get('spass')?.trim();
      const hashSk = hashParams.get('sk')?.trim();
      if (!docId && hashDoc) {
        docId = hashDoc;
      }
      if (hashSk) {
        masterKeyB64u = hashSk;
      }
    }

    if (
      !docId ||
      !/^[a-zA-Z0-9_-]{6,48}$/.test(docId) ||
      !masterKeyB64u ||
      !/^[a-zA-Z0-9_-]{20,96}$/.test(masterKeyB64u)
    ) {
      return null;
    }

    return { docId, masterKeyB64u };
  } catch {
    return null;
  }
}

export function extractE2eeSharePassFromLocation(): ParsedE2eeSharePassInvite | null {
  if (typeof window === 'undefined') return null;
  return parseE2eeSharePassInvite(window.location.href);
}
