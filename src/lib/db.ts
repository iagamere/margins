import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { AppError, type AnnotationRecord, type BookRecord, type ShelfRecord } from './types';

interface MarginsDB extends DBSchema {
  books: { key: string; value: BookRecord; indexes: { 'by-hash': string } };
  files: { key: string; value: Blob };
  annotations: { key: string; value: AnnotationRecord; indexes: { 'by-book': string } };
  kv: { key: string; value: unknown };
}

const DB_NAME = 'margins';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<MarginsDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<MarginsDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MarginsDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Versioned, additive migrations. Add `if (oldVersion < 2) { ... }` blocks for future schema changes.
        if (oldVersion < 1) {
          const books = db.createObjectStore('books', { keyPath: 'id' });
          books.createIndex('by-hash', 'hash');
          db.createObjectStore('files');
          const ann = db.createObjectStore('annotations', { keyPath: 'id' });
          ann.createIndex('by-book', 'bookId');
          db.createObjectStore('kv');
        }
      },
      terminated() {
        dbPromise = null;
      },
    }).catch((e) => {
      dbPromise = null;
      throw new AppError('storageUnavailable', String(e));
    });
  }
  return dbPromise;
}

export function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; code?: number } | undefined;
  return err?.name === 'QuotaExceededError' || err?.code === 22 || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/* ---------- Books ---------- */

export async function getAllBooks(): Promise<BookRecord[]> {
  return (await getDb()).getAll('books');
}

export async function getBook(id: string): Promise<BookRecord | undefined> {
  return (await getDb()).get('books', id);
}

export async function findBookByHash(hash: string): Promise<BookRecord | undefined> {
  return (await getDb()).getFromIndex('books', 'by-hash', hash);
}

/** Stores the book record and its file atomically. */
export async function addBook(book: BookRecord, file: Blob): Promise<void> {
  const db = await getDb();
  try {
    const tx = db.transaction(['books', 'files'], 'readwrite');
    tx.objectStore('books').put(book);
    tx.objectStore('files').put(file, book.id);
    await tx.done;
  } catch (e) {
    if (isQuotaError(e)) throw new AppError('quota');
    throw e;
  }
}

export async function getFile(id: string): Promise<Blob | undefined> {
  return (await getDb()).get('files', id);
}

export async function patchBook(id: string, patch: Partial<BookRecord>): Promise<BookRecord | undefined> {
  const db = await getDb();
  const tx = db.transaction('books', 'readwrite');
  const cur = await tx.store.get(id);
  if (!cur) {
    await tx.done;
    return undefined;
  }
  const next = { ...cur, ...patch };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['books', 'files', 'annotations', 'kv'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('files').delete(id);
  tx.objectStore('kv').delete(`loc:${id}`);
  const idx = tx.objectStore('annotations').index('by-book');
  let cur = await idx.openCursor(IDBKeyRange.only(id));
  while (cur) {
    cur.delete();
    cur = await cur.continue();
  }
  await tx.done;
}

/* ---------- Annotations ---------- */

export async function getAnnotations(bookId: string): Promise<AnnotationRecord[]> {
  return (await getDb()).getAllFromIndex('annotations', 'by-book', bookId);
}

export async function putAnnotation(a: AnnotationRecord): Promise<void> {
  try {
    await (await getDb()).put('annotations', a);
  } catch (e) {
    if (isQuotaError(e)) throw new AppError('quota');
    throw e;
  }
}

export async function deleteAnnotation(id: string): Promise<void> {
  await (await getDb()).delete('annotations', id);
}

/* ---------- Key/value (small caches) ---------- */

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await getDb()).get('kv', key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('kv', value, key);
}

/* ---------- Shelves (stored in kv: no schema change) ---------- */

export async function getShelves(): Promise<ShelfRecord[]> {
  return (await kvGet<ShelfRecord[]>('shelves')) ?? [];
}

export async function saveShelves(list: ShelfRecord[]): Promise<void> {
  await kvSet('shelves', list);
}

/* ---------- Maintenance ---------- */

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['books', 'files', 'annotations', 'kv'], 'readwrite');
  await Promise.all([
    tx.objectStore('books').clear(),
    tx.objectStore('files').clear(),
    tx.objectStore('annotations').clear(),
    tx.objectStore('kv').clear(),
  ]);
  await tx.done;
}

export async function storageEstimate(): Promise<{ usage?: number; quota?: number; persisted?: boolean }> {
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    return { usage: est?.usage, quota: est?.quota, persisted };
  } catch {
    return {};
  }
}

export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* best effort */
  }
}
