import { create } from 'zustand';
import { useApp } from '../store/useApp';
import { getFile, kvGet, kvSet } from './db';
import { askNotifyPermission, runnerSend } from './notify';
import { createFolder, deleteFile, fetchPublicBlob, fetchPublicJson, listSharedFiles, makePublic, uploadFile } from './drive';

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
  /** shelf id (see ShareManifest.shelves) */
  sh?: string;
  /** Drive id of the book file / of its cover */
  file: string;
  cover?: string;
}
export interface ShareShelf {
  id: string;
  n: string;
  c?: string;
  /** Drive id of the shelf picture */
  i?: string;
  ratio?: '2:3' | '1:1';
}
export interface ShareProfile {
  /** display name */
  n: string;
  /** short bio (optional) */
  b?: string;
  /** Drive id of the profile picture */
  a?: string;
}
export interface ShareManifest {
  v: 1;
  name: string;
  profile?: ShareProfile;
  updated: number;
  shelves?: ShareShelf[];
  books: ShareEntry[];
}
export interface ShareState {
  email: string;
  folderId: string;
  manifestId: string;
  files: Record<string, { file: string; cover?: string }>;
  /** shelf pictures already in Drive: shelf id -> picture signature + file id */
  shelfFiles?: Record<string, { sig: string; file: string }>;
  avatar?: { sig: string; file: string };
  updated: number;
}
/** What I show on my own profile page (kept on this device, published with the library). */
export interface MyProfile {
  name: string;
  bio: string;
  avatar?: Blob;
}
export interface FriendRec {
  id: string;
  name: string;
  count: number;
  addedAt: number;
  /** I follow this profile */
  following?: boolean;
  /** ids of the shelves whose new books notify me */
  watch?: string[];
}

interface ShareStore {
  loaded: boolean;
  mine: ShareState | null;
  friends: FriendRec[];
  profile: MyProfile;
  busy: { done: number; total: number } | null;
}
export const useShare = create<ShareStore>(() => ({ loaded: false, mine: null, friends: [], profile: { name: '', bio: '' }, busy: null }));

const msg = (e: unknown) => (e as { message?: string })?.message || String(e);

export async function loadShare(): Promise<void> {
  if (useShare.getState().loaded) return;
  const [mine, friends, profile] = await Promise.all([kvGet<ShareState>('share'), kvGet<FriendRec[]>('friends'), kvGet<MyProfile>('shareProfile')]);
  useShare.setState({ loaded: true, mine: mine ?? null, friends: friends ?? [], profile: profile ?? { name: '', bio: '' } });
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
  const st: ShareState = cur && cur.email === email ? { ...cur, files: { ...cur.files }, shelfFiles: { ...(cur.shelfFiles ?? {}) } } : { email, folderId: '', manifestId: '', files: {}, shelfFiles: {}, updated: 0 };
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
      .map((b) => ({ h: b.hash, t: b.title, a: b.author, f: b.format, s: b.size, l: b.language, r: b.rtl, p: b.pages, fn: b.fileName, sh: b.shelfId, file: st.files[b.hash].file, cover: st.files[b.hash].cover }));
    // shelves that hold at least one shared book (name, colour, picture)
    const used = new Set(entries.map((e) => e.sh).filter(Boolean) as string[]);
    const shelves: ShareShelf[] = [];
    for (const sh of app.shelves.filter((x) => used.has(x.id))) {
      const rec: ShareShelf = { id: sh.id, n: sh.name, c: sh.color, ratio: sh.ratio };
      if (sh.image) {
        const sig = `${sh.image.size}`;
        const have = st.shelfFiles![sh.id];
        if (have && have.sig === sig) rec.i = have.file;
        else {
          try {
            if (have) await deleteFile(have.file).catch(() => undefined);
            const file = await uploadFile(`shelf-${sh.id}.jpg`, sh.image, sh.image.type || 'image/jpeg', { k: 'sshelf', h: sh.id, g: sig }, '', undefined, undefined, st.folderId);
            await makePublic(file);
            st.shelfFiles![sh.id] = { sig, file };
            rec.i = file;
          } catch {
            /* the shelf is shown without its picture */
          }
        }
      }
      shelves.push(rec);
    }
    for (const [id, e] of Object.entries(st.shelfFiles!)) {
      if (used.has(id)) continue;
      await deleteFile(e.file).catch(() => undefined);
      delete st.shelfFiles![id];
    }
    const me = useShare.getState().profile;
    const profile: ShareProfile = { n: me.name.trim() || app.account.name || app.account.email };
    if (me.bio.trim()) profile.b = me.bio.trim().slice(0, 200);
    if (me.avatar) {
      const sig = `${me.avatar.size}`;
      if (st.avatar && st.avatar.sig === sig) profile.a = st.avatar.file;
      else {
        try {
          if (st.avatar) await deleteFile(st.avatar.file).catch(() => undefined);
          const file = await uploadFile('avatar.jpg', me.avatar, 'image/jpeg', { k: 'savatar', h: 'me', g: sig }, '', undefined, undefined, st.folderId);
          await makePublic(file);
          st.avatar = { sig, file };
          profile.a = file;
        } catch {
          /* the profile is shown without its picture */
        }
      }
    } else if (st.avatar) {
      await deleteFile(st.avatar.file).catch(() => undefined);
      delete st.avatar;
    }
    const manifest: ShareManifest = { v: 1, name: profile.n, profile, updated: Date.now(), shelves, books: entries };
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

/**
 * The stamp must not change by itself: if this device lost its record (reinstall, cleared data, new phone),
 * the shared files are found again in Drive by their tags and the same stamp is used again.
 */
let restoring = false;
export async function restoreShare(): Promise<boolean> {
  const app = useApp.getState();
  const email = app.account?.email;
  if (!email || !app.account?.share || restoring) return false;
  const cur = useShare.getState().mine;
  if (cur && cur.email === email) return true;
  restoring = true;
  try {
    const files = await listSharedFiles();
    const manifest = files.find((f) => f.props.k === 'smanifest');
    if (!manifest) return false;
    const st: ShareState = { email, folderId: manifest.parent ?? '', manifestId: manifest.id, files: {}, shelfFiles: {}, updated: 0 };
    for (const f of files) {
      const h = f.props.h;
      if (!h) continue;
      if (f.props.k === 'sbook') st.files[h] = { ...(st.files[h] ?? {}), file: f.id };
      else if (f.props.k === 'scover') st.files[h] = { ...(st.files[h] ?? { file: '' }), cover: f.id };
      else if (f.props.k === 'sshelf') st.shelfFiles![h] = { sig: f.props.g ?? '', file: f.id };
      else if (f.props.k === 'savatar') st.avatar = { sig: f.props.g ?? '', file: f.id };
    }
    for (const h of Object.keys(st.files)) if (!st.files[h].file) delete st.files[h];
    await persistMine(st);
    return true;
  } catch {
    return false;
  } finally {
    restoring = false;
  }
}

/** Deliberate change of stamp: the old one stops working, a new one is made with the same books. */
export async function changeStamp(): Promise<void> {
  await stopSharing();
  if (!useShare.getState().mine) await publishLibrary();
}

/* ---------- friends' libraries ---------- */

const manifests = new Map<string, ShareManifest>();

/** The last copy of a friend's library kept on this device (opens offline). */
export async function cachedManifest(id: string): Promise<ShareManifest | null> {
  const hit = manifests.get(id);
  if (hit) return hit;
  try {
    const m = (await kvGet<ShareManifest>('fm:' + id)) ?? null;
    if (m) manifests.set(id, m);
    return m;
  } catch {
    return null;
  }
}

/** Reads the library online and keeps a copy; throws when it cannot be reached (callers fall back to cachedManifest). */
export async function loadManifest(id: string, fresh = false): Promise<ShareManifest> {
  const hit = manifests.get(id);
  if (hit && !fresh) return hit;
  const m = await fetchPublicJson<ShareManifest>(id);
  if (!m || m.v !== 1 || !Array.isArray(m.books)) throw new Error('Not a Margins library');
  manifests.set(id, m);
  void kvSet('fm:' + id, m).catch(() => undefined);
  return m;
}

/** Validates the stamp by reading the library, then remembers it. Returns the record. */
export async function addFriend(input: string): Promise<FriendRec> {
  const id = parseStamp(input);
  if (!id) throw new Error('bad-stamp');
  const m = await loadManifest(id, true);
  const old = useShare.getState().friends.find((f) => f.id === id);
  const rec: FriendRec = { ...(old ?? {}), id, name: m.profile?.n || m.name || '', count: m.books.length, addedAt: old?.addedAt ?? Date.now() };
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
  void kvSet('fm:' + id, undefined).catch(() => undefined);
}

/* ---------- my profile ---------- */

/** Crops a picture to a centred square and shrinks it (profile pictures are small). */
export async function squareJpeg(source: Blob, size = 320): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(source);
    const side = Math.min(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(size, side);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    return await new Promise<Blob | undefined>((res) => canvas.toBlob((b) => res(b ?? undefined), 'image/jpeg', 0.88));
  } catch {
    return undefined;
  }
}

/** Saves my profile; when the library is already shared the page is updated right away. */
export async function saveProfile(p: MyProfile): Promise<void> {
  useShare.setState({ profile: p });
  await kvSet('shareProfile', p);
  const mine = useShare.getState().mine;
  if (mine) await publishLibrary();
  else useApp.getState().toast('profile.saved', 'success');
}

/* ---------- follow + shelf notifications ---------- */

async function saveFriends(list: FriendRec[]) {
  useShare.setState({ friends: list });
  await kvSet('friends', list);
}
const patchFriend = (id: string, patch: Partial<FriendRec>) => saveFriends(useShare.getState().friends.map((f) => (f.id === id ? { ...f, ...patch } : f)));

/** Opens a profile from its code / link: remembers it and goes there. */
export async function openProfileByCode(code: string): Promise<void> {
  const app = useApp.getState();
  try {
    const rec = await addFriend(code);
    app.navigate({ name: 'friend', id: rec.id });
  } catch (e) {
    const m = msg(e);
    if (m === 'bad-stamp') app.toast('friends.bad', 'error');
    else app.toast('friends.fail', 'error', { msg: m });
  }
}

export async function setFollowing(id: string, on: boolean): Promise<void> {
  if (!useShare.getState().friends.some((f) => f.id === id)) {
    const m = manifests.get(id);
    if (!m) return;
    await saveFriends([{ id, name: m.profile?.n || m.name || '', count: m.books.length, addedAt: Date.now() }, ...useShare.getState().friends]);
  }
  if (!on) {
    await runnerSend('unwatch', { friend: id });
    await patchFriend(id, { following: false, watch: [] });
  } else await patchFriend(id, { following: true });
}

/** Bell on a shelf: new books on it will notify me. Returns false when the device could not be set up. */
export async function toggleWatch(friendId: string, shelf: { id: string; name: string }, on: boolean): Promise<boolean> {
  const m = manifests.get(friendId);
  const rec = useShare.getState().friends.find((f) => f.id === friendId);
  if (!m || !rec) return false;
  if (on) await askNotifyPermission();
  const seen = on ? m.books.filter((b) => b.sh === shelf.id).map((b) => b.h) : null;
  const r = await runnerSend('watchSet', { friend: friendId, fname: m.profile?.n || m.name || rec.name, shelf: shelf.id, sname: shelf.name, seen });
  if (!r.ok) return false;
  const cur = new Set(rec.watch ?? []);
  if (on) cur.add(shelf.id);
  else cur.delete(shelf.id);
  await patchFriend(friendId, { watch: [...cur] });
  return true;
}

/* ---------- covers (a few at a time) ---------- */

let active = 0;
const waiting: Array<() => void> = [];
const blobs = new Map<string, Promise<Blob | null>>();

/** A friend's cover / shelf picture: kept on this device after the first time, so it shows offline too. */
export function friendBlob(id: string): Promise<Blob | null> {
  let p = blobs.get(id);
  if (!p) {
    p = (async () => {
      try {
        const hit = await kvGet<Blob>('fc:' + id);
        if (hit) return hit;
      } catch {
        /* fall through to the network */
      }
      if (active >= 4) await new Promise<void>((r) => waiting.push(r));
      active++;
      try {
        const b = await fetchPublicBlob(id);
        void kvSet('fc:' + id, b).catch(() => undefined);
        return b;
      } catch {
        blobs.delete(id); // try again next time
        return null;
      } finally {
        active--;
        waiting.shift()?.();
      }
    })();
    blobs.set(id, p);
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
