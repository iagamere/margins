import ePub from 'epubjs';
import { addBook, findBookByHash } from './db';
import { openPdf, isPasswordError } from './pdf';
import { AppError, type BookFormat, type BookRecord, type ErrorCode } from './types';
import { baseName, isRtlLang, uid, withTimeout, log } from './utils';

export type ImportResult =
  | { status: 'added'; book: BookRecord }
  | { status: 'duplicate'; book: BookRecord }
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
    if (existing) return { status: 'duplicate', book: existing };

    let meta: { title?: string; author?: string; cover?: Blob; language?: string; rtl?: boolean; pages?: number };
    try {
      meta = format === 'epub' ? await readEpub(buf) : await readPdf(buf);
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
      title: meta.title || baseName(fileName) || fileName,
      author: meta.author,
      fileName,
      size: file.size,
      addedAt: Date.now(),
      percentage: 0,
      finished: false,
      cover: meta.cover,
      language: meta.language,
      rtl: meta.rtl,
      pages: meta.pages,
    };
    // Store a real Blob (not the File handle) so the data survives independently of the picker.
    const stored = new Blob([buf], { type: format === 'pdf' ? 'application/pdf' : 'application/epub+zip' });
    await addBook(book, stored);
    return { status: 'added', book };
  } catch (e) {
    if (e instanceof AppError) return { status: 'error', code: e.code, fileName };
    log('import failed', e);
    return { status: 'error', code: 'importFailed', fileName };
  }
}
