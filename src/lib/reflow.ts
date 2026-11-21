/* Turns a PDF page's positioned text fragments into readable paragraphs.
   This is a heuristic reconstruction: it is intentionally conservative and never touches OCR. */

/** A stretch of text that looks the same all the way through (the PDF's own bold / italic / size). */
export interface Run {
  t: string;
  b?: boolean;
  i?: boolean;
  m?: boolean;
  /** size relative to the paragraph (1 = same), only set when it clearly differs */
  s?: number;
}
export interface Para {
  /** all the text (the runs joined): used for search and bookmarks */
  text: string;
  kind: 'p' | 'h';
  rtl: boolean;
  /** the styled pieces; absent when the paragraph is plain */
  runs?: Run[];
  /** paragraph size relative to the reading size (headings > 1, small print < 1); absent = 1 */
  scale?: number;
  /** the paragraph is centred on the page in the original */
  center?: boolean;
}
export interface PageText {
  paras: Para[];
  chars: number;
  endsOpen: boolean;
}

const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/g;
const LTR_RE = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/g;
/** Arabic combining marks (harakat, shadda, sukun, tanwin, dagger alef, Quranic signs). */
const MARK_ONLY = /^[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u08D3-\u08FF]+$/;
const TERMINATOR = /[.!?؟…:;"”»)\]’']\s*$/;

interface Frag { s: string; x: number; y: number; w: number; h: number; b: boolean; i: boolean; m: boolean }
interface RawRun { t: string; b: boolean; i: boolean; m: boolean; h: number }
interface Line { y: number; h: number; x0: number; x1: number; text: string; rtl: boolean; runs: RawRun[] }

const BOLD_RE = /bold|black|heavy|semibold|demi|extrabold|ultra|(?:^|[-,_ +])bd(?:$|[-,_ ])/i;
const ITALIC_RE = /italic|oblique|slanted/i;
const MONO_RE = /mono|courier|consolas|typewriter/i;
const sameStyle = (a: { b?: boolean; i?: boolean; m?: boolean; s?: number }, b: { b?: boolean; i?: boolean; m?: boolean; s?: number }) =>
  !!a.b === !!b.b && !!a.i === !!b.i && !!a.m === !!b.m && (a.s ?? 1) === (b.s ?? 1);

const isRtl = (s: string) => (s.match(RTL_RE)?.length ?? 0) > (s.match(LTR_RE)?.length ?? 0);
const median = (a: number[]) => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)];
};

export async function extractPage(doc: any, num: number): Promise<PageText> {
  const page = await doc.getPage(num);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  // pdf.js only knows the real font names (Arial-BoldMT, …) once the page's operators have been read
  try {
    await page.getOperatorList();
  } catch {
    /* styles then come from the CSS family only */
  }
  page.cleanup?.();

  /* the real font name (and its bold / italic flags) when pdf.js has it, else the CSS family it reports */
  const fontCache = new Map<string, { b: boolean; i: boolean; m: boolean }>();
  const fontInfo = (id: string) => {
    let f = fontCache.get(id);
    if (f) return f;
    let name = '';
    let bold = false;
    let italic = false;
    try {
      const o = page.commonObjs?.has?.(id) ? page.commonObjs.get(id) : null;
      if (o) {
        name = String(o.name ?? o.fallbackName ?? '');
        bold = !!(o.bold || o.black);
        italic = !!o.italic;
      }
    } catch {
      /* font object not available yet: fall back to the family below */
    }
    const fam = String((tc.styles as any)?.[id]?.fontFamily ?? '');
    const label = `${name} ${fam}`;
    f = { b: bold || BOLD_RE.test(label), i: italic || ITALIC_RE.test(label), m: MONO_RE.test(label) || /^monospace$/i.test(fam) };
    fontCache.set(id, f);
    return f;
  };

  const frags: Frag[] = [];
  for (const it of tc.items as any[]) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const t = it.transform as number[];
    const h = Math.hypot(t[2], t[3]) || it.height || 10;
    const fi = fontInfo(String(it.fontName ?? ''));
    frags.push({ s: it.str, x: t[4], y: t[5], w: it.width ?? 0, h, b: fi.b, i: fi.i, m: fi.m });
  }
  if (!frags.length) return { paras: [], chars: 0, endsOpen: false };

  /* ---- attach stand-alone diacritics to the letter they sit on ----
     Many PDFs draw harakat as separate glyphs placed above/below the letter. If they were treated as
     ordinary fragments they would be sorted by x and end up before their letter (or get a space). */
  {
    const marks = frags.filter((f) => MARK_ONLY.test(f.s.trim()));
    if (marks.length) {
      const bases = frags.filter((f) => !MARK_ONLY.test(f.s.trim()));
      for (const m of marks) {
        const cx = m.w > 0.5 ? m.x + m.w / 2 : m.x;
        let best: Frag | null = null;
        let bestD = Infinity;
        for (const b of bases) {
          if (Math.abs(b.y - m.y) > b.h * 1.6) continue;
          if (cx < b.x - b.h * 0.3 || cx > b.x + b.w + b.h * 0.3) continue;
          const d = Math.abs(b.x + b.w / 2 - cx);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
        if (!best) continue;
        const mark = m.s.trim();
        const len = best.s.length;
        if (len <= 2 || best.w <= 0) {
          best.s += mark;
        } else {
          const rtl = isRtl(best.s);
          const rel = Math.min(1, Math.max(0, rtl ? (best.x + best.w - cx) / best.w : (cx - best.x) / best.w));
          // insert after the letter under the mark (skipping marks already present)
          let idx = Math.min(len - 1, Math.floor(rel * len));
          while (idx < len - 1 && MARK_ONLY.test(best.s[idx])) idx++;
          best.s = best.s.slice(0, idx + 1) + mark + best.s.slice(idx + 1);
        }
      }
      frags.splice(0, frags.length, ...bases);
      if (!frags.length) return { paras: [], chars: 0, endsOpen: false };
    }
  }

  /* ---- group fragments into lines ---- */
  frags.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: Frag[][] = [];
  for (const f of frags) {
    const g = groups.find((gr) => {
      const ref = gr[0];
      return Math.abs(ref.y - f.y) < 0.45 * Math.max(ref.h, f.h);
    });
    g ? g.push(f) : groups.push([f]);
  }
  const lines: Line[] = groups.map((gr) => {
    const joined = gr.map((f) => f.s).join('');
    const rtl = isRtl(joined);
    gr.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    const h = Math.max(...gr.map((f) => f.h));
    const runs: RawRun[] = [];
    const push = (t: string, f: Frag) => {
      const last = runs[runs.length - 1];
      if (last && last.b === f.b && last.i === f.i && last.m === f.m && Math.abs(last.h - f.h) < 0.12 * f.h) last.t += t;
      else runs.push({ t, b: f.b, i: f.i, m: f.m, h: f.h });
    };
    let text = '';
    gr.forEach((f, k) => {
      if (k > 0) {
        const prev = gr[k - 1];
        const gap = rtl ? prev.x - (f.x + f.w) : f.x - (prev.x + prev.w);
        // Word gaps are ~0.25em; the gap after Arabic non-joining letters (ا د ذ ر ز و) is far smaller.
        const word = gap > (rtl ? 0.24 : 0.17) * h;
        if (word && !text.endsWith(' ') && !f.s.startsWith(' ') && !MARK_ONLY.test(f.s[0])) {
          text += ' ';
          push(' ', prev);
        }
      }
      text += f.s;
      push(f.s, f);
    });
    return {
      y: gr.reduce((a, f) => a + f.y, 0) / gr.length,
      h,
      x0: Math.min(...gr.map((f) => f.x)),
      x1: Math.max(...gr.map((f) => f.x + f.w)),
      text: text.replace(/\s+/g, ' ').trim(),
      rtl,
      runs,
    };
  });
  lines.sort((a, b) => b.y - a.y);

  /* ---- drop page numbers / running heads at the extreme top or bottom ---- */
  const H = vp.height;
  const kept = lines.filter((l) => {
    const edge = l.y > H * 0.93 || l.y < H * 0.07;
    return !(edge && /^[\d\s\-–—•.٠-٩]{1,8}$/.test(l.text));
  });
  if (!kept.length) return { paras: [], chars: 0, endsOpen: false };

  const body = median(kept.map((l) => l.h));
  const gaps: number[] = [];
  for (let i = 1; i < kept.length; i++) {
    const d = kept[i - 1].y - kept[i].y;
    if (d > 0 && d < body * 3) gaps.push(d);
  }
  const typical = median(gaps) || body * 1.3;
  const colLeft = median(kept.map((l) => l.x0).sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(kept.length * 0.3))));
  const colRight = median(kept.map((l) => l.x1).sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(kept.length * 0.3))));
  const colW = Math.max(1, colRight - colLeft);
  const isHead = (l: Line) => l.h > body * 1.22 && l.text.length < 140;
  const colMid = (colLeft + colRight) / 2;
  const isCentered = (l: Line) => l.x1 - l.x0 < colW * 0.8 && Math.abs((l.x0 + l.x1) / 2 - colMid) < colW * 0.05;

  /* ---- lines → paragraphs ---- */
  type Raw = { runs: RawRun[]; head: boolean; hs: number[]; centered: boolean; lines: number };
  const raws: Raw[] = [];
  let cur: Raw | null = null;
  let prev: Line | null = null;
  for (const l of kept) {
    const head = isHead(l);
    let startNew = !cur || !prev;
    if (!startNew && prev && cur) {
      const ended = TERMINATOR.test(prev.text);
      const bigGap = prev.y - l.y > typical * 1.55;
      const short = (prev.x1 - prev.x0) < colW * 0.8;
      const indent = l.rtl ? colRight - l.x1 > body * 0.8 : l.x0 - colLeft > body * 0.8;
      startNew = head !== cur.head || bigGap || (ended && (short || indent));
    }
    const runs = l.runs.map((r) => ({ ...r }));
    if (startNew) {
      cur = { runs, head, hs: [l.h], centered: isCentered(l), lines: 1 };
      raws.push(cur);
    } else if (cur) {
      const tail = cur.runs[cur.runs.length - 1];
      if (tail && tail.t.endsWith('-') && /^[a-zà-ÿ]/.test(l.text)) tail.t = tail.t.slice(0, -1);
      else if (tail) tail.t += ' ';
      cur.runs.push(...runs);
      cur.hs.push(l.h);
      cur.centered = cur.centered && isCentered(l);
      cur.lines++;
    }
    prev = l;
  }

  const q = (v: number) => Math.round(v * 20) / 20;
  const paras: Para[] = [];
  for (const r of raws) {
    // normalise each run, glue neighbours that look the same, collapse spaces across run borders
    const ref = median(r.hs) || body;
    const runs: Run[] = [];
    for (const rr of r.runs) {
      const t = rr.t.normalize('NFKC').replace(/\s+/g, ' ');
      if (!t) continue;
      const rel = rr.h / ref;
      const run: Run = { t };
      if (rr.b) run.b = true;
      if (rr.i) run.i = true;
      if (rr.m) run.m = true;
      if (Math.abs(rel - 1) > 0.14) run.s = Math.min(1.8, Math.max(0.6, q(rel)));
      const last = runs[runs.length - 1];
      if (last && sameStyle(last, run)) last.t += run.t;
      else {
        if (last && last.t.endsWith(' ') && run.t.startsWith(' ')) run.t = run.t.slice(1);
        runs.push(run);
      }
    }
    if (runs.length) {
      runs[0].t = runs[0].t.replace(/^\s+/, '');
      runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, '');
    }
    const live = runs.filter((x) => x.t.length > 0);
    const text = live.map((x) => x.t).join('');
    if (!text) continue;

    const para: Para = { text, kind: r.head ? 'h' : 'p', rtl: isRtl(text) };
    // paragraph size: headings and small print keep their proportion to the body text
    const ratio = ref / body;
    if (r.head) para.scale = Math.min(1.9, Math.max(1.05, q(ratio)));
    else if (Math.abs(ratio - 1) > 0.12) para.scale = Math.min(1.5, Math.max(0.7, q(ratio)));
    if (r.centered && r.lines <= 4) para.center = true;
    // keep run styles only when something differs from plain text (a bold heading is already bold)
    const plainish = live.every((x) => !x.i && !x.m && x.s === undefined && (!x.b || r.head));
    if (!plainish) {
      para.runs = live.map((x) => (r.head && x.b ? { ...x, b: undefined } : x)).map((x) => {
        const o: Run = { t: x.t };
        if (x.b) o.b = true;
        if (x.i) o.i = true;
        if (x.m) o.m = true;
        if (x.s !== undefined) o.s = x.s;
        return o;
      });
      // size differences inside a heading are already carried by the heading's own scale
      if (r.head) para.runs.forEach((x) => delete x.s);
      if (para.runs.every((x) => !x.b && !x.i && !x.m && x.s === undefined)) delete para.runs;
    }
    paras.push(para);
  }

  const last = paras[paras.length - 1];
  return {
    paras,
    chars: paras.reduce((a, p) => a + p.text.length, 0),
    endsOpen: !!last && last.kind === 'p' && !TERMINATOR.test(last.text),
  };
}
