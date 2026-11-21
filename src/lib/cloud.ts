import { useApp } from '../store/useApp';
import { deleteAnnotation, deleteBookFile, getAnnotations, getFile, kvGet, kvSet, putAnnotation, putBookRecord, putFile, saveShelves } from './db';
import { deleteFile, downloadFile, findFile, listAppFiles, uploadFile, type RemoteFile } from './drive';
import { TRIM_VERSION } from './trim';
import { baseName, uid } from './utils';
import type { AnnotationRecord, BookRecord, Settings, ShelfRecord } from './types';

const MIME = { epub: 'application/epub+zip', pdf: 'application/pdf' } as const;

const msg = (e: unknown) => (e as { message?: string })?.message || String(e);

/** uploads one after another: a phone must not push ten books at once */
let queue: Promise<unknown> = Promise.resolve();
export function queueUpload(id: string) {
  queue = queue.then(() => uploadBookToDrive(id)).catch(() => undefined);
}

export async function uploadBookToDrive(id: string): Promise<void> {
  const st = useApp.getState();
  const book = st.books.find((b) => b.id === id);
  if (!book || book.remoteOnly || book.cloudId || st.transfers[id]) return;
  const blob = await getFile(id);
  if (!blob) return;
  st.setTransfer(id, { kind: 'up', pct: 0 });
  try {
    let coverId = book.coverCloudId;
    if (book.cover && !coverId) coverId = await uploadFile(`${book.hash}.jpg`, book.cover, 'image/jpeg', { k: 'cover', h: book.hash }, '');
    const meta = JSON.stringify({ title: book.title, author: book.author, format: book.format, size: book.size, language: book.language, rtl: book.rtl, pages: book.pages, addedAt: book.addedAt, fileName: book.fileName });
    const fileId = await uploadFile(`${book.hash}.${book.format}`, blob, MIME[book.format], { k: 'book', h: book.hash }, meta, (f) => useApp.getState().setTransfer(id, { kind: 'up', pct: f }));
    useApp.getState().updateBook(id, { cloudId: fileId, coverCloudId: coverId });
    scheduleStateUpload(id, 2000);
  } catch (e) {
    useApp.getState().toast('cloud.uploadFailed', 'error', { name: book.title, msg: msg(e) });
  } finally {
    useApp.getState().setTransfer(id, null);
  }
}

/** Uploads every book of this device that is not in Drive yet (manual, from the Account screen). */
export async function uploadAllLocal(): Promise<number> {
  const todo = useApp.getState().books.filter((b) => !b.remoteOnly && !b.cloudId);
  todo.forEach((b) => queueUpload(b.id));
  return todo.length;
}

export async function downloadBookFromDrive(id: string): Promise<void> {
  const st = useApp.getState();
  const book = st.books.find((b) => b.id === id);
  if (!book?.cloudId || st.transfers[id]) return;
  st.setTransfer(id, { kind: 'down', pct: 0 });
  try {
    const blob = await downloadFile(book.cloudId, book.size, (f) => useApp.getState().setTransfer(id, { kind: 'down', pct: f }));
    await putFile(id, blob);
    useApp.getState().updateBook(id, { remoteOnly: false });
  } catch (e) {
    const q = (e as { code?: string })?.code === 'quota';
    useApp.getState().toast(q ? 'err.quota' : 'cloud.downloadFailed', 'error', { name: book.title, msg: msg(e) });
  } finally {
    useApp.getState().setTransfer(id, null);
  }
}

/** Removes the copy in Drive; the book stays on this device. */
export async function removeFromDrive(id: string): Promise<void> {
  const book = useApp.getState().books.find((b) => b.id === id);
  if (!book?.cloudId) return;
  try {
    await deleteFile(book.cloudId);
    if (book.coverCloudId) await deleteFile(book.coverCloudId);
    useApp.getState().updateBook(id, { cloudId: undefined, coverCloudId: undefined });
  } catch (e) {
    useApp.getState().toast('cloud.uploadFailed', 'error', { name: book.title, msg: msg(e) });
  }
}

/** Reads the Drive library: books we do not have appear as "Drive only" with their cover. */
export async function syncFromDrive(): Promise<{ inDrive: number; added: number }> {
  const files = await listAppFiles();
  const covers = new Map(files.filter((f) => f.props.k === 'cover').map((f) => [f.props.h, f]));
  const remote = files.filter((f) => f.props.k === 'book' && f.props.h);
  let added = 0;
  for (const f of remote) {
    const hash = f.props.h;
    const local = useApp.getState().books.find((b) => b.hash === hash);
    const cov = covers.get(hash);
    if (local) {
      if (local.cloudId !== f.id || (cov && local.coverCloudId !== cov.id)) useApp.getState().updateBook(local.id, { cloudId: f.id, coverCloudId: cov?.id });
      continue;
    }
    let meta: Record<string, any> = {};
    try {
      meta = f.description ? JSON.parse(f.description) : {};
    } catch {
      /* details are optional */
    }
    let cover: Blob | undefined;
    if (cov) {
      try {
        cover = await downloadFile(cov.id);
      } catch {
        /* the placeholder cover is used */
      }
    }
    const format: BookRecord['format'] = meta.format === 'pdf' || f.name.endsWith('.pdf') ? 'pdf' : 'epub';
    const rec: BookRecord = {
      id: uid(),
      hash,
      format,
      title: meta.title || baseName(meta.fileName || f.name),
      author: meta.author || undefined,
      fileName: meta.fileName || f.name,
      size: f.size ?? meta.size ?? 0,
      addedAt: meta.addedAt || Date.now(),
      percentage: 0,
      finished: false,
      cover,
      coverTrimmed: true,
      coverTrimV: TRIM_VERSION,
      language: meta.language || undefined,
      rtl: meta.rtl || undefined,
      pages: meta.pages || undefined,
      cloudId: f.id,
      coverCloudId: cov?.id,
      remoteOnly: true,
    };
    await putBookRecord(rec);
    useApp.setState({ books: [rec, ...useApp.getState().books] });
    added++;
  }

  // reading state (progress, bookmarks, notes) and library layout (shelves, settings)
  const states = new Map(files.filter((f) => f.props.k === 'state' && f.props.h).map((f) => [f.props.h, f]));
  states.forEach((f, h) => stateIds.set(h, f.id));
  for (const b of useApp.getState().books) {
    if (!b.cloudId) continue;
    const f = states.get(b.hash);
    try {
      if (f) {
        if (f.props.u !== b.stateU) await applyRemoteState(b.id, f);
      } else {
        // first time this book's state goes to Drive (nothing is sent when there is nothing to send)
        scheduleStateUpload(b.id, 2000);
      }
    } catch {
      /* one book's state must not stop the others */
    }
  }
  try {
    await syncLibraryFile(files.find((f) => f.props.k === 'library'));
  } catch {
    /* the layout is retried at the next sync */
  }
  armed = true;
  return { inDrive: remote.length, added };
}

/* ======================= reading state & library layout ======================= */

/** while remote data is being written into the store, the change watcher must not send it straight back */
let muted = false;
let armed = false;
const stateIds = new Map<string, string>();
const lastSent = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let libTimer: ReturnType<typeof setTimeout> | undefined;
let stateQueue: Promise<unknown> = Promise.resolve();
let libraryId: string | undefined;

interface BookState {
  v: 1;
  updatedAt: number;
  lastOpenedAt: number;
  location?: string;
  percentage: number;
  finished: boolean;
  pdfReflow?: boolean;
  annotations: AnnotationRecord[];
  deleted: Record<string, number>;
}

export function scheduleStateUpload(id: string, delay = 12000) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      stateQueue = stateQueue.then(() => uploadState(id)).catch(() => undefined);
    }, delay)
  );
}

/** Sends every pending state right away (reader closed, app going to the background). */
export function flushStateUploads() {
  for (const id of [...timers.keys()]) scheduleStateUpload(id, 0);
  if (libTimer) scheduleLibraryUpload(0);
}

async function uploadState(id: string): Promise<void> {
  const st = useApp.getState();
  const book = st.books.find((b) => b.id === id);
  if (!st.account || !book?.cloudId) return;
  const annotations = await getAnnotations(id);
  const deleted = book.annDeleted ?? {};
  if (!annotations.length && !Object.keys(deleted).length && !book.percentage && !book.finished) return;
  const body: BookState = {
    v: 1,
    updatedAt: Date.now(),
    lastOpenedAt: book.lastOpenedAt ?? 0,
    location: book.location,
    percentage: book.percentage,
    finished: book.finished,
    pdfReflow: book.pdfReflow,
    annotations,
    deleted,
  };
  const fingerprint = JSON.stringify({ ...body, updatedAt: 0 });
  if (lastSent.get(id) === fingerprint) return;
  try {
    let fileId = stateIds.get(book.hash);
    if (!fileId) fileId = (await findFile('state', book.hash))?.id;
    const u = String(body.updatedAt);
    const newId = await uploadFile(`${book.hash}.state.json`, new Blob([JSON.stringify(body)], { type: 'application/json' }), 'application/json', { k: 'state', h: book.hash, u }, '', undefined, fileId);
    stateIds.set(book.hash, newId);
    lastSent.set(id, fingerprint);
    muted = true;
    try {
      useApp.getState().updateBook(id, { stateU: u });
    } finally {
      muted = false;
    }
  } catch (e) {
    useApp.getState().toast('cloud.syncFailed', 'error', { msg: msg(e) });
  }
}

/** Merges the state saved in Drive into this device: newest progress wins, bookmarks and notes are united. */
async function applyRemoteState(id: string, file: RemoteFile): Promise<void> {
  const remote = JSON.parse(await (await downloadFile(file.id)).text()) as BookState;
  const book = useApp.getState().books.find((b) => b.id === id);
  if (!book || !remote || remote.v !== 1) return;
  const local = await getAnnotations(id);

  const tomb: Record<string, number> = { ...(remote.deleted ?? {}) };
  for (const [k, ts] of Object.entries(book.annDeleted ?? {})) tomb[k] = Math.max(tomb[k] ?? 0, ts);
  const merged = new Map<string, AnnotationRecord>();
  // annotation ids are global, but `bookId` is this device's id of the book
  for (const a of remote.annotations ?? []) merged.set(a.id, { ...a, bookId: id });
  for (const a of local) {
    const r = merged.get(a.id);
    if (!r || a.updatedAt >= r.updatedAt) merged.set(a.id, a);
  }
  for (const [aid, a] of [...merged]) if ((tomb[aid] ?? 0) >= a.updatedAt) merged.delete(aid);

  muted = true;
  try {
    const localById = new Map(local.map((a) => [a.id, a]));
    for (const a of merged.values()) {
      const l = localById.get(a.id);
      if (!l || l.updatedAt !== a.updatedAt) await putAnnotation(a);
    }
    for (const a of local) if (!merged.has(a.id)) await deleteAnnotation(a.id);

    const patch: Partial<BookRecord> = { annDeleted: tomb, stateU: file.props.u };
    if ((remote.lastOpenedAt ?? 0) > (book.lastOpenedAt ?? 0)) {
      Object.assign(patch, { location: remote.location, percentage: remote.percentage, finished: remote.finished, pdfReflow: remote.pdfReflow, lastOpenedAt: remote.lastOpenedAt });
    }
    useApp.getState().updateBook(id, patch);
  } finally {
    muted = false;
  }

  // this device had newer data than Drive: send it back
  const remoteKeys = new Set((remote.annotations ?? []).map((a) => a.id + ':' + a.updatedAt));
  const differs = [...merged.values()].some((a) => !remoteKeys.has(a.id + ':' + a.updatedAt)) || Object.keys(tomb).some((k) => !(k in (remote.deleted ?? {}))) || (book.lastOpenedAt ?? 0) > (remote.lastOpenedAt ?? 0);
  if (differs) scheduleStateUpload(id, 3000);
}

/** The reader saved or edited a bookmark/note/highlight. */
export function noteAnnotationsChanged(bookId: string) {
  if (useApp.getState().account) scheduleStateUpload(bookId, 6000);
}

/** The reader deleted one: remember it so the other devices drop it too. */
export function noteAnnotationDeleted(bookId: string, annId: string) {
  const st = useApp.getState();
  const book = st.books.find((b) => b.id === bookId);
  if (!book) return;
  muted = true;
  try {
    st.updateBook(bookId, { annDeleted: { ...(book.annDeleted ?? {}), [annId]: Date.now() } });
  } finally {
    muted = false;
  }
  noteAnnotationsChanged(bookId);
}

/* ---- shelves + settings: one small file for the whole library ---- */

interface LibraryState {
  v: 1;
  updatedAt: number;
  shelves: Omit<ShelfRecord, 'image'>[];
  assign: Record<string, string>;
  settings: Partial<Settings>;
}

export function scheduleLibraryUpload(delay = 15000) {
  clearTimeout(libTimer);
  libTimer = setTimeout(() => {
    libTimer = undefined;
    stateQueue = stateQueue.then(uploadLibrary).catch(() => undefined);
  }, delay);
}

async function uploadLibrary(): Promise<void> {
  const st = useApp.getState();
  if (!st.account) return;
  const assign: Record<string, string> = {};
  for (const b of st.books) if (b.shelfId) assign[b.hash] = b.shelfId;
  const settings: Partial<Settings> = { ...st.settings };
  delete settings.cloudAutoUpload;
  const body: LibraryState = { v: 1, updatedAt: Date.now(), shelves: st.shelves.map(({ image: _image, ...s }) => s), assign, settings };
  try {
    const existing = libraryId ?? (await findFile('library'))?.id;
    libraryId = await uploadFile('library.json', new Blob([JSON.stringify(body)], { type: 'application/json' }), 'application/json', { k: 'library', u: String(body.updatedAt) }, '', undefined, existing);
    await kvSet('cloudLibU', body.updatedAt);
  } catch (e) {
    useApp.getState().toast('cloud.syncFailed', 'error', { msg: msg(e) });
  }
}

async function syncLibraryFile(file: RemoteFile | undefined): Promise<void> {
  libraryId = file?.id ?? libraryId;
  const localAt = (await kvGet<number>('cloudLibLocalAt')) ?? 0;
  const syncedU = (await kvGet<number>('cloudLibU')) ?? 0;
  const remoteU = Number(file?.props.u ?? 0);
  if (file && remoteU > localAt && remoteU !== syncedU) {
    const remote = JSON.parse(await (await downloadFile(file.id)).text()) as LibraryState;
    if (remote?.v !== 1) return;
    muted = true;
    try {
      const st = useApp.getState();
      const shelves = (remote.shelves ?? []).map((rs) => ({ ...(st.shelves.find((l) => l.id === rs.id) ?? {}), ...rs })) as ShelfRecord[];
      useApp.setState({ shelves });
      await saveShelves(shelves);
      for (const b of useApp.getState().books) {
        const want = remote.assign?.[b.hash];
        const valid = want && shelves.some((s) => s.id === want) ? want : undefined;
        if (b.shelfId !== valid && (want || b.shelfId)) useApp.getState().updateBook(b.id, { shelfId: valid });
      }
      useApp.getState().setSettings({ ...remote.settings, cloudAutoUpload: st.settings.cloudAutoUpload });
      await kvSet('cloudLibU', remoteU);
    } finally {
      muted = false;
    }
  } else if (!file || localAt > remoteU) {
    await uploadLibrary();
  }
}

let watching = false;
/** Watches the store while signed in: progress, shelves and settings changes are queued for Drive. */
export function startCloudWatch() {
  if (watching) return;
  watching = true;
  useApp.subscribe((s, prev) => {
    if (muted || !armed || !s.account) return;
    let libChanged = s.shelves !== prev.shelves || s.settings !== prev.settings;
    if (s.books !== prev.books) {
      const before = new Map(prev.books.map((b) => [b.id, b]));
      for (const b of s.books) {
        const p = before.get(b.id);
        if (!p || !b.cloudId) continue;
        if (b.location !== p.location || b.percentage !== p.percentage || b.finished !== p.finished || b.pdfReflow !== p.pdfReflow) scheduleStateUpload(b.id);
        if (b.shelfId !== p.shelfId) libChanged = true;
      }
    }
    if (libChanged) {
      void kvSet('cloudLibLocalAt', Date.now());
      scheduleLibraryUpload();
    }
  });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushStateUploads());
}

/**
 * "Read online": the book comes down as a temporary copy, opens in the reader and is deleted from the
 * device when the reader closes (or at the next app start). Returns true when the reader can open it.
 */
export async function readOnline(id: string): Promise<boolean> {
  const st = useApp.getState();
  const book = st.books.find((b) => b.id === id);
  if (!book?.cloudId || st.transfers[id]) return false;
  st.setTransfer(id, { kind: 'down', pct: 0 });
  try {
    const blob = await downloadFile(book.cloudId, book.size, (f) => useApp.getState().setTransfer(id, { kind: 'down', pct: f }));
    await putFile(id, blob);
    useApp.getState().updateBook(id, { tempRead: true });
    return true;
  } catch (e) {
    const q = (e as { code?: string })?.code === 'quota';
    useApp.getState().toast(q ? 'err.quota' : 'cloud.downloadFailed', 'error', { name: book.title, msg: msg(e) });
    return false;
  } finally {
    useApp.getState().setTransfer(id, null);
  }
}

/** Deletes the temporary copy of a "read online" book; the record, position and notes stay. */
export async function discardTempRead(id: string): Promise<void> {
  const book = useApp.getState().books.find((b) => b.id === id);
  if (!book?.tempRead || !book.remoteOnly) return;
  // still open in the reader (e.g. a quick re-mount): keep the file
  const r = useApp.getState().route;
  if (r.name === 'reader' && r.id === id) return;
  try {
    await deleteBookFile(id);
    useApp.getState().updateBook(id, { tempRead: false });
  } catch {
    /* it is retried at the next app start */
  }
}

/** App start: temporary copies left behind by a closed app are removed. */
export function discardAllTempReads() {
  useApp.getState().books.filter((b) => b.tempRead && b.remoteOnly).forEach((b) => void discardTempRead(b.id));
}
