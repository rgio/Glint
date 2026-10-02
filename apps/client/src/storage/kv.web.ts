import type { KeyValueStorage } from './types';

// expo-sqlite on web needs COOP/COEP headers, which would get in the way of
// cross-origin podcast audio and artwork, so web uses IndexedDB directly.
const DB_NAME = 'podcast';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = op(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Static rendering runs in Node, where there is no IndexedDB: read nothing, write nowhere.
const available = typeof indexedDB !== 'undefined';

export const kv: KeyValueStorage = {
  async getItem(key) {
    if (!available) return null;
    const value = await run<unknown>('readonly', (s) => s.get(key));
    return typeof value === 'string' ? value : null;
  },
  async setItem(key, value) {
    if (available) await run('readwrite', (s) => s.put(value, key));
  },
  async removeItem(key) {
    if (available) await run('readwrite', (s) => s.delete(key));
  },
};
