// ActoMind – IndexedDB wrapper (scripts, progress, sessions, rehearsals, recordings, audio exports, TTS cache, meta).

const DB_NAME = 'actomind';
const DB_VERSION = 1;
let dbPromise = null;

export const STORES = {
  scripts: { keyPath: 'id' },
  progress: { keyPath: 'id' },
  sessions: { keyPath: 'id', indexes: ['scriptId'] },
  rehearsals: { keyPath: 'id', indexes: ['scriptId'] },
  recordings: { keyPath: 'id', indexes: ['scriptId'] },
  audioExports: { keyPath: 'id', indexes: ['scriptId'] },
  tts: { keyPath: 'key' },
  meta: { keyPath: 'key' },
};

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB not available'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const os = db.createObjectStore(name, { keyPath: def.keyPath });
        for (const ix of def.indexes || []) os.createIndex(ix, ix);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked – close other ActoMind tabs'));
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    Promise.resolve(fn(os)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export const db = {
  get: (store, key) => tx(store, 'readonly', (os) => promisify(os.get(key))),
  put: (store, value) => tx(store, 'readwrite', (os) => promisify(os.put(value))),
  delete: (store, key) => tx(store, 'readwrite', (os) => promisify(os.delete(key))),
  all: (store) => tx(store, 'readonly', (os) => promisify(os.getAll())),
  keys: (store) => tx(store, 'readonly', (os) => promisify(os.getAllKeys())),
  clear: (store) => tx(store, 'readwrite', (os) => promisify(os.clear())),
  count: (store) => tx(store, 'readonly', (os) => promisify(os.count())),
  byIndex: (store, index, value) => tx(store, 'readonly', (os) => promisify(os.index(index).getAll(value))),
  async deleteByIndex(store, index, value) {
    const items = await db.byIndex(store, index, value);
    const key = STORES[store].keyPath;
    await tx(store, 'readwrite', (os) => Promise.all(items.map((it) => promisify(os.delete(it[key])))));
    return items.length;
  },
  async putMany(store, values) {
    return tx(store, 'readwrite', (os) => Promise.all(values.map((v) => promisify(os.put(v)))));
  },
};

/** Estimate of storage usage (if supported). */
export async function storageEstimate() {
  try {
    if (navigator.storage?.estimate) return await navigator.storage.estimate();
  } catch { /* ignore */ }
  return null;
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) return await navigator.storage.persist();
    return true;
  } catch { return false; }
}
