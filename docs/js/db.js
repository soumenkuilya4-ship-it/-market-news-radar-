// Offline article cache: IndexedDB, falling back to localStorage.
const DB_NAME = 'market-radar';
const STORE = 'articles';
const LS_KEY = 'mr.articles';
export const OFFLINE_LIMIT = 100;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('publishedAt', 'publishedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function newestFirst(list) {
  return list.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

/** Load cached articles (newest first). */
export async function loadArticles() {
  try {
    const db = await openDb();
    const all = await tx(db, 'readonly', (os) => os.getAll());
    return newestFirst(all || []);
  } catch {
    try { return newestFirst(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch { return []; }
  }
}

/**
 * Replace the cache with the newest `OFFLINE_LIMIT` articles.
 * Manual posts are kept on top of that budget so they aren't pushed out by the feeds.
 */
export async function saveArticles(articles) {
  const sorted = newestFirst([...articles]);
  const keep = sorted.filter((a) => a.sourceId !== 'manual').slice(0, OFFLINE_LIMIT);
  keep.push(...sorted.filter((a) => a.sourceId === 'manual').slice(0, 50));
  try {
    const db = await openDb();
    await tx(db, 'readwrite', (os) => {
      os.clear();
      for (const a of keep) os.put(a);
    });
  } catch {
    try { localStorage.setItem(LS_KEY, JSON.stringify(keep)); } catch { /* quota */ }
  }
  return keep.length;
}

export async function clearArticles() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  try {
    const db = await openDb();
    await tx(db, 'readwrite', (os) => os.clear());
  } catch { /* ignore */ }
}
