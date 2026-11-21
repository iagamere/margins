import { useApp } from '../store/useApp';
import { deleteBookFile, getFile, putBookRecord, putFile } from './db';
import { deleteFile, downloadFile, listAppFiles, uploadFile } from './drive';
import { TRIM_VERSION } from './trim';
import { baseName, uid } from './utils';
import type { BookRecord } from './types';

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
  return { inDrive: remote.length, added };
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
