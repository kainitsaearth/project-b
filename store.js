// store.js — IndexedDB. The ONLY module that touches the database.
// Every function returns a Promise and rejects on failure; callers decide how to surface it.

const DB_NAME = 'project-b';
const DB_VERSION = 1;

// kv holds working state under string keys; entity stores are keyed by `id`.
export const STORES = ['kv', 'sessions', 'beans', 'rigs', 'waters', 'recipes'];

// Dev hook: open with ?simulate=storefail to make every write reject.
// This is how Step 1's "deny storage" check is run reproducibly.
const SIMULATE_FAIL = new URLSearchParams(location.search).get('simulate') === 'storefail';

let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error('IndexedDB unavailable'));
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        if (name === 'kv') db.createObjectStore('kv');
        else db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Database upgrade blocked by another tab'));
  });
  // A failed open must not be cached, or the app can never recover without reload.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  if (mode === 'readwrite' && SIMULATE_FAIL) throw new Error('Simulated storage failure');
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then(v => { result = v; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export const getKV = key => tx('kv', 'readonly', s => req(s.get(key)));
export const putKV = (key, value) => tx('kv', 'readwrite', s => { s.put(value, key); });

export const get = (store, id) => tx(store, 'readonly', s => req(s.get(id)));
export const getAll = store => tx(store, 'readonly', s => req(s.getAll()));
export const put = (store, obj) => tx(store, 'readwrite', s => { s.put(obj); });
export const remove = (store, id) => tx(store, 'readwrite', s => { s.delete(id); });

// Apply many writes in ONE transaction: all land or none do.
// ops: { store, type: 'put', value, key? } | { store, type: 'delete', key }
export async function commit(ops) {
  if (!ops.length) return;
  if (SIMULATE_FAIL) throw new Error('Simulated storage failure');
  const db = await open();
  const names = [...new Set(ops.map(o => o.store))];
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, 'readwrite');
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    try {
      for (const op of ops) {
        const s = t.objectStore(op.store);
        if (op.type === 'delete') s.delete(op.key);
        else if (op.key === undefined) s.put(op.value);
        else s.put(op.value, op.key);
      }
    } catch (err) {
      // A synchronous throw would otherwise let the earlier ops auto-commit.
      t.abort();
      reject(err);
    }
  });
}

// Ask Chrome not to evict this origin's data under storage pressure.
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
