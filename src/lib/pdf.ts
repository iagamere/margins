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
