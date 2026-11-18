import type { Lang } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => t && clearTimeout(t);
  d.flush = (...a: A) => {
    if (t) clearTimeout(t);
    fn(...a);
  };
  return d;
}

/** Leading + trailing throttle: first call runs now, later ones are coalesced to at most one per `ms`. */
export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let last = 0;
  let t: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  const run = () => {
    t = undefined;
    last = Date.now();
    const a = pending!;
    pending = undefined;
    fn(...a);
  };
  const d = (...a: A) => {
    pending = a;
    if (t) return;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) run();
    else t = setTimeout(run, wait);
  };
  d.cancel = () => {
    if (t) clearTimeout(t);
    t = undefined;
  };
  d.flush = (...a: A) => {
    if (t) clearTimeout(t);
    t = undefined;
    last = Date.now();
    fn(...a);
  };
  return d;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function intlLocale(lang: Lang): string {
  // Western digits for Arabic (as used in the Maghreb) keeps numbers consistent with book content.
  return lang === 'ar' ? 'ar-u-nu-latn' : lang;
}

export function formatDate(ts: number, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(lang), { year: 'numeric', month: 'short', day: 'numeric' }).format(ts);
  } catch {
    return new Date(ts).toLocaleDateString();
  }
}

export const percentLabel = (p: number) => `${Math.round(clamp(p, 0, 1) * 100)}%`;

const RTL_LANGS = ['ar', 'fa', 'ur', 'he', 'ps', 'ckb', 'ug', 'yi', 'dv', 'sd'];
export function isRtlLang(code?: string | null): boolean {
  if (!code) return false;
  return RTL_LANGS.includes(code.toLowerCase().split(/[-_]/)[0]);
}

export function baseName(fileName: string): string {
  return fileName
    .replace(/\.(epub|pdf)$/i, '')
    .replace(/[_]+/g, ' ')
    .trim();
}

export function withTimeout<T>(p: Promise<T>, ms: number, label = 'timeout'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Stable pseudo-random index from a string (for placeholder covers). */
export function hashIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}

export function log(...a: unknown[]) {
  if (import.meta.env.DEV) console.debug('[margins]', ...a);
}
