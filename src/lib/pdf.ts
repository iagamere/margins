/* PDF.js loader. Uses the "legacy" build for wide Android WebView compatibility and one worker per document. */

let libPromise: Promise<any> | null = null;

export function loadPdfjs(): Promise<any> {
  if (!libPromise) {
    libPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'),
    ]).then(([lib, worker]) => ({ lib, Worker: worker.default }));
  }
  return libPromise;
}

export interface OpenedPdf {
  doc: any;
  dispose: () => Promise<void>;
}

export async function openPdf(data: Uint8Array): Promise<OpenedPdf> {
  const { lib, Worker: WorkerCtor } = await loadPdfjs();
  const port: Worker = new WorkerCtor();
  const worker = new lib.PDFWorker({ port });
  const base = document.baseURI;
  const task = lib.getDocument({
    data,
    worker,
    isEvalSupported: false,
    cMapUrl: new URL('pdfjs/cmaps/', base).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('pdfjs/standard_fonts/', base).href,
  });
  try {
    const doc = await task.promise;
    return {
      doc,
      dispose: async () => {
        try {
          await task.destroy();
        } catch {
          /* ignore */
        }
        try {
          worker.destroy();
        } catch {
          /* ignore */
        }
        port.terminate();
      },
    };
  } catch (e) {
    try {
      worker.destroy();
    } catch {
      /* ignore */
    }
    port.terminate();
    throw e;
  }
}

import { sleep } from './utils';
import type { SearchHit } from './types';

/** Plain-text search over a PDF's embedded text layer (no OCR). */
export async function searchPdf(
  doc: any,
  cache: Map<number, string>,
  query: string,
  onHit: (h: SearchHit) => void,
  cancel: { cancelled: boolean }
): Promise<{ hasText: boolean }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return { hasText: true };
  let anyText = false;
  let count = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    if (cancel.cancelled) break;
    let text = cache.get(i);
    if (text === undefined) {
      try {
        const pg = await doc.getPage(i);
        const tc = await pg.getTextContent();
        text = tc.items.map((it: any) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join(' ').replace(/\s+/g, ' ').normalize('NFKC');
        pg.cleanup?.();
      } catch {
        text = '';
      }
      cache.set(i, text);
    }
    if (text.trim()) anyText = true;
    const low = text.toLowerCase();
    let from = 0;
    let idx: number;
    while ((idx = low.indexOf(needle, from)) !== -1 && count < 300) {
      const st = Math.max(0, idx - 36);
      onHit({ id: `${i}:${idx}`, location: `p:${i}:0`, label: query.trim(), excerpt: (st > 0 ? '…' : '') + text.slice(st, idx + needle.length + 60) + '…' });
      count++;
      from = idx + needle.length;
    }
    if (count >= 300) break;
    if (i % 4 === 0) await sleep(0);
  }
  return { hasText: anyText || count > 0 };
}

export function convertOutline(items: any[], prefix = ''): import('./types').TocItem[] {
  return (items ?? []).map((it, i) => ({
    id: `${prefix}${i}`,
    label: String(it.title ?? '').replace(/\s+/g, ' ').trim() || '—',
    dest: it.dest ?? it.url,
    children: convertOutline(it.items ?? [], `${prefix}${i}-`),
  }));
}

export function isPasswordError(e: unknown): boolean {
  const n = (e as { name?: string })?.name;
  return n === 'PasswordException';
}

export async function resolveOutlineDest(doc: any, dest: unknown): Promise<number | null> {
  try {
    let d: any = dest;
    if (typeof d === 'string') d = await doc.getDestination(d);
    if (!Array.isArray(d)) return null;
    const ref = d[0];
    if (ref && typeof ref === 'object') return (await doc.getPageIndex(ref)) + 1;
    if (Number.isInteger(ref)) return (ref as number) + 1;
  } catch {
    /* unresolved */
  }
  return null;
}
