import type { BookRecord } from './types';

/**
 * Chapters kept as separate files in the library ("Chapter 15", "الفصل 16"…).
 * The neighbours of a book are found from its NAME: same name with the chapter number ±1.
 */

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function westernDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (c) => {
    const i = AR_DIGITS.indexOf(c);
    return String(i >= 0 ? i : FA_DIGITS.indexOf(c));
  });
}

/** words that introduce a chapter number — the number after one of them wins over any other number */
const KEYWORD = /(?:الفصل|فصل|الحلقة|حلقة|الجزء|جزء|chapter|chapitre|chap\.?|ch\.?|episode|épisode|ep\.?|part|partie)\s*[:\-_.]?\s*(\d+)/i;

export interface ChapterKey {
  /** the name with the chapter number cut out (normalised) */
  prefix: string;
  num: number;
}

export function chapterKey(raw: string | undefined): ChapterKey | null {
  if (!raw) return null;
  const s = westernDigits(
    raw
      .replace(/\.(epub|pdf)$/i, '')
      .replace(/[_]+/g, ' ')
  );
  let start = -1;
  let len = 0;
  let digits = '';
  const m = KEYWORD.exec(s);
  if (m) {
    digits = m[1];
    start = m.index + m[0].length - digits.length;
    len = digits.length;
  } else {
    // no keyword: the LAST number in the name
    const all = [...s.matchAll(/\d+/g)];
    if (!all.length) return null;
    const last = all[all.length - 1];
    digits = last[0];
    start = last.index ?? 0;
    len = digits.length;
  }
  const num = parseInt(digits, 10);
  if (!Number.isFinite(num)) return null;
  const prefix = (s.slice(0, start) + '#' + s.slice(start + len)).toLowerCase().replace(/\s+/g, ' ').trim();
  return { prefix, num };
}

/** the names a book can be recognised by: its file name first, then its title (they differ for EPUBs) */
function keysOf(b: BookRecord): ChapterKey[] {
  return [chapterKey(b.fileName), chapterKey(b.title)].filter((k): k is ChapterKey => !!k);
}

export interface Neighbour {
  book: BookRecord;
  num: number;
}

export function findNeighbours(current: BookRecord | undefined, books: BookRecord[]): { prev: Neighbour | null; next: Neighbour | null } {
  const none = { prev: null, next: null };
  if (!current) return none;
  const mine = keysOf(current);
  for (const k of mine) {
    let prev: Neighbour | null = null;
    let next: Neighbour | null = null;
    for (const b of books) {
      if (b.id === current.id) continue;
      for (const kb of keysOf(b)) {
        if (kb.prefix !== k.prefix) continue;
        if (kb.num === k.num - 1 && !prev) prev = { book: b, num: kb.num };
        if (kb.num === k.num + 1 && !next) next = { book: b, num: kb.num };
      }
    }
    if (prev || next) return { prev, next };
  }
  return none;
}
