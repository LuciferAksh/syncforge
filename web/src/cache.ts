import { mergeUpdates } from 'yjs';
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('syncforge-device-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('cache');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('cache', 'readonly').objectStore('cache').get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}
export async function cachePut(key: string, value: unknown) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('cache', 'readwrite');
    transaction.objectStore('cache').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export async function cacheDelete(key: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('cache', 'readwrite');
    transaction.objectStore('cache').delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
export async function cacheMergeDocument(key: string, update: Uint8Array) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('cache', 'readwrite'),
      store = transaction.objectStore('cache'),
      request = store.get(key);
    request.onsuccess = () => {
      try {
        store.put(request.result ? mergeUpdates([request.result as Uint8Array, update]) : update, key);
      } catch {
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
