import type { ShelfRatio } from './types';

export const SHELF_RATIOS: Record<ShelfRatio, number> = { '2:3': 2 / 3, '1:1': 1 };

/** The allowed format closest to a picture's own proportions. */
export function nearestRatio(w: number, h: number): ShelfRatio {
  return w / h < (SHELF_RATIOS['2:3'] + 1) / 2 ? '2:3' : '1:1';
}

async function bitmapOf(src: Blob): Promise<ImageBitmap> {
  return createImageBitmap(src);
}

/** Natural proportions of an image, to pre-select 2:3 or 1:1. */
export async function suggestRatio(src: Blob): Promise<ShelfRatio> {
  const bmp = await bitmapOf(src);
  const r = nearestRatio(bmp.width, bmp.height);
  bmp.close?.();
  return r;
}

/** Centre-crops an image to exactly 2:3 or 1:1 and shrinks it (shelf tiles never need more than ~600 px). */
export async function cropToRatio(src: Blob, ratio: ShelfRatio, maxSide = 600): Promise<Blob> {
  const bmp = await bitmapOf(src);
  try {
    const target = SHELF_RATIOS[ratio];
    let sw = bmp.width;
    let sh = bmp.height;
    if (sw / sh > target) sw = Math.round(sh * target);
    else sh = Math.round(sw / target);
    const sx = Math.round((bmp.width - sw) / 2);
    const sy = Math.round((bmp.height - sh) / 2);
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const ow = Math.max(1, Math.round(sw * scale));
    const oh = Math.max(1, Math.round(sh * scale));
    const c = document.createElement('canvas');
    c.width = ow;
    c.height = oh;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ow, oh);
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, ow, oh);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.86));
    if (!out) throw new Error('encode failed');
    return out;
  } finally {
    bmp.close?.();
  }
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/**
 * "Dynamic colour": the colour that best stands for a cover. Pixels are grouped by hue and weighted by how
 * saturated and bright they are (greys and near-black / near-white barely count), the strongest group wins,
 * and its average is nudged into a lightness / saturation range that reads well as a shelf colour.
 */
export async function dominantColor(src: Blob): Promise<string | undefined> {
  try {
    const bmp = await bitmapOf(src);
    const S = 48;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, S, S);
    bmp.close?.();
    const d = ctx.getImageData(0, 0, S, S).data;
    const N = 24;
    const acc = Array.from({ length: N }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      ar += r; ag += g; ab += b; an++;
      const [h, s, l] = rgbToHsl(r, g, b);
      if (l < 0.12 || l > 0.93 || s < 0.15) continue;
      const w = s * s * (1 - Math.abs(2 * l - 1) * 0.6);
      const k = acc[Math.floor(h / (360 / N)) % N];
      k.w += w; k.r += r * w; k.g += g * w; k.b += b * w;
    }
    // the best hue group plus its two neighbours, so a gradient of one colour is not split in half
    let best = -1, bestW = 0;
    for (let i = 0; i < N; i++) {
      const w = acc[i].w * 1.0 + acc[(i + 1) % N].w * 0.5 + acc[(i + N - 1) % N].w * 0.5;
      if (w > bestW) { bestW = w; best = i; }
    }
    let r: number, g: number, b: number;
    if (best >= 0 && bestW > 0.5) {
      const grp = [acc[(best + N - 1) % N], acc[best], acc[(best + 1) % N]];
      const w = grp.reduce((a, x) => a + x.w, 0);
      r = grp.reduce((a, x) => a + x.r, 0) / w;
      g = grp.reduce((a, x) => a + x.g, 0) / w;
      b = grp.reduce((a, x) => a + x.b, 0) / w;
      const [h, s, l] = rgbToHsl(r, g, b);
      return hslToHex(h, Math.max(0.32, Math.min(0.72, s)), Math.max(0.36, Math.min(0.56, l)));
    }
    // a grey / monochrome picture: its average, kept neutral
    const [h, s, l] = rgbToHsl(ar / an, ag / an, ab / an);
    return hslToHex(h, Math.min(s, 0.12), Math.max(0.3, Math.min(0.55, l)));
  } catch {
    return undefined;
  }
}
