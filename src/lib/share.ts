import { create } from 'zustand';
import { useApp } from '../store/useApp';
import { getFile, kvGet, kvSet } from './db';
import { createFolder, deleteFile, fetchPublicBlob, fetchPublicJson, makePublic, uploadFile } from './drive';

/**
 * Shared library ("stamp"). Drive's hidden app folder cannot be shared, so a shared library is a normal Drive
 * folder made by the app (scope drive.file) whose files are readable by anyone who knows their id.
 * The stamp is the id of a small manifest.json that lists the books; whoever holds it can browse and download.
 */
const MIME = { epub: 'application/epub+zip', pdf: 'application/pdf' } as const;
const PREFIX = 'MRG-';

export interface ShareEntry {
  /** content hash (same book = same hash on every device) */
  h: string;
  t: string;
  a?: string;
  f: 'epub' | 'pdf';
  s: number;
  l?: string;
  r?: boolean;
  p?: number;
  fn?: string;
  /** Drive id of the book file / of its cover */
  file: string;
  cover?: string;
}
export interface ShareManifest {
  v: 1;
  name: string;
  updated: number;
  books: ShareEntry[];
}
export interface ShareState {
  email: string;
  folderId: string;
  manifestId: string;
  files: Record<string, { file: string; cover?: string }>;
  updated: number;
}
export interface FriendRec {
  id: string;
  name: string;
  count: number;
  addedAt: number;
}

interface ShareStore {
  loaded: boolean;
  mine: ShareState | null;
  friends: FriendRec[];
  busy: { done: number; total: number } | null;
}
export const useShare = create<ShareStore>(() => ({ loaded: false, mine: null, friends: [], busy: null }));

const msg = (e: unknown) => (e as { message?: string })?.message || String(e);

export async function loadShare(): Promise<void> {
  if (useShare.getState().loaded) return;
  const [mine, friends] = await Promise.all([kvGet<ShareState>('share'), kvGet<FriendRec[]>('friends')]);
  useShare.setState({ loaded: true, mine: mine ?? null, friends: friends ?? [] });
}

export const stampOf = (s: ShareState) => PREFIX + s.manifestId;

export function parseStamp(input: string): string | null {
  const v = input.trim().replace(/^MRG-/i, '').replace(/\s+/g, '');
  return /^[A-Za-z0-9_-]{15,}$/.test(v) ? v : null;
}

/* ---------- my library ---------- */

async function persistMine(st: ShareState | null) {
  useShare.setState({ mine: st });
  await kvSet('share', st);
}

/** Uploads the books that are not shared yet, removes the ones that left the library, rewrites the manifest. */
export async function publishLibrary(): Promise<void> {
  const app = useApp.getState();
  const email = app.account?.email ?? '';
  if (!app.account || useShare.getState().busy) return;
  const cur = useShare.getState().mine;
  const st: ShareState = cur && cur.email === email ? { ...cur, files: { ...cur.files } } : { email, folderId: '', manifestId: '', files: {}, updated: 0 };
  useShare.setState({ busy: { done: 0, total: 0 } });
  try {
    if (!st.folderId) st.folderId = await createFolder('Margins — shared library');
    const books = app.books.filter((b) => !b.remoteOnly && !b.tempRead);
    const hashes = new Set(books.map((b) => b.hash));
    for (const [h, e] of Object.entries(st.files)) {
      if (hashes.has(h)) continue;
      await deleteFile(e.file).catch(() => undefined);
      if (e.cover) await deleteFile(e.cover).catch(() => undefined);
      delete st.files[h];
    }
    const todo = books.filter((b) => !st.files[b.hash]);
    useShare.setState({ busy: { done: 0, total: todo.length } });
    let done = 0;
    for (const b of todo) {
      const blob = await getFile(b.id);
      if (blob) {
        let cover: string | undefined;
        if (b.cover) {
          cover = await uploadFile(`${b.hash}.jpg`, b.cover, 'image/jpeg', { k: 'scover', h: b.hash }, '', undefined, undefined, st.folderId);
          await makePublic(cover);
        }
        const file = await uploadFile(`${b.hash}.${b.format}`, blob, MIME[b.format], { k: 'sbook', h: b.hash }, '', undefined, undefined, st.folderId);
        await makePublic(file);
        st.files[b.hash] = { file, cover };
        await persistMine({ ...st, files: { ...st.files } }); // partial progress survives an interruption
      }
      useShare.setState({ busy: { done: ++done, total: todo.length } });
    }
    const entries: ShareEntry[] = books
      .filter((b) => st.files[b.hash])
      .map((b) => ({ h: b.hash, t: b.title, a: b.author, f: b.format, s: b.size, l: b.language, r: b.rtl, p: b.pages, fn: b.fileName, file: st.files[b.hash].file, cover: st.files[b.hash].cover }));
    const manifest: ShareManifest = { v: 1, name: app.account.name || app.account.email, updated: Date.now(), books: entries };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    if (st.manifestId) {
      await uploadFile('manifest.json', blob, 'application/json', { k: 'smanifest' }, '', undefined, st.manifestId);
    } else {
      st.manifestId = await uploadFile('manifest.json', blob, 'application/json', { k: 'smanifest' }, '', undefined, undefined, st.folderId);
      await makePublic(st.manifestId);
    }
    st.updated = manifest.updated;
    await persistMine(st);
    app.toast('share.published', 'success', { count: entries.length });
  } catch (e) {
    const m = msg(e);
    if (st.folderId || st.manifestId) await persistMine(st).catch(() => undefined);
    app.toast(/Drive (401|403)/.test(m) ? 'share.needSignIn' : 'share.failed', 'error', { msg: m });
  } finally {
    useShare.setState({ busy: null });
  }
}

/** The stamp stops working: every shared copy, the manifest and the folder are deleted from Drive. */
export async function stopSharing(): Promise<void> {
  const st = useShare.getState().mine;
  if (!st) return;
  useShare.setState({ busy: { done: 0, total: 0 } });
  try {
    if (st.manifestId) await deleteFile(st.manifestId);
    for (const e of Object.values(st.files)) {
      await deleteFile(e.file).catch(() => undefined);
      if (e.cover) await deleteFile(e.cover).catch(() => undefined);
    }
    if (st.folderId) await deleteFile(st.folderId).catch(() => undefined);
    await persistMine(null);
  } catch (e) {
    useApp.getState().toast('share.failed', 'error', { msg: msg(e) });
  } finally {
    useShare.setState({ busy: null });
  }
}

/* ---------- friends' libraries ---------- */

const manifests = new Map<string, ShareManifest>();

export async function loadManifest(id: string, fresh = false): Promise<ShareManifest> {
  const hit = manifests.get(id);
  if (hit && !fresh) return hit;
  const m = await fetchPublicJson<ShareManifest>(id);
  if (!m || m.v !== 1 || !Array.isArray(m.books)) throw new Error('Not a Margins library');
  manifests.set(id, m);
  return m;
}

/** Validates the stamp by reading the library, then remembers it. Returns the record. */
export async function addFriend(input: string): Promise<FriendRec> {
  const id = parseStamp(input);
  if (!id) throw new Error('bad-stamp');
  const m = await loadManifest(id, true);
  const rec: FriendRec = { id, name: m.name || '', count: m.books.length, addedAt: Date.now() };
  const list = [rec, ...useShare.getState().friends.filter((f) => f.id !== id)];
  useShare.setState({ friends: list });
  await kvSet('friends', list);
  return rec;
}

export async function refreshFriend(id: string): Promise<ShareManifest> {
  const m = await loadManifest(id, true);
  const list = useShare.getState().friends.map((f) => (f.id === id ? { ...f, name: m.name || f.name, count: m.books.length } : f));
  useShare.setState({ friends: list });
  await kvSet('friends', list);
  return m;
}

export async function removeFriend(id: string): Promise<void> {
  const list = useShare.getState().friends.filter((f) => f.id !== id);
  useShare.setState({ friends: list });
  await kvSet('friends', list);
  manifests.delete(id);
}

/* ---------- covers (a few at a time) ---------- */

let active = 0;
const waiting: Array<() => void> = [];
const covers = new Map<string, Promise<string | null>>();

export function friendCover(id: string): Promise<string | null> {
  let p = covers.get(id);
  if (!p) {
    p = (async () => {
      if (active >= 4) await new Promise<void>((r) => waiting.push(r));
      active++;
      try {
        return URL.createObjectURL(await fetchPublicBlob(id));
      } catch {
        return null;
      } finally {
        active--;
        waiting.shift()?.();
      }
    })();
    covers.set(id, p);
  }
  return p;
}

/* ---------- download together ---------- */

/** Downloads the chosen books two at a time and imports them into this library in one go. Returns how many arrived. */
export async function downloadShared(entries: ShareEntry[], onProgress: (hash: string, pct: number | null) => void): Promise<number> {
  const app = useApp.getState();
  app.toast('friends.started', 'info', { count: entries.length });
  const got: File[] = [];
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < entries.length) {
      const e = entries[next++];
      onProgress(e.h, 0);
      try {
        const blob = await fetchPublicBlob(e.file, e.s, (f) => onProgress(e.h, f));
        const base = (e.fn || e.t || 'book').replace(/[\\/:*?"<>|]+/g, ' ').trim();
        const name = new RegExp(`\\.${e.f}$`, 'i').test(base) ? base : `${base}.${e.f}`;
        got.push(new File([blob], name, { type: MIME[e.f] }));
      } catch (err) {
        failed++;
        useApp.getState().toast('cloud.downloadFailed', 'error', { name: e.t, msg: msg(err) });
      } finally {
        onProgress(e.h, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, entries.length) }, worker));
  if (got.length) await useApp.getState().importFiles(got);
  if (failed) useApp.getState().toast('friends.partial', 'error', { count: got.length, failed });
  return got.length;
}
