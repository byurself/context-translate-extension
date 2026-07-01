import type { TranslationResult } from './types';

const DB_NAME = 'context-translate-cache';
const DB_VERSION = 1;
const STORE_NAME = 'translations';

interface CachedTranslation extends TranslationResult {
  key: string;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedTranslation(
  key: string,
  maxAgeMs?: number,
): Promise<CachedTranslation | undefined> {
  const db = await openDb();

  const cached = await new Promise<CachedTranslation | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as CachedTranslation);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });

  if (!cached) {
    return undefined;
  }

  if (isExpired(cached.createdAt, maxAgeMs)) {
    await deleteCachedTranslation(key).catch(() => undefined);
    return undefined;
  }

  return cached;
}

export async function setCachedTranslation(
  item: CachedTranslation,
): Promise<void> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export function createCacheKey(parts: string[]): string {
  return hashText(parts.join('\u001f'));
}

async function deleteCachedTranslation(key: string): Promise<void> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

function isExpired(createdAt: number, maxAgeMs?: number) {
  return (
    typeof maxAgeMs === 'number' &&
    maxAgeMs > 0 &&
    Date.now() - createdAt > maxAgeMs
  );
}

function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}
