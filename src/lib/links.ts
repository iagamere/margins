import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { App } from '@capacitor/app';
import { useApp } from '../store/useApp';
import { isNative } from './platform';

/** A link to a book: a Google Drive file, or a direct .pdf / .epub address. */
export interface BookLink {
  kind: 'drive' | 'direct';
  /** the address exactly as it was opened (what "Open in Drive" shows) */
  url: string;
  id?: string;
}

export function parseBookLink(raw: string): BookLink | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'drive.google.com' || host === 'docs.google.com' || host === 'drive.usercontent.google.com') {
    const m = /\/file\/d\/([\w-]{10,})/.exec(u.pathname);
    const id = m?.[1] ?? u.searchParams.get('id') ?? undefined;
    return id && /^[\w-]{10,}$/.test(id) ? { kind: 'drive', url: raw.trim(), id } : null;
  }
  if (/\.(pdf|epub)$/i.test(u.pathname)) return { kind: 'direct', url: raw.trim() };
  return null;
}

/** The app was opened from a link (or a link was shared to it): ask the person what to do with it. */
let lastUrl = '';
let lastAt = 0;
export function handleIncomingUrl(url: string | undefined) {
  if (!url) return;
  const now = Date.now();
  if (url === lastUrl && now - lastAt < 4000) return; // the same link is reported twice on a cold start
  lastUrl = url;
  lastAt = now;
  if (url.startsWith('file://')) {
    void openLocalFile(url);
    return;
  }
  // margins://u/<stamp>: someone's profile
  const prof = /^margins:\/\/u\/([\w-]{15,})/i.exec(url.trim());
  if (prof) {
    void import('./share').then((m) => m.openProfileByCode(prof[1]));
    return;
  }
  if (!parseBookLink(url)) {
    useApp.getState().toast('link.unsupported', 'info');
    return;
  }
  useApp.getState().setIncomingLink(url);
}

export function startLinkListener() {
  if (!isNative) return;
  void App.addListener('appUrlOpen', (e) => handleIncomingUrl(e.url));
  void App.getLaunchUrl().then((r) => handleIncomingUrl(r?.url)).catch(() => undefined);
}

function headerOf(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  const k = Object.keys(headers).find((h) => h.toLowerCase() === name);
  return k ? String(headers[k]) : '';
}

/** The file's real name (Drive sends it in Content-Disposition); a 1-byte ranged request is enough. */
async function guessName(url: string): Promise<string | undefined> {
  try {
    const r = await CapacitorHttp.get({ url, headers: { Range: 'bytes=0-0' }, connectTimeout: 8000, readTimeout: 8000 });
    const cd = headerOf(r.headers, 'content-disposition');
    const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
    if (star) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    const plain = /filename="?([^";]+)"?/i.exec(cd);
    if (plain) return plain[1].trim();
  } catch {
    /* the name is optional */
  }
  return undefined;
}


/** What the bytes really are: PDF and EPUB (a zip) are books; "<" means a web page came back instead of the file. */
async function sniffBook(blob: Blob): Promise<'pdf' | 'epub' | 'html' | 'other'> {
  const h = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return 'pdf'; // %PDF
  if (h[0] === 0x50 && h[1] === 0x4b) return 'epub'; // PK
  return h[0] === 0x3c ? 'html' : 'other';
}

function asBookFile(blob: Blob, kind: 'pdf' | 'epub', name?: string): File {
  let fileName = name || `book.${kind}`;
  if (!new RegExp('\\.' + kind + '$', 'i').test(fileName)) fileName += '.' + kind;
  return new File([blob], fileName, { type: kind === 'pdf' ? 'application/pdf' : 'application/epub+zip' });
}

/**
 * A PDF / EPUB opened with Margins ("Open with" in Telegram or a file manager): the Android side already copied it
 * into the app's cache under its real name. Read it, add it to the library and open it.
 */
export async function openLocalFile(url: string) {
  const st = useApp.getState();
  try {
    // a cold start brings the link before the library has been read from the database
    for (let i = 0; i < 50 && !useApp.getState().booksLoaded; i++) await new Promise((r) => setTimeout(r, 100));
    st.toast('link.opening', 'info');
    const last = decodeURIComponent(url.split('/').pop() ?? '');
    const name = last.replace(/^\d{10,}_/, '') || undefined;
    const blob = await (await fetch(Capacitor.convertFileSrc(url))).blob();
    const kind = await sniffBook(blob);
    if (kind !== 'pdf' && kind !== 'epub') {
      st.toast('link.notBook', 'error');
      return;
    }
    const book = await st.importFiles([asBookFile(blob, kind, name)]);
    await st.reloadBooks();
    if (book) st.navigate({ name: 'reader', id: book.id });
  } catch (e) {
    st.toast('link.failed', 'error', { msg: (e as { message?: string })?.message || String(e) });
  } finally {
    void Filesystem.deleteFile({ path: url }).catch(() => undefined);
  }
}

export class LinkError extends Error {
  constructor(public code: 'notPublic' | 'notBook' | 'failed', message?: string) {
    super(message ?? code);
  }
}

/** Downloads the book behind the link to a temporary file (with progress) and returns it as a File ready to import. */
export async function fetchBook(link: BookLink, onProgress: (fraction: number | null) => void): Promise<File> {
  // this address skips Drive's "can't scan for viruses" page for large public files
  const url = link.kind === 'drive' ? `https://drive.usercontent.google.com/download?id=${link.id}&export=download&confirm=t` : link.url;
  const name = await guessName(url);
  const path = `margins-dl/${Date.now()}.bin`;
  const sub = await Filesystem.addListener('progress', (p) => onProgress(p.contentLength > 0 ? Math.min(1, p.bytes / p.contentLength) : null));
  try {
    await Filesystem.downloadFile({ url, path, directory: Directory.Cache, recursive: true, progress: true });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    const blob = await (await fetch(Capacitor.convertFileSrc(uri))).blob();
    const kind = await sniffBook(blob);
    // a web page came back: the file is private (a login page) or gone
    if (kind === 'html') throw new LinkError('notPublic');
    if (kind === 'other') throw new LinkError('notBook');
    return asBookFile(blob, kind, name);
  } catch (e) {
    if (e instanceof LinkError) throw e;
    throw new LinkError('failed', (e as { message?: string })?.message || String(e));
  } finally {
    void sub.remove();
    void Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
  }
}
