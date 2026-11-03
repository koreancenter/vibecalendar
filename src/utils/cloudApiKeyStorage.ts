export interface CloudModelOption {
  id: string;
  label: string;
}

interface EncryptedCloudKeyEnvelopeV1 {
  version: 1;
  mode: 'idb' | 'pbkdf2';
  ivBase64: string;
  saltBase64?: string;
  ciphertextBase64: string;
  models: CloudModelOption[];
  verifiedAt: string;
}

const CLOUD_KEY_VAULT_STORAGE_KEY = 'vibe_cloud_api_key_vault_v1';
const CLOUD_KEY_IDB_NAME = 'vibe_cloud_key_keystore_v1';
const CLOUD_KEY_IDB_STORE = 'keys';
const CLOUD_KEY_IDB_RECORD = 'device-kek-v1';
const CLOUD_KEY_AAD = 'vibe-cloud-gemini-key-v1';

let hydrated = false;
let hydrationPromise: Promise<{ apiKey: string; models: CloudModelOption[] }> | null = null;
let cachedPlainApiKey = '';
let cachedVerifiedModels: CloudModelOption[] = [];

const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

export function subscribeCloudKeyChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function openKeystoreDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(CLOUD_KEY_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CLOUD_KEY_IDB_STORE)) {
        db.createObjectStore(CLOUD_KEY_IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
  });
}

async function getOrCreateIdbCryptoKey(): Promise<CryptoKey> {
  const db = await openKeystoreDb();
  try {
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const tx = db.transaction(CLOUD_KEY_IDB_STORE, 'readonly');
      const store = tx.objectStore(CLOUD_KEY_IDB_STORE);
      const getReq = store.get(CLOUD_KEY_IDB_RECORD);
      getReq.onsuccess = () => resolve(getReq.result as CryptoKey | undefined);
      getReq.onerror = () => reject(getReq.error);
    });
    if (existing) {
      return existing;
    }

    const generated = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CLOUD_KEY_IDB_STORE, 'readwrite');
      const store = tx.objectStore(CLOUD_KEY_IDB_STORE);
      const putReq = store.put(generated, CLOUD_KEY_IDB_RECORD);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });

    return generated;
  } finally {
    db.close();
  }
}

async function deriveFallbackOriginKey(salt: Uint8Array): Promise<CryptoKey> {
  const originMaterial = new TextEncoder().encode(
    `${typeof window !== 'undefined' ? window.location.origin : 'local'}::${CLOUD_KEY_AAD}`
  );
  const baseKey = await crypto.subtle.importKey(
    'raw',
    originMaterial as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function sanitizeStoredModels(raw: unknown): CloudModelOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CloudModelOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    const label = typeof obj.label === 'string' ? obj.label.trim() : '';
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

async function readAndDecryptStoredEnvelope(): Promise<{
  apiKey: string;
  models: CloudModelOption[];
}> {
  if (typeof localStorage === 'undefined' || typeof crypto === 'undefined' || !crypto.subtle) {
    return { apiKey: '', models: [] };
  }

  let rawJson: string | null = null;
  try {
    rawJson = localStorage.getItem(CLOUD_KEY_VAULT_STORAGE_KEY);
  } catch {
    return { apiKey: '', models: [] };
  }
  if (!rawJson) {
    return { apiKey: '', models: [] };
  }

  try {
    const parsed = JSON.parse(rawJson) as Partial<EncryptedCloudKeyEnvelopeV1>;
    if (
      parsed.version !== 1 ||
      typeof parsed.ivBase64 !== 'string' ||
      typeof parsed.ciphertextBase64 !== 'string'
    ) {
      return { apiKey: '', models: [] };
    }

    const iv = base64ToBytes(parsed.ivBase64);
    const ciphertext = base64ToBytes(parsed.ciphertextBase64);
    const aad = new TextEncoder().encode(CLOUD_KEY_AAD);

    let cryptoKey: CryptoKey;
    if (parsed.mode === 'pbkdf2' && typeof parsed.saltBase64 === 'string') {
      cryptoKey = await deriveFallbackOriginKey(base64ToBytes(parsed.saltBase64));
    } else {
      cryptoKey = await getOrCreateIdbCryptoKey();
    }

    const plainBuf = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as BufferSource,
        additionalData: aad as BufferSource,
        tagLength: 128,
      },
      cryptoKey,
      ciphertext as BufferSource
    );

    const apiKey = new TextDecoder().decode(plainBuf).trim();
    const models = sanitizeStoredModels(parsed.models);
    if (!apiKey) {
      return { apiKey: '', models: [] };
    }
    return { apiKey, models };
  } catch {
    return { apiKey: '', models: [] };
  }
}

export function ensureCloudKeyHydrated(): Promise<{
  apiKey: string;
  models: CloudModelOption[];
}> {
  if (hydrated) {
    return Promise.resolve({
      apiKey: cachedPlainApiKey,
      models: cachedVerifiedModels,
    });
  }
  if (!hydrationPromise) {
    hydrationPromise = readAndDecryptStoredEnvelope()
      .then((res) => {
        cachedPlainApiKey = res.apiKey;
        cachedVerifiedModels = res.models;
        hydrated = true;
        hydrationPromise = null;
        notifyListeners();
        return res;
      })
      .catch(() => {
        cachedPlainApiKey = '';
        cachedVerifiedModels = [];
        hydrated = true;
        hydrationPromise = null;
        return { apiKey: '', models: [] };
      });
  }
  return hydrationPromise;
}

export function getCachedCloudApiKey(): string {
  return cachedPlainApiKey;
}

export function getCachedCloudModels(): CloudModelOption[] {
  return cachedVerifiedModels;
}

export function hasVerifiedCloudApiKey(): boolean {
  return Boolean(cachedPlainApiKey && cachedVerifiedModels.length > 0);
}

export async function saveVerifiedCloudApiKey(
  apiKey: string,
  models: CloudModelOption[]
): Promise<void> {
  const cleanKey = apiKey.trim();
  const cleanModels = sanitizeStoredModels(models);

  cachedPlainApiKey = cleanKey;
  cachedVerifiedModels = cleanModels;
  hydrated = true;

  if (
    cleanKey &&
    typeof localStorage !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    crypto.subtle
  ) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(CLOUD_KEY_AAD);
    const plainBytes = new TextEncoder().encode(cleanKey);

    let mode: 'idb' | 'pbkdf2' = 'idb';
    let saltBase64: string | undefined;
    let cryptoKey: CryptoKey;

    try {
      cryptoKey = await getOrCreateIdbCryptoKey();
    } catch {
      mode = 'pbkdf2';
      const salt = crypto.getRandomValues(new Uint8Array(16));
      saltBase64 = bytesToBase64(salt);
      cryptoKey = await deriveFallbackOriginKey(salt);
    }

    const cipherBuf = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv as BufferSource,
        additionalData: aad as BufferSource,
        tagLength: 128,
      },
      cryptoKey,
      plainBytes as BufferSource
    );

    const envelope: EncryptedCloudKeyEnvelopeV1 = {
      version: 1,
      mode,
      ivBase64: bytesToBase64(iv),
      ...(saltBase64 ? { saltBase64 } : {}),
      ciphertextBase64: bytesToBase64(new Uint8Array(cipherBuf)),
      models: cleanModels,
      verifiedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(CLOUD_KEY_VAULT_STORAGE_KEY, JSON.stringify(envelope));
    } catch {
      // ignore storage quota errors while preserving in-memory session
    }
  }

  notifyListeners();
}

export function purgeCloudKeyStorageSync(): void {
  cachedPlainApiKey = '';
  cachedVerifiedModels = [];
  hydrated = true;

  try {
    localStorage.removeItem(CLOUD_KEY_VAULT_STORAGE_KEY);
  } catch {
    // ignore
  }

  try {
    if (typeof indexedDB !== 'undefined') {
      indexedDB.deleteDatabase(CLOUD_KEY_IDB_NAME);
    }
  } catch {
    // ignore
  }

  notifyListeners();
}

export async function clearSavedCloudApiKey(): Promise<void> {
  purgeCloudKeyStorageSync();
}
