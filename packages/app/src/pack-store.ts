/**
 * Where the content pack lives between visits.
 *
 * IndexedDB rather than localStorage: a pack is megabytes of JSON, and
 * localStorage is a small string store shared with everything else on the
 * origin. Nothing leaves the browser — there is no server to send it to, which
 * is the property that makes shipping a public site with private content work
 * at all (ADR-0001, ADR-0002).
 *
 * Every call degrades rather than throws. A private window, a cleared profile
 * and a browser that refuses IndexedDB all mean the same thing here: the pack
 * has to be uploaded again, and the app has to stay usable while saying so.
 */

const DB_NAME = 'agorath-builder';
const STORE = 'pack';
const KEY = 'active';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused to open'));
  });
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
        transaction.oncomplete = () => db.close();
      }),
  );
}

/** Keep the pack file's text, exactly as it was uploaded. */
export async function savePack(text: string): Promise<boolean> {
  try {
    await withStore('readwrite', (store) => store.put(text, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function loadPack(): Promise<string | null> {
  try {
    const text = await withStore<string | undefined>('readonly', (store) => store.get(KEY) as IDBRequest<string | undefined>);
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

export async function clearPack(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(KEY));
  } catch {
    // Nothing to do: the pack is already gone as far as this browser is concerned.
  }
}
