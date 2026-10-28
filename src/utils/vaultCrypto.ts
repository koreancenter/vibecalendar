import {
  INITIAL_CALENDAR_EVENTS,
  LEGACY_REAL_NAME_EVENT_IDS,
  LEGACY_REAL_NAME_PROJECT_IDS,
} from '../data/sampleEvents';
import { INITIAL_PROJECTS, PROJECT_STATUS_MAP } from '../constants/projects';
import { normalizePlaceAndAddress } from '../shared/locationUtils';
import { CalendarEventItem, ProjectItem } from '../types';
import {
  clearBiometricSlot,
  enrollBiometricForDek,
  readStoredBiometricSlot,
  unlockDekWithBiometrics,
} from './webauthnBiometrics';

export const VAULT_STORAGE_KEY = 'vibe_aes_gcm_vault_v1';
export const LEGAL_CONSENT_STORAGE_KEY = 'vibe_legal_consent_v1';
export const AUTO_LOCK_MINUTES_KEY = 'vibe_vault_auto_lock_minutes_v1';
export const BROWSE_SESSION_KEY = 'vibe_browse_session_active_v1';

const PLAINTEXT_WORKSPACE_KEYS = [
  'ai_smart_calendar_events_v4',
  'ai_smart_calendar_events_v3',
  'vibe_calendar_projects_v2',
  'vibe_calendar_projects_v1',
  'vibe_calendar_selected_project_ids_v2',
  'vibe_calendar_selected_project_id',
] as const;

const VAULT_AAD_LABEL_V1 = 'vibe-event-vault-v1';
const VAULT_DATA_AAD_V2 = 'vibe-event-vault-data-v2';
const VAULT_PIN_SLOT_AAD_V2 = 'vibe-event-vault-pinslot-v2';
const DEFAULT_PBKDF2_ITERATIONS = 120_000;

export type PinLengthOption = 4 | 6;
export type AutoLockMinutesOption = 0 | 5 | 15 | 30;

export interface VaultPlaintextBundle {
  events: CalendarEventItem[];
  projects: ProjectItem[];
  selectedProjectIds: string[];
}

export interface LegacyEncryptedVaultEnvelopeV1 {
  version: 1;
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  pinLength: PinLengthOption;
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
  updatedAt: string;
}

export interface EncryptedVaultEnvelopeV2 {
  version: 2;
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  pinLength: PinLengthOption;
  pinSaltBase64: string;
  pinWrapIvBase64: string;
  pinWrappedDekBase64: string;
  dataIvBase64: string;
  ciphertextBase64: string;
  updatedAt: string;
}

export type StoredVaultEnvelope = LegacyEncryptedVaultEnvelopeV1 | EncryptedVaultEnvelopeV2;

export interface LegalConsentRecord {
  version: 1;
  acceptedApiSecurityAndBillingDisclaimer: true;
  acceptedAt: string;
  entity: 'GOGUMA APP Team - Korean Center Global Network';
}

export class VaultInvalidPinError extends Error {
  constructor(message = 'PIN이 일치하지 않습니다.') {
    super(message);
    this.name = 'VaultInvalidPinError';
  }
}

export function isWebCryptoAvailable(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined'
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isValidEventItem(item: unknown): item is CalendarEventItem {
  if (!item || typeof item !== 'object') return false;
  const e = item as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.title === 'string' &&
    typeof e.date === 'string' &&
    typeof e.startTime === 'string' &&
    typeof e.endTime === 'string'
  );
}

function isValidProjectItem(item: unknown): item is ProjectItem {
  if (!item || typeof item !== 'object') return false;
  const p = item as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    typeof p.name === 'string' &&
    p.name.length > 0 &&
    typeof p.color === 'string' &&
    /^#[0-9a-fA-F]{3,8}$/.test(p.color) &&
    typeof p.status === 'string' &&
    p.status in PROJECT_STATUS_MAP &&
    typeof p.createdAt === 'string'
  );
}

function sanitizeStoredEvent(item: CalendarEventItem): CalendarEventItem {
  const { location, locationAddress } = normalizePlaceAndAddress(
    item.location,
    item.locationAddress
  );
  return {
    ...item,
    location,
    locationAddress,
  };
}

function normalizeDecodedBundle(parsed: Partial<VaultPlaintextBundle>): VaultPlaintextBundle {
  const events = Array.isArray(parsed.events)
    ? parsed.events
        .filter((item): item is CalendarEventItem =>
          isValidEventItem(item) && !LEGACY_REAL_NAME_EVENT_IDS.has(item.id)
        )
        .map(sanitizeStoredEvent)
    : INITIAL_CALENDAR_EVENTS;
  const projects = Array.isArray(parsed.projects)
    ? parsed.projects.filter(
        (item): item is ProjectItem =>
          isValidProjectItem(item) && !LEGACY_REAL_NAME_PROJECT_IDS.has(item.id)
      )
    : INITIAL_PROJECTS;
  const selectedProjectIds = Array.isArray(parsed.selectedProjectIds)
    ? parsed.selectedProjectIds.filter(
        (id): id is string =>
          typeof id === 'string' && id !== 'all' && !LEGACY_REAL_NAME_PROJECT_IDS.has(id)
      )
    : [];

  return {
    events,
    projects,
    selectedProjectIds,
  };
}

export function readStoredVaultEnvelope(): StoredVaultEnvelope | null {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    if (
      parsed.version === 2 &&
      parsed.cipher === 'AES-256-GCM' &&
      parsed.kdf === 'PBKDF2-SHA256' &&
      typeof parsed.iterations === 'number' &&
      (parsed.pinLength === 4 || parsed.pinLength === 6) &&
      typeof parsed.pinSaltBase64 === 'string' &&
      typeof parsed.pinWrapIvBase64 === 'string' &&
      typeof parsed.pinWrappedDekBase64 === 'string' &&
      typeof parsed.dataIvBase64 === 'string' &&
      typeof parsed.ciphertextBase64 === 'string'
    ) {
      return parsed as unknown as EncryptedVaultEnvelopeV2;
    }

    if (
      parsed.version === 1 &&
      parsed.cipher === 'AES-256-GCM' &&
      parsed.kdf === 'PBKDF2-SHA256' &&
      typeof parsed.iterations === 'number' &&
      (parsed.pinLength === 4 || parsed.pinLength === 6) &&
      typeof parsed.saltBase64 === 'string' &&
      typeof parsed.ivBase64 === 'string' &&
      typeof parsed.ciphertextBase64 === 'string'
    ) {
      return parsed as unknown as LegacyEncryptedVaultEnvelopeV1;
    }
  } catch {
    // ignore malformed vault metadata
  }
  return null;
}

export function isBiometricUnlockEnabled(): boolean {
  const vault = readStoredVaultEnvelope();
  if (!vault || vault.version !== 2) return false;
  return Boolean(readStoredBiometricSlot());
}

export function readLegalConsent(): LegalConsentRecord | null {
  try {
    const raw = localStorage.getItem(LEGAL_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LegalConsentRecord>;
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.acceptedApiSecurityAndBillingDisclaimer === true &&
      typeof parsed.acceptedAt === 'string'
    ) {
      return parsed as LegalConsentRecord;
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}

export function saveLegalConsent(): LegalConsentRecord {
  const record: LegalConsentRecord = {
    version: 1,
    acceptedApiSecurityAndBillingDisclaimer: true,
    acceptedAt: new Date().toISOString(),
    entity: 'GOGUMA APP Team - Korean Center Global Network',
  };
  try {
    localStorage.setItem(LEGAL_CONSENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore storage quota issue
  }
  return record;
}

export function readAutoLockMinutes(): AutoLockMinutesOption {
  try {
    const raw = localStorage.getItem(AUTO_LOCK_MINUTES_KEY);
    const num = Number(raw);
    if (num === 0 || num === 5 || num === 15 || num === 30) {
      return num;
    }
  } catch {
    // ignore
  }
  return 15;
}

export function saveAutoLockMinutes(minutes: AutoLockMinutesOption): void {
  try {
    localStorage.setItem(AUTO_LOCK_MINUTES_KEY, String(minutes));
  } catch {
    // ignore
  }
}

export function isBrowseSessionActive(): boolean {
  try {
    return sessionStorage.getItem(BROWSE_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function setBrowseSessionActive(active: boolean): void {
  try {
    if (active) {
      sessionStorage.setItem(BROWSE_SESSION_KEY, '1');
    } else {
      sessionStorage.removeItem(BROWSE_SESSION_KEY);
    }
  } catch {
    // ignore
  }
}

export function readPlaintextWorkspaceBundle(): VaultPlaintextBundle {
  let events: CalendarEventItem[] = INITIAL_CALENDAR_EVENTS;
  let projects: ProjectItem[] = INITIAL_PROJECTS;
  let selectedProjectIds: string[] = [];

  try {
    const savedEventsV4 = localStorage.getItem('ai_smart_calendar_events_v4');
    const savedEventsRaw =
      savedEventsV4 !== null ? savedEventsV4 : localStorage.getItem('ai_smart_calendar_events_v3');
    if (savedEventsRaw) {
      const parsed = JSON.parse(savedEventsRaw);
      if (Array.isArray(parsed)) {
        events = parsed
          .filter(
            (item): item is CalendarEventItem =>
              isValidEventItem(item) && !LEGACY_REAL_NAME_EVENT_IDS.has(item.id)
          )
          .map(sanitizeStoredEvent);
      }
    }
  } catch {
    // fallback
  }

  try {
    const savedProjectsV2 = localStorage.getItem('vibe_calendar_projects_v2');
    const savedProjectsRaw =
      savedProjectsV2 !== null ? savedProjectsV2 : localStorage.getItem('vibe_calendar_projects_v1');
    if (savedProjectsRaw) {
      const parsed = JSON.parse(savedProjectsRaw);
      if (Array.isArray(parsed)) {
        projects = parsed.filter(
          (item): item is ProjectItem =>
            isValidProjectItem(item) && !LEGACY_REAL_NAME_PROJECT_IDS.has(item.id)
        );
      }
    }
  } catch {
    // fallback
  }

  try {
    const savedSelected = localStorage.getItem('vibe_calendar_selected_project_ids_v2');
    if (savedSelected) {
      const parsed = JSON.parse(savedSelected);
      if (Array.isArray(parsed)) {
        selectedProjectIds = parsed.filter(
          (id): id is string =>
            typeof id === 'string' && id !== 'all' && !LEGACY_REAL_NAME_PROJECT_IDS.has(id)
        );
      }
    }
  } catch {
    // fallback
  }

  return { events, projects, selectedProjectIds };
}

export function purgePlaintextWorkspaceStorage(): void {
  try {
    for (const key of PLAINTEXT_WORKSPACE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export function restorePlaintextWorkspaceStorage(bundle: VaultPlaintextBundle): void {
  try {
    localStorage.setItem('ai_smart_calendar_events_v4', JSON.stringify(bundle.events));
    localStorage.removeItem('ai_smart_calendar_events_v3');
    localStorage.setItem('vibe_calendar_projects_v2', JSON.stringify(bundle.projects));
    localStorage.removeItem('vibe_calendar_projects_v1');
    localStorage.setItem(
      'vibe_calendar_selected_project_ids_v2',
      JSON.stringify(bundle.selectedProjectIds)
    );
  } catch {
    // ignore quota error
  }
}

/**
 * 민감 바이트 버퍼 즉시 제로화(Zero-fill) 유틸리티
 */
export function zeroOutBytes(...buffers: Array<Uint8Array | null | undefined>): void {
  for (const buf of buffers) {
    if (buf && buf.byteLength > 0) {
      buf.fill(0);
    }
  }
}

export function zeroOutArrayBuffer(buffer: ArrayBuffer | null | undefined): void {
  if (buffer && buffer.byteLength > 0) {
    new Uint8Array(buffer).fill(0);
  }
}

/**
 * 평문 JSON 전문을 메모리에 상주시키지 않고 변경 여부만 판별하기 위한 경량 비가역 다이제스트
 */
export function computeBundleDigest(bundle: VaultPlaintextBundle): string {
  const serialized = JSON.stringify(bundle);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < serialized.length; i++) {
    const ch = serialized.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${serialized.length}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
}

export async function derivePinKek(
  pin: string,
  salt: Uint8Array,
  iterations = DEFAULT_PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  if (!isWebCryptoAvailable()) {
    throw new Error('이 브라우저는 Web Crypto 보안 암호화를 지원하지 않습니다.');
  }

  let pinBytes: Uint8Array | null = null;
  try {
    pinBytes = new TextEncoder().encode(pin);
    const baseKey = await crypto.subtle.importKey(
      'raw',
      pinBytes as BufferSource,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource,
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['encrypt', 'decrypt']
    );
  } finally {
    zeroOutBytes(pinBytes);
  }
}

async function importRawDekAsCryptoKey(rawDekBytes: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    rawDekBytes as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function wrapDekWithPin(
  rawDekBytes: Uint8Array,
  pin: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS
): Promise<{
  pinSaltBase64: string;
  pinWrapIvBase64: string;
  pinWrappedDekBase64: string;
}> {
  let pinSalt: Uint8Array | null = null;
  let pinWrapIv: Uint8Array | null = null;
  let aad: Uint8Array | null = null;
  let wrappedDekBuffer: ArrayBuffer | null = null;
  let wrappedDekBytes: Uint8Array | null = null;

  try {
    pinSalt = crypto.getRandomValues(new Uint8Array(16));
    pinWrapIv = crypto.getRandomValues(new Uint8Array(12));
    aad = new TextEncoder().encode(VAULT_PIN_SLOT_AAD_V2);

    const pinKek = await derivePinKek(pin, pinSalt, iterations);
    wrappedDekBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: pinWrapIv as BufferSource,
        additionalData: aad as BufferSource,
        tagLength: 128,
      },
      pinKek,
      rawDekBytes as BufferSource
    );
    wrappedDekBytes = new Uint8Array(wrappedDekBuffer);

    return {
      pinSaltBase64: bytesToBase64(pinSalt),
      pinWrapIvBase64: bytesToBase64(pinWrapIv),
      pinWrappedDekBase64: bytesToBase64(wrappedDekBytes),
    };
  } finally {
    zeroOutBytes(pinSalt, pinWrapIv, aad, wrappedDekBytes);
    zeroOutArrayBuffer(wrappedDekBuffer);
  }
}

async function encryptPayloadWithDekKey(
  dekKey: CryptoKey,
  payload: VaultPlaintextBundle
): Promise<{ dataIvBase64: string; ciphertextBase64: string }> {
  let dataIv: Uint8Array | null = null;
  let aad: Uint8Array | null = null;
  let plaintextBytes: Uint8Array | null = null;
  let cipherBuffer: ArrayBuffer | null = null;
  let cipherBytes: Uint8Array | null = null;

  try {
    const encoder = new TextEncoder();
    dataIv = crypto.getRandomValues(new Uint8Array(12));
    aad = encoder.encode(VAULT_DATA_AAD_V2);
    plaintextBytes = encoder.encode(JSON.stringify(payload));

    cipherBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: dataIv as BufferSource,
        additionalData: aad as BufferSource,
        tagLength: 128,
      },
      dekKey,
      plaintextBytes as BufferSource
    );
    cipherBytes = new Uint8Array(cipherBuffer);

    return {
      dataIvBase64: bytesToBase64(dataIv),
      ciphertextBase64: bytesToBase64(cipherBytes),
    };
  } finally {
    zeroOutBytes(plaintextBytes, dataIv, aad, cipherBytes);
    zeroOutArrayBuffer(cipherBuffer);
  }
}

export async function persistVaultDataWithActiveDek(
  dekKey: CryptoKey,
  payload: VaultPlaintextBundle
): Promise<EncryptedVaultEnvelopeV2 | null> {
  const existing = readStoredVaultEnvelope();
  if (!existing || existing.version !== 2) return null;

  const { dataIvBase64, ciphertextBase64 } = await encryptPayloadWithDekKey(dekKey, payload);

  const updated: EncryptedVaultEnvelopeV2 = {
    ...existing,
    dataIvBase64,
    ciphertextBase64,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(updated));
  purgePlaintextWorkspaceStorage();
  setBrowseSessionActive(false);

  return updated;
}

export async function createEncryptedVault(
  pin: string,
  pinLength: PinLengthOption,
  payload: VaultPlaintextBundle,
  existingRawDekBytes?: Uint8Array
): Promise<{
  dekKey: CryptoKey;
  rawDekBytes: Uint8Array;
  envelope: EncryptedVaultEnvelopeV2;
}> {
  const isRotatingExistingDek = Boolean(existingRawDekBytes);
  let rawDekBytes: Uint8Array | null = null;
  let handoffSucceeded = false;

  try {
    rawDekBytes = existingRawDekBytes
      ? new Uint8Array(existingRawDekBytes)
      : crypto.getRandomValues(new Uint8Array(32));

    if (!isRotatingExistingDek) {
      await clearBiometricSlot();
    }

    const dekKey = await importRawDekAsCryptoKey(rawDekBytes);
    const pinSlot = await wrapDekWithPin(rawDekBytes, pin, DEFAULT_PBKDF2_ITERATIONS);
    const encryptedData = await encryptPayloadWithDekKey(dekKey, payload);

    const envelope: EncryptedVaultEnvelopeV2 = {
      version: 2,
      cipher: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: DEFAULT_PBKDF2_ITERATIONS,
      pinLength,
      ...pinSlot,
      ...encryptedData,
      updatedAt: new Date().toISOString(),
    };

    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(envelope));
    purgePlaintextWorkspaceStorage();
    setBrowseSessionActive(false);

    handoffSucceeded = true;
    return { dekKey, rawDekBytes, envelope };
  } finally {
    if (!handoffSucceeded) {
      zeroOutBytes(rawDekBytes);
    }
  }
}

async function decryptPayloadWithDekKey(
  dekKey: CryptoKey,
  envelope: EncryptedVaultEnvelopeV2
): Promise<VaultPlaintextBundle> {
  let dataIv: Uint8Array | null = null;
  let ciphertext: Uint8Array | null = null;
  let aad: Uint8Array | null = null;
  let plainBuffer: ArrayBuffer | null = null;
  let plainBytes: Uint8Array | null = null;

  try {
    dataIv = base64ToBytes(envelope.dataIvBase64);
    ciphertext = base64ToBytes(envelope.ciphertextBase64);
    aad = new TextEncoder().encode(VAULT_DATA_AAD_V2);

    plainBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: dataIv as BufferSource,
        additionalData: aad as BufferSource,
        tagLength: 128,
      },
      dekKey,
      ciphertext as BufferSource
    );
    plainBytes = new Uint8Array(plainBuffer);

    const decodedText = new TextDecoder().decode(plainBytes);
    const parsed = JSON.parse(decodedText) as Partial<VaultPlaintextBundle>;
    return normalizeDecodedBundle(parsed);
  } finally {
    zeroOutBytes(plainBytes, dataIv, ciphertext, aad);
    zeroOutArrayBuffer(plainBuffer);
  }
}

export async function unlockEncryptedVault(pin: string): Promise<{
  dekKey: CryptoKey;
  rawDekBytes: Uint8Array;
  envelope: EncryptedVaultEnvelopeV2;
  payload: VaultPlaintextBundle;
}> {
  const stored = readStoredVaultEnvelope();
  if (!stored) {
    throw new Error('저장된 암호화 볼트를 찾을 수 없습니다.');
  }

  // v1 볼트 하위 호환 자동 마이그레이션 -> v2 Envelope DEK 구조 승격
  if (stored.version === 1) {
    let salt: Uint8Array | null = null;
    let iv: Uint8Array | null = null;
    let ciphertext: Uint8Array | null = null;
    let aad: Uint8Array | null = null;
    let plainBuffer: ArrayBuffer | null = null;
    let plainBytes: Uint8Array | null = null;
    let payload: VaultPlaintextBundle;

    try {
      salt = base64ToBytes(stored.saltBase64);
      iv = base64ToBytes(stored.ivBase64);
      ciphertext = base64ToBytes(stored.ciphertextBase64);
      aad = new TextEncoder().encode(VAULT_AAD_LABEL_V1);

      const legacyKey = await derivePinKek(pin, salt, stored.iterations);

      try {
        plainBuffer = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: iv as BufferSource,
            additionalData: aad as BufferSource,
            tagLength: 128,
          },
          legacyKey,
          ciphertext as BufferSource
        );
      } catch {
        throw new VaultInvalidPinError('PIN이 일치하지 않습니다.');
      }

      plainBytes = new Uint8Array(plainBuffer);
      const decodedText = new TextDecoder().decode(plainBytes);
      const parsed = JSON.parse(decodedText) as Partial<VaultPlaintextBundle>;
      payload = normalizeDecodedBundle(parsed);
    } finally {
      zeroOutBytes(plainBytes, salt, iv, ciphertext, aad);
      zeroOutArrayBuffer(plainBuffer);
    }

    const upgraded = await createEncryptedVault(pin, stored.pinLength, payload);
    return {
      ...upgraded,
      payload,
    };
  }

  // v2 Envelope DEK 복호화
  let pinSalt: Uint8Array | null = null;
  let pinWrapIv: Uint8Array | null = null;
  let pinWrappedDek: Uint8Array | null = null;
  let pinSlotAad: Uint8Array | null = null;
  let rawDekBuffer: ArrayBuffer | null = null;
  let unwrappedView: Uint8Array | null = null;
  let rawDekBytes: Uint8Array | null = null;
  let handoffSucceeded = false;

  try {
    pinSalt = base64ToBytes(stored.pinSaltBase64);
    pinWrapIv = base64ToBytes(stored.pinWrapIvBase64);
    pinWrappedDek = base64ToBytes(stored.pinWrappedDekBase64);
    pinSlotAad = new TextEncoder().encode(VAULT_PIN_SLOT_AAD_V2);

    const pinKek = await derivePinKek(pin, pinSalt, stored.iterations);

    try {
      rawDekBuffer = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: pinWrapIv as BufferSource,
          additionalData: pinSlotAad as BufferSource,
          tagLength: 128,
        },
        pinKek,
        pinWrappedDek as BufferSource
      );
    } catch {
      throw new VaultInvalidPinError('PIN이 일치하지 않습니다.');
    }

    unwrappedView = new Uint8Array(rawDekBuffer);
    rawDekBytes = new Uint8Array(unwrappedView.byteLength);
    rawDekBytes.set(unwrappedView);
    unwrappedView.fill(0);

    const dekKey = await importRawDekAsCryptoKey(rawDekBytes);
    const payload = await decryptPayloadWithDekKey(dekKey, stored);

    handoffSucceeded = true;
    return {
      dekKey,
      rawDekBytes,
      envelope: stored,
      payload,
    };
  } finally {
    zeroOutBytes(pinSalt, pinWrapIv, pinWrappedDek, pinSlotAad, unwrappedView);
    zeroOutArrayBuffer(rawDekBuffer);
    if (!handoffSucceeded) {
      zeroOutBytes(rawDekBytes);
    }
  }
}

export async function unlockEncryptedVaultWithBiometrics(): Promise<{
  dekKey: CryptoKey;
  rawDekBytes: Uint8Array;
  envelope: EncryptedVaultEnvelopeV2;
  payload: VaultPlaintextBundle;
}> {
  const stored = readStoredVaultEnvelope();
  if (!stored || stored.version !== 2) {
    throw new Error('생체 인증을 지원하는 암호화 볼트가 설정되어 있지 않습니다.');
  }

  let rawDekBytes: Uint8Array | null = null;
  let handoffSucceeded = false;

  try {
    rawDekBytes = await unlockDekWithBiometrics();
    const dekKey = await importRawDekAsCryptoKey(rawDekBytes);
    const payload = await decryptPayloadWithDekKey(dekKey, stored);

    handoffSucceeded = true;
    return {
      dekKey,
      rawDekBytes,
      envelope: stored,
      payload,
    };
  } finally {
    if (!handoffSucceeded) {
      zeroOutBytes(rawDekBytes);
    }
  }
}

export async function enableVaultBiometrics(rawDekBytes: Uint8Array): Promise<void> {
  const transientDekBytes = new Uint8Array(rawDekBytes);
  try {
    await enrollBiometricForDek(transientDekBytes);
  } finally {
    zeroOutBytes(transientDekBytes);
  }
}

export async function disableVaultBiometrics(): Promise<void> {
  await clearBiometricSlot();
}

export function disableEncryptedVault(bundle: VaultPlaintextBundle): void {
  restorePlaintextWorkspaceStorage(bundle);
  void clearBiometricSlot();
  try {
    localStorage.removeItem(VAULT_STORAGE_KEY);
  } catch {
    // ignore
  }
  setBrowseSessionActive(true);
}

export function factoryResetLocalWorkspace(): void {
  purgePlaintextWorkspaceStorage();
  setBrowseSessionActive(false);
  void clearBiometricSlot();
  try {
    localStorage.removeItem(VAULT_STORAGE_KEY);
    localStorage.removeItem('vibe_ai_model_selection_v1');
    localStorage.removeItem('vibe_pdf_export_theme_v1');
  } catch {
    // ignore
  }
}
