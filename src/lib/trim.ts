import { sleep } from './utils';

/** Bump when the trimming algorithm improves: covers trimmed by an older version are trimmed again. */
export const TRIM_VERSION = 2;

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * Content box of a rendered page: everything inside the paper margin. The margin colour is sampled from the
 * corners (so cream / off-white paper works too); a row or column counts as content only when enough of its
 * pixels differ from the paper AND the following lines do too, so a thin scan border, a hairline or JPEG noise
 * at the edge is skipped. Returns null when the page is blank or does not have a light margin at all.
 */
export function contentBox(ctx: CanvasRenderingContext2D, w: number, h: number): Box | null {
  const data = ctx.getImageData(0, 0, w, h).data;
  const px = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  // paper colour = average of the four corners (5x5 patches); art touching a corner => assume pure white
  const k = Math.max(1, Math.min(5, Math.floor(Math.min(w, h) / 20)));
  const corners = [[0, 0], [w - k, 0], [0, h - k], [w - k, h - k]].map(([cx, cy]) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy; y < cy + k; y++) for (let x = cx; x < cx + k; x++) { const p = px(x, y); r += p[0]; g += p[1]; b += p[2]; n++; }
    return [r / n, g / n, b / n];
  });
  const mean = [0, 1, 2].map((c) => corners.reduce((a, p) => a + p[c], 0) / 4);
  const agree = corners.every((p) => [0, 1, 2].every((c) => Math.abs(p[c] - mean[c]) < 22));
  const bg = agree && Math.min(...mean) > 200 ? mean : [255, 255, 255];
  const TOL = 34; // channel distance from the paper that counts as "ink"
  const isInk = (i: number) =>
    Math.abs(data[i] - bg[0]) > TOL || Math.abs(data[i + 1] - bg[1]) > TOL || Math.abs(data[i + 2] - bg[2]) > TOL;

  const rowInk = new Float32Array(h);
  const colInk = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isInk((y * w + x) * 4)) { rowInk[y]++; colInk[x]++; }
    }
  }
  for (let y = 0; y < h; y++) rowInk[y] /= w;
  for (let x = 0; x < w; x++) colInk[x] /= h;

  const MIN = 0.04; // share of a line that must be ink
  const RUN = Math.max(3, Math.round(Math.min(w, h) * 0.01)); // ...for this many lines in a row
  const solid = (a: Float32Array, i: number, dir: 1 | -1) => {
    for (let j = 0; j < RUN; j++) {
      const v = a[i + dir * j];
      if (v === undefined || v < MIN) return false;
    }
    return true;
  };
  const first = (a: Float32Array, dir: 1 | -1) => {
    const n = a.length;
    for (let i = dir === 1 ? 0 : n - 1; i >= 0 && i < n; i += dir) if (solid(a, i, dir)) return i;
    return -1;
  };
  const y0 = first(rowInk, 1), y1 = first(rowInk, -1), x0 = first(colInk, 1), x1 = first(colInk, -1);
  if (y0 < 0 || x0 < 0 || y1 < 0 || x1 < 0) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Cuts the white page margins off a cover image. Returns the original blob when there is nothing worth cutting. */
export async function trimCover(blob: Blob | undefined): Promise<Blob | undefined> {
  if (!blob) return blob;
  try {
    const bmp = await createImageBitmap(blob);
    const w = bmp.width;
    const h = bmp.height;
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const box = contentBox(ctx, w, h);
    if (!box) return blob;
    // a few pixels inside, so the soft JPEG edge next to the paper never survives; sides without margin stay untouched
    const m = Math.max(2, Math.round(Math.min(w, h) * 0.006));
    const eps = 0.004;
    const x0 = box.x0 > w * eps ? Math.min(box.x0 + m, w - 1) : 0;
    const y0 = box.y0 > h * eps ? Math.min(box.y0 + m, h - 1) : 0;
    const x1 = w - box.x1 > w * eps ? Math.max(box.x1 - m, x0 + 1) : w;
    const y1 = h - box.y1 > h * eps ? Math.max(box.y1 - m, y0 + 1) : h;
    const bw = x1 - x0;
    const bh = y1 - y0;
    const cut = (w - bw) / w > 0.01 || (h - bh) / h > 0.01;
    if (!cut || bw * bh < 0.3 * w * h) return blob; // nothing to cut, or a mostly-light cover we should not touch
    const out = document.createElement('canvas');
    out.width = bw;
    out.height = bh;
    out.getContext('2d')!.drawImage(src, x0, y0, bw, bh, 0, 0, bw, bh);
    src.width = 0;
    const res = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/jpeg', 0.88));
    return res ?? blob;
  } catch {
    return blob;
  }
}

/** One-off clean-up of covers saved before trimming existed; runs quietly in the background. */
export async function trimExistingCovers(
  books: Array<{ id: string; cover?: Blob; coverTrimV?: number }>,
  apply: (id: string, cover: Blob | undefined) => void,
) {
  for (const b of books) {
    if (!b.cover || (b.coverTrimV ?? 0) >= TRIM_VERSION) continue;
    apply(b.id, await trimCover(b.cover));
    await sleep(25);
  }
}
