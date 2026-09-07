/**
 * The device's own copy, in IndexedDB.
 *
 * Small on purpose: three object stores — the answers the app has already been
 * given, a handful of facts about the copy itself (when it was last filled, what
 * it holds), and the writes it has not managed to send yet. No dependency — a
 * wrapper this size is easier to read than the library that would replace it,
 * and the bundle carries no provider key or storage SDK (Technical
 * Constraints §13.7).
 *
 * Everything here is per-browser. Nothing is encrypted, so nothing that is not
 * already on the household's own screen may be written: see offline/policy.ts,
 * which decides that and is the only thing allowed to call `put`.
 */

const DB = 'epic-offline';
// What the database was called before the rebrand. A copy under the old name is
// moved across the first time this one is opened and then deleted: the outbox
// can hold writes the household made and the server has never seen, so a rename
// that simply orphaned it would lose them.
const OLD_DB = 'roam-offline';
// 2: the outbox (offline/outbox.ts). Opening an older copy adds the store and
// keeps everything already saved — an upgrade must never cost the household the
// atlas they filled at home.
const VERSION = 2;
const ANSWERS = 'answers';
const META = 'meta';
const OUTBOX = 'outbox';

export type Answer<T = unknown> = { path: string; body: T; savedAt: string };

/**
 * A write that has not reached the API yet.
 *
 * `id` auto-increments, so reading the store in key order replays them in the
 * order they were made — which matters when two of them touch the same trip.
 */
export type Pending = {
  id?: number;
  method: string;
  path: string;
  body: unknown;
  queuedAt: string;
  tries: number;
  /** Why it last did not go. Kept for the line Settings shows. */
  lastError?: string | null;
  /** The server said no, not "not now". Kept anyway: see outbox.ts. */
  rejected?: boolean;
};

const available = () => typeof indexedDB !== 'undefined';

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (!available()) return Promise.resolve(null);
  if (opening) return opening;
  opening = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB, VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ANSWERS)) db.createObjectStore(ANSWERS, { keyPath: 'path' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => { const db = req.result; adopt(db).then(() => resolve(db), () => resolve(db)); };
    // A browser in private mode, or one that has run out of room, simply has no
    // offline copy. The app must still work, so this never throws.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return opening;
}

/**
 * Move a copy left behind under the old name into this one, once.
 *
 * Answers are re-fetchable and meta is small, but the outbox is not: it holds
 * writes the household has made that the server has never seen. Existing
 * records win, so running this twice cannot undo anything, and a failure at any
 * point leaves the old database in place to be tried again next time.
 */
async function adopt(db: IDBDatabase): Promise<void> {
  if (!available() || typeof indexedDB.databases !== 'function') return;
  const done = await new Promise<boolean>((resolve) => {
    let r: IDBRequest;
    try { r = db.transaction(META, 'readonly').objectStore(META).get('adoptedFrom'); } catch { resolve(true); return; }
    r.onsuccess = () => resolve(Boolean(r.result));
    r.onerror = () => resolve(true);
  });
  if (done) return;
  const names = await indexedDB.databases().then((l) => l.map((d) => d.name)).catch(() => [] as (string | undefined)[]);
  if (!names.includes(OLD_DB)) { await mark(db); return; }

  const old = await new Promise<IDBDatabase | null>((resolve) => {
    let r: IDBOpenDBRequest;
    try { r = indexedDB.open(OLD_DB); } catch { resolve(null); return; }
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
    // An old copy that predates the outbox must not be upgraded here: read what
    // stores it has and leave the rest alone.
    r.onupgradeneeded = () => { try { r.transaction?.abort(); } catch { /* nothing to read */ } resolve(null); };
  });
  if (!old) { await mark(db); return; }

  for (const store of [ANSWERS, META, OUTBOX]) {
    if (!old.objectStoreNames.contains(store) || !db.objectStoreNames.contains(store)) continue;
    const rows = await new Promise<{ key: IDBValidKey; value: unknown }[]>((resolve) => {
      const out: { key: IDBValidKey; value: unknown }[] = [];
      let cur: IDBRequest<IDBCursorWithValue | null>;
      try { cur = old.transaction(store, 'readonly').objectStore(store).openCursor(); } catch { resolve([]); return; }
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) { resolve(out); return; }
        out.push({ key: c.key, value: c.value });
        c.continue();
      };
      cur.onerror = () => resolve(out);
    });
    if (!rows.length) continue;
    await new Promise<void>((resolve) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(store, 'readwrite'); } catch { resolve(); return; }
      const os = tx.objectStore(store);
      for (const { key, value } of rows) {
        // Anything already written under the new name is the newer truth, so
        // `add` — which fails on a clash rather than overwriting — is right for
        // answers and meta. An outbox row drops its old id and takes a fresh
        // one, because the two databases numbered from 1 independently and a
        // clash there would throw away a write nobody has sent yet.
        const row = store === OUTBOX ? { ...(value as Pending), id: undefined } : value;
        try { (os as IDBObjectStore).add(row as never, os.keyPath ? undefined : key); } catch { /* keep going */ }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  }
  old.close();
  await mark(db);
  try { indexedDB.deleteDatabase(OLD_DB); } catch { /* it will be tidied next time */ }
}

const mark = (db: IDBDatabase) => new Promise<void>((resolve) => {
  let tx: IDBTransaction;
  try { tx = db.transaction(META, 'readwrite'); } catch { resolve(); return; }
  try { tx.objectStore(META).put(new Date().toISOString(), 'adoptedFrom'); } catch { /* nothing to record */ }
  tx.oncomplete = () => resolve();
  tx.onerror = () => resolve();
  tx.onabort = () => resolve();
});

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return open().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      let req: IDBRequest;
      try { req = fn(db.transaction(store, mode).objectStore(store)); } catch { resolve(null); return; }
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    });
  });
}

export const getAnswer = <T,>(path: string) => run<Answer<T>>(ANSWERS, 'readonly', (s) => s.get(path));
export const putAnswer = <T,>(path: string, body: T) =>
  run<IDBValidKey>(ANSWERS, 'readwrite', (s) => s.put({ path, body, savedAt: new Date().toISOString() } satisfies Answer<T>));
export const allAnswers = () => run<Answer[]>(ANSWERS, 'readonly', (s) => s.getAll()).then((a) => a ?? []);
export const answerPaths = () => run<IDBValidKey[]>(ANSWERS, 'readonly', (s) => s.getAllKeys()).then((k) => (k ?? []).map(String));
export const forgetAnswer = (path: string) => run(ANSWERS, 'readwrite', (s) => s.delete(path));
export const forgetEverything = () => run(ANSWERS, 'readwrite', (s) => s.clear());

// --- the outbox ------------------------------------------------------------
// `run` resolves null when there is no IndexedDB at all, and the outbox is the
// one store where that has to be told apart from "written": a write we cannot
// even queue must be reported to the household, not swallowed.

export const putPending = (p: Pending) => run<IDBValidKey>(OUTBOX, 'readwrite', (s) => (p.id == null ? s.add(p) : s.put(p)));
export const allPending = () => run<Pending[]>(OUTBOX, 'readonly', (s) => s.getAll()).then((r) => r ?? []);
export const forgetPending = (id: number) => run(OUTBOX, 'readwrite', (s) => s.delete(id));
export const countPending = () => run<number>(OUTBOX, 'readonly', (s) => s.count()).then((n) => n ?? 0);

export const getMeta = <T,>(key: string) => run<T>(META, 'readonly', (s) => s.get(key));
export const setMeta = <T,>(key: string, value: T) => run(META, 'readwrite', (s) => s.put(value, key));

/** How much room the copy is taking, when the browser will say. */
export async function roomUsed(): Promise<{ usedBytes: number | null; quotaBytes: number | null }> {
  try {
    const e = await (navigator as any)?.storage?.estimate?.();
    return { usedBytes: e?.usage ?? null, quotaBytes: e?.quota ?? null };
  } catch { return { usedBytes: null, quotaBytes: null }; }
}

/**
 * Ask the browser not to evict the copy when it is short of room. Chrome grants
 * this silently to an installed app; Safari asks. Either way it is a request,
 * not a guarantee, which is why nothing irreplaceable is ever only here.
 */
export async function keepCopy(): Promise<boolean> {
  try { return Boolean(await (navigator as any)?.storage?.persist?.()); } catch { return false; }
}

export const offlineStorageAvailable = available;
