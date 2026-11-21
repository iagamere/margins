import ePub from 'epubjs';
import { addBook, findBookByHash, patchBook } from './db';
import { TRIM_VERSION, trimCover } from './trim';
import { openPdf, isPasswordError } from './pdf';
import { AppError, type BookFormat, type BookRecord, type ErrorCode } from './types';
import { baseName, isRtlLang, uid, withTimeout, log } from './utils';

export type ImportResult =
  | { status: 'added'; book: BookRecord }
  | { status: 'duplicate'; book: BookRecord; repaired?: boolean }
  | { status: 'error'; code: ErrorCode; fileName: string };

const COVER_WIDTH = 420;

async function sniffFormat(file: File): Promise<BookFormat | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const asText = String.fromCharCode(...head.slice(0, 5));
  if (asText.startsWith('%PDF')) return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) {
    // ZIP container — EPUB is the only zip-based format we accept
    return /\.epub$/i.test(file.name) || file.type === 'application/epub+zip' ? 'epub' : /\.pdf$/i.test(file.name) ? null : 'epub';
  }
  return null;
}

async function sha256(buf: ArrayBuffer, file: File): Promise<string> {
  try {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }
}

async function downscaleToJpeg(source: Blob): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(source);
    const scale = Math.min(1, COVER_WIDTH / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return source.size < 800_000 ? source : undefined;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return await new Promise<Blob | undefined>((res) => canvas.toBlob((b) => res(b ?? undefined), 'image/jpeg', 0.85));
  } catch {
    return source.size < 800_000 ? source : undefined;
  }
}


/* ---------- clean-up of junk metadata ("Unknown", an e-mail as author…) ---------- */
const BAD_TITLE = /^(unknown|untitled|no title|notitle|none|null|undefined|n\/a|title|document|book|new book|ebook|[-_. ]*)$/i;
const BAD_AUTHOR = /^(unknown|anonymous|none|null|undefined|n\/a|author|calibre|[-_. ]*)$/i;
const EMAIL = /^\S+@\S+\.\S+$/;

export function cleanTitle(t: string | undefined | null): string | undefined {
  const v = (t ?? '').replace(/\s+/g, ' ').trim();
  return !v || BAD_TITLE.test(v) || EMAIL.test(v) ? undefined : v;
}
export function cleanAuthor(a: string | undefined | null): string | undefined {
  const v = (a ?? '').replace(/\s+/g, ' ').trim();
  return !v || BAD_AUTHOR.test(v) || EMAIL.test(v) ? undefined : v;
}
const needsRepair = (b: BookRecord) => !b.cover || !cleanTitle(b.title) || (!!b.author && !cleanAuthor(b.author));

/* ---------- EPUB cover: many files have no <meta name="cover"> at all, so look in every usual place ---------- */
const IMG_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

async function epubFallbackCover(book: any): Promise<Blob | undefined> {
  const zip = book?.archive?.zip;
  if (!zip) return undefined;
  const text = async (p: string): Promise<string> => (await zip.file(p)?.async('string')) ?? '';
  const join = (base: string, href: string) => {
    let h = href.split('#')[0].split('?')[0];
    try { h = decodeURIComponent(h); } catch { /* keep as is */ }
    const parts = (h.startsWith('/') ? h.slice(1) : (base ? base + '/' : '') + h).split('/');
    const out: string[] = [];
    for (const seg of parts) {
      if (seg === '..') out.pop();
      else if (seg && seg !== '.') out.push(seg);
    }
    return out.join('/');
  };
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const imgBlob = async (path: string): Promise<Blob | undefined> => {
    const f = zip.file(path);
    if (!f) return undefined;
    const ext = (path.split('.').pop() ?? '').toLowerCase();
    const mime = IMG_MIME[ext];
    if (!mime) return undefined; // svg / unknown: the canvas cannot draw it reliably
    const b: Blob = await f.async('blob');
    return b.size > 1500 ? new Blob([b], { type: mime }) : undefined;
  };
  /** first picture shown by an (x)html page, e.g. the cover page */
  const pageImage = async (pagePath: string): Promise<Blob | undefined> => {
    const html = await text(pagePath);
    if (!html) return undefined;
    const m = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html) ?? /<image[^>]+href\s*=\s*["']([^"']+)["']/i.exec(html);
    return m ? imgBlob(join(dirOf(pagePath), m[1])) : undefined;
  };

  try {
    const container = await text('META-INF/container.xml');
    const opfPath = /full-path\s*=\s*["']([^"']+)["']/i.exec(container)?.[1];
    if (!opfPath) return undefined;
    const base = dirOf(opfPath);
    const doc = new DOMParser().parseFromString(await text(opfPath), 'application/xml');
    const items = Array.from(doc.getElementsByTagName('item')).map((e) => ({
      id: e.getAttribute('id') ?? '',
      href: e.getAttribute('href') ?? '',
      type: e.getAttribute('media-type') ?? '',
      props: e.getAttribute('properties') ?? '',
    }));
    const images = items.filter((i) => i.type.startsWith('image/') && i.href);
    const byId = new Map(items.map((i) => [i.id, i]));
    const tryItem = async (i?: { href: string; type: string }) => {
      if (!i?.href) return undefined;
      const path = join(base, i.href);
      return i.type.startsWith('image/') ? imgBlob(path) : pageImage(path);
    };

    // 1) EPUB 3 cover-image property
    let r = await tryItem(items.find((i) => /(^|\s)cover-image(\s|$)/.test(i.props)));
    if (r) return r;
    // 2) EPUB 2 <meta name="cover" content="id">
    const meta = Array.from(doc.getElementsByTagName('meta')).find((m) => (m.getAttribute('name') ?? '').toLowerCase() === 'cover');
    r = await tryItem(byId.get(meta?.getAttribute('content') ?? ''));
    if (r) return r;
    // 3) <guide><reference type="cover">
    const ref = Array.from(doc.getElementsByTagName('reference')).find((x) => (x.getAttribute('type') ?? '').toLowerCase() === 'cover');
    if (ref?.getAttribute('href')) {
      const path = join(base, ref.getAttribute('href')!);
      r = /\.(jpe?g|png|gif|webp)$/i.test(path) ? await imgBlob(path) : await pageImage(path);
      if (r) return r;
    }
    // 4) an image called "cover…"
    r = await tryItem(images.find((i) => /cover|couv|غلاف/i.test(i.id + ' ' + i.href)));
    if (r) return r;
    // 5) the picture on the first page of the book
    const spineRef = doc.getElementsByTagName('itemref')[0]?.getAttribute('idref');
    r = await tryItem(byId.get(spineRef ?? ''));
    if (r) return r;
    // 6) the biggest picture of the book
    let best: Blob | undefined;
    for (const i of images.slice(0, 40)) {
      const b = await imgBlob(join(base, i.href));
      if (b && (!best || b.size > best.size)) best = b;
    }
    return best && best.size > 20_000 ? best : undefined;
  } catch (e) {
    log('fallback cover failed', e);
    return undefined;
  }
}

async function readEpub(buf: ArrayBuffer) {
  const book: any = ePub(buf, { openAs: 'binary' } as any);
  try {
    await withTimeout(book.ready, 30_000, 'epub-timeout');
    const meta: any = await withTimeout(book.loaded.metadata, 15_000, 'epub-meta-timeout');
    let cover: Blob | undefined;
    try {
      const url: string | null = await withTimeout(book.coverUrl(), 10_000, 'cover-timeout');
      if (url) {
        const blob = await (await fetch(url)).blob();
        cover = await downscaleToJpeg(blob);
      }
    } catch (e) {
      log('cover extraction failed', e);
    }
    if (!cover) {
      const raw = await epubFallbackCover(book);
      if (raw) cover = await downscaleToJpeg(raw);
    }
    const language: string | undefined = meta.language ? String(meta.language) : undefined;
    const dir = String(meta.direction ?? '').toLowerCase();
    const rtl = dir === 'rtl' || isRtlLang(language);
    return {
      title: meta.title ? String(meta.title).trim() : undefined,
      author: meta.creator ? String(meta.creator).trim() : undefined,
      language,
      rtl,
      cover,
    };
  } finally {
    try {
      book.destroy();
    } catch {
      /* ignore */
    }
  }
}

async function readPdf(buf: ArrayBuffer) {
  const { doc, dispose } = await openPdf(new Uint8Array(buf));
  try {
    let title: string | undefined;
    let author: string | undefined;
    try {
      const md = await doc.getMetadata();
      const t = md?.info?.Title;
      const a = md?.info?.Author;
      if (typeof t === 'string' && t.trim()) title = t.trim();
      if (typeof a === 'string' && a.trim()) author = a.trim();
    } catch {
      /* metadata is optional */
    }
    let cover: Blob | undefined;
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      cover = await new Promise<Blob | undefined>((res) => canvas.toBlob((b) => res(b ?? undefined), 'image/jpeg', 0.82));
      page.cleanup?.();
    } catch (e) {
      log('pdf cover failed', e);
    }
    return { title, author, cover, pages: doc.numPages as number };
  } finally {
    await dispose();
  }
}

export async function importFile(file: File): Promise<ImportResult> {
  const fileName = file.name || 'book';
  try {
    if (file.size === 0) return { status: 'error', code: 'invalid', fileName };
    const format = await sniffFormat(file);
    if (!format) return { status: 'error', code: 'unsupported', fileName };

    const buf = await file.arrayBuffer();
    const hash = await sha256(buf, file);

    const existing = await findBookByHash(hash);
    if (existing) {
      // an earlier import may have kept a junk title ("Unknown") or no cover: read the file again and fix the record
      if (format === 'epub' && needsRepair(existing)) {
        try {
          const m = await readEpub(buf.slice(0));
          const patch: Partial<BookRecord> = {};
          if (!cleanTitle(existing.title)) patch.title = cleanTitle(m.title) || baseName(fileName) || existing.title;
          if (existing.author && !cleanAuthor(existing.author)) patch.author = cleanAuthor(m.author);
          if (!existing.cover && m.cover) Object.assign(patch, { cover: await trimCover(m.cover), coverTrimmed: true, coverTrimV: TRIM_VERSION });
          if (Object.keys(patch).length) {
            const fixed = await patchBook(existing.id, patch);
            if (fixed) return { status: 'duplicate', book: fixed, repaired: true };
          }
        } catch (e) {
          log('repair failed', e);
        }
      }
      return { status: 'duplicate', book: existing };
    }

    // Build the stored copy BEFORE parsing: PDF.js transfers (detaches) the buffer it is given,
    // which would otherwise leave us saving an empty file.
    const stored = new Blob([buf.slice(0)], { type: format === 'pdf' ? 'application/pdf' : 'application/epub+zip' });

    let meta: { title?: string; author?: string; cover?: Blob; language?: string; rtl?: boolean; pages?: number };
    try {
      meta = format === 'epub' ? await readEpub(buf.slice(0)) : await readPdf(buf.slice(0));
    } catch (e) {
      log('parse failed', e);
      if (format === 'pdf') {
        return { status: 'error', code: isPasswordError(e) ? 'passwordPdf' : 'corruptPdf', fileName };
      }
      return { status: 'error', code: 'corruptEpub', fileName };
    }

    const book: BookRecord = {
      id: uid(),
      hash,
      format,
      title: cleanTitle(meta.title) || baseName(fileName) || fileName,
      author: cleanAuthor(meta.author),
      fileName,
      size: file.size,
      addedAt: Date.now(),
      percentage: 0,
      finished: false,
      cover: await trimCover(meta.cover),
      coverTrimmed: true,
      coverTrimV: TRIM_VERSION,
      language: meta.language,
      rtl: meta.rtl,
      pages: meta.pages,
    };
    await addBook(book, stored);
    return { status: 'added', book };
  } catch (e) {
    if (e instanceof AppError) return { status: 'error', code: e.code, fileName };
    log('import failed', e);
    return { status: 'error', code: 'importFailed', fileName };
  }
}
