export const BIOMETRIC_SLOT_STORAGE_KEY = 'vibe_vault_biometric_slot_v1';
const BIOMETRIC_IDB_NAME = 'vibe_biometric_keystore_db_v1';
const BIOMETRIC_IDB_STORE = 'wrapping_keys';
const BIOMETRIC_KEY_RECORD_ID = 'active_biometric_kek';

export interface BiometricVaultSlot {
  version: 1;
  credentialIdBase64: string;
  mode: 'prf' | 'idb-hardware-gated';
  prfSaltBase64?: string;
  ivBase64: string;
  wrappedDekBase64: string;
  createdAt: string;
}

export class BiometricUserCancelledError extends Error {
  constructor(message = '생체 인증이 취소되었습니다.') {
    super(message);
    this.name = 'BiometricUserCancelledError';
  }
}

export class BiometricEnvironmentRestrictedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BiometricEnvironmentRestrictedError';
  }
}

interface PrfExtensionInput {
  prf?: {
    eval?: {
      first: BufferSource;
    };
  };
}

interface PrfExtensionOutput {
  prf?: {
    enabled?: boolean;
    results?: {
      first?: ArrayBuffer;
    };
  };
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

export function isWebAuthnApiAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined' &&
    typeof navigator.credentials.create === 'function' &&
    typeof navigator.credentials.get === 'function'
  );
}

export async function isPlatformBiometricHardwareAvailable(): Promise<boolean> {
  if (!isWebAuthnApiAvailable()) return false;
  try {
    if (
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    ) {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return false;
  } catch {
    return false;
  }
}

export function readStoredBiometricSlot(): BiometricVaultSlot | null {
  try {
    const raw = localStorage.getItem(BIOMETRIC_SLOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BiometricVaultSlot>;
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.credentialIdBase64 === 'string' &&
      (parsed.mode === 'prf' || parsed.mode === 'idb-hardware-gated') &&
      typeof parsed.ivBase64 === 'string' &&
      typeof parsed.wrappedDekBase64 === 'string' &&
      typeof parsed.createdAt === 'string'
    ) {
      return parsed as BiometricVaultSlot;
    }
  } catch {
    // ignore malformed slot
  }
  return null;
}

function openBiometricKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BIOMETRIC_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BIOMETRIC_IDB_STORE)) {
        db.createObjectStore(BIOMETRIC_IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('생체 인증 키 저장소를 열 수 없습니다.'));
  });
}

async function saveNonExtractableKeyToIdb(key: CryptoKey): Promise<void> {
  const db = await openBiometricKeyDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BIOMETRIC_IDB_STORE, 'readwrite');
      const store = tx.objectStore(BIOMETRIC_IDB_STORE);
      store.put(key, BIOMETRIC_KEY_RECORD_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error || new Error('생체 인증 키 저장 중 오류가 발생했습니다.'));
    });
  } finally {
    db.close();
  }
}

async function loadNonExtractableKeyFromIdb(): Promise<CryptoKey | null> {
  const db = await openBiometricKeyDatabase();
  try {
    return await new Promise<CryptoKey | null>((resolve, reject) => {
      const tx = db.transaction(BIOMETRIC_IDB_STORE, 'readonly');
      const store = tx.objectStore(BIOMETRIC_IDB_STORE);
      const req = store.get(BIOMETRIC_KEY_RECORD_ID);
      req.onsuccess = () => {
        const result = req.result;
        resolve(result instanceof CryptoKey ? result : null);
      };
      req.onerror = () =>
        reject(req.error || new Error('생체 인증 키를 불러올 수 없습니다.'));
    });
  } finally {
    db.close();
  }
}

async function clearIdbBiometricKey(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openBiometricKeyDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(BIOMETRIC_IDB_STORE, 'readwrite');
      tx.objectStore(BIOMETRIC_IDB_STORE).delete(BIOMETRIC_KEY_RECORD_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore cleanup error
  }
}

export async function clearBiometricSlot(): Promise<void> {
  try {
    localStorage.removeItem(BIOMETRIC_SLOT_STORAGE_KEY);
  } catch {
    // ignore
  }
  await clearIdbBiometricKey();
}

async function deriveAesKeyFromPrfSecret(prfBytes: Uint8Array): Promise<CryptoKey> {
  const hkdfBase = await crypto.subtle.importKey(
    'raw',
    prfBytes as BufferSource,
    'HKDF',
    false,
    ['deriveKey']
  );

  const info = new TextEncoder().encode('vibe-event-webauthn-prf-kek-v1');
  const salt = new Uint8Array(32);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: info as BufferSource,
    },
    hkdfBase,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

function buildBiometricAad(credentialIdBase64: string): Uint8Array {
  return new TextEncoder().encode(`vibe-biometric-dek-v1:${credentialIdBase64}`);
}

function classifyWebAuthnError(err: unknown): Error {
  if (err instanceof DOMException) {
    const msg = err.message || '';
    if (
      err.name === 'SecurityError' ||
      /publickey-credentials|permissions policy|not enabled in this document|ancestors/i.test(
        msg
      )
    ) {
      return new BiometricEnvironmentRestrictedError(
        '현재 임베디드 미리보기 프레임의 보안 정책으로 하드웨어 생체 인증 호출이 제한됩니다. 독립 브라우저 탭에서 열면 Face ID · Touch ID · 지문 인증을 바로 사용할 수 있습니다.'
      );
    }
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
      return new BiometricUserCancelledError(
        '기기 생체 인증이 취소되었거나 허용되지 않았습니다.'
      );
    }
    if (err.name === 'InvalidStateError') {
      return new Error('이미 이 기기에 등록된 생체 인증 자격 증명이 존재합니다.');
    }
  }
  if (err instanceof Error) return err;
  return new Error('생체 인증 처리 중 알 수 없는 오류가 발생했습니다.');
}

function verifyAssertionFlags(authenticatorData: ArrayBuffer): void {
  const bytes = new Uint8Array(authenticatorData);
  if (bytes.byteLength < 37) {
    throw new Error('유효하지 않은 생체 인증 응답 데이터입니다.');
  }
  const flags = bytes[32];
  const userPresent = (flags & 0x01) !== 0;
  const userVerified = (flags & 0x04) !== 0;

  if (!userPresent || !userVerified) {
    throw new Error('하드웨어 생체 검증(User Verification)이 완료되지 않았습니다.');
  }
}

export async function enrollBiometricForDek(
  rawDekBytes: Uint8Array
): Promise<BiometricVaultSlot> {
  if (!isWebAuthnApiAvailable()) {
    throw new Error('현재 브라우저 환경은 WebAuthn 생체 인증을 지원하지 않습니다.');
  }

  const platformAvailable = await isPlatformBiometricHardwareAvailable();
  if (!platformAvailable) {
    throw new Error(
      '이 기기에서 활성화된 생체 인식 하드웨어(Face ID · Touch ID · Windows Hello · 지문)를 찾을 수 없습니다.'
    );
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));

  const extensionsInput: PrfExtensionInput = {
    prf: {
      eval: {
        first: prfSalt as BufferSource,
      },
    },
  };

  let credential: PublicKeyCredential | null = null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: challenge as BufferSource,
        rp: {
          name: '바이브 행사 (Vibe Event Vault)',
          id: window.location.hostname,
        },
        user: {
          id: userId as BufferSource,
          name: 'vibe-local-vault',
          displayName: '바이브 행사 로컬 볼트',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
        extensions: extensionsInput as unknown as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw classifyWebAuthnError(err);
  }

  if (!credential) {
    throw new BiometricUserCancelledError('생체 인증 자격 증명이 생성되지 않았습니다.');
  }

  const credentialIdBase64 = bytesToBase64(new Uint8Array(credential.rawId));
  const aad = buildBiometricAad(credentialIdBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const extResults = credential.getClientExtensionResults() as unknown as PrfExtensionOutput;
  const prfFirstBuffer = extResults?.prf?.results?.first;

  let wrappingKey: CryptoKey;
  let mode: 'prf' | 'idb-hardware-gated';
  let storedPrfSaltBase64: string | undefined;

  if (prfFirstBuffer && prfFirstBuffer.byteLength >= 32) {
    wrappingKey = await deriveAesKeyFromPrfSecret(new Uint8Array(prfFirstBuffer));
    mode = 'prf';
    storedPrfSaltBase64 = bytesToBase64(prfSalt);
    await clearIdbBiometricKey();
  } else {
    wrappingKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    await saveNonExtractableKeyToIdb(wrappingKey);
    mode = 'idb-hardware-gated';
  }

  const wrappedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      additionalData: aad as BufferSource,
      tagLength: 128,
    },
    wrappingKey,
    rawDekBytes as BufferSource
  );

  const slot: BiometricVaultSlot = {
    version: 1,
    credentialIdBase64,
    mode,
    prfSaltBase64: storedPrfSaltBase64,
    ivBase64: bytesToBase64(iv),
    wrappedDekBase64: bytesToBase64(new Uint8Array(wrappedBuffer)),
    createdAt: new Date().toISOString(),
  };

  localStorage.setItem(BIOMETRIC_SLOT_STORAGE_KEY, JSON.stringify(slot));
  return slot;
}

export async function unlockDekWithBiometrics(): Promise<Uint8Array> {
  const slot = readStoredBiometricSlot();
  if (!slot) {
    throw new Error('등록된 생체 인증 정보가 없습니다. PIN으로 잠금 해제해 주세요.');
  }

  if (!isWebAuthnApiAvailable()) {
    throw new Error('이 브라우저는 WebAuthn 생체 인증을 지원하지 않습니다.');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credentialIdBytes = base64ToBytes(slot.credentialIdBase64);

  const extensionsInput: PrfExtensionInput | undefined =
    slot.mode === 'prf' && slot.prfSaltBase64
      ? {
          prf: {
            eval: {
              first: base64ToBytes(slot.prfSaltBase64) as BufferSource,
            },
          },
        }
      : undefined;

  let assertion: PublicKeyCredential | null = null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: challenge as BufferSource,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: credentialIdBytes as BufferSource,
            type: 'public-key',
          },
        ],
        userVerification: 'required',
        timeout: 60000,
        ...(extensionsInput
          ? {
              extensions: extensionsInput as unknown as AuthenticationExtensionsClientInputs,
            }
          : {}),
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw classifyWebAuthnError(err);
  }

  if (!assertion) {
    throw new BiometricUserCancelledError('생체 인증이 취소되었습니다.');
  }

  const returnedIdBase64 = bytesToBase64(new Uint8Array(assertion.rawId));
  if (returnedIdBase64 !== slot.credentialIdBase64) {
    throw new Error('등록된 기기 생체 인증 자격 증명과 일치하지 않습니다.');
  }

  const response = assertion.response as AuthenticatorAssertionResponse;
  verifyAssertionFlags(response.authenticatorData);

  let wrappingKey: CryptoKey | null = null;

  if (slot.mode === 'prf') {
    const extResults = assertion.getClientExtensionResults() as unknown as PrfExtensionOutput;
    const prfFirstBuffer = extResults?.prf?.results?.first;
    if (!prfFirstBuffer || prfFirstBuffer.byteLength < 32) {
      throw new Error('하드웨어 보안 키(PRF) 응답을 확인할 수 없습니다. PIN을 사용해 주세요.');
    }
    wrappingKey = await deriveAesKeyFromPrfSecret(new Uint8Array(prfFirstBuffer));
  } else {
    wrappingKey = await loadNonExtractableKeyFromIdb();
    if (!wrappingKey) {
      throw new Error(
        '생체 인증 키 저장소가 초기화되었습니다. PIN으로 해제한 뒤 생체 인증을 다시 켜 주세요.'
      );
    }
  }

  const aad = buildBiometricAad(slot.credentialIdBase64);
  const iv = base64ToBytes(slot.ivBase64);
  const wrappedDek = base64ToBytes(slot.wrappedDekBase64);

  try {
    const rawDekBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as BufferSource,
        additionalData: aad as BufferSource,
        tagLength: 128,
      },
      wrappingKey,
      wrappedDek as BufferSource
    );
    return new Uint8Array(rawDekBuffer);
  } catch {
    throw new Error('생체 인증 볼트 키 복호화에 실패했습니다. PIN으로 잠금 해제해 주세요.');
  }
}
