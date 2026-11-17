/* Turns a PDF page's positioned text fragments into readable paragraphs.
   This is a heuristic reconstruction: it is intentionally conservative and never touches OCR. */

export interface Para {
  text: string;
  kind: 'p' | 'h';
  rtl: boolean;
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

interface Frag { s: string; x: number; y: number; w: number; h: number }
interface Line { y: number; h: number; x0: number; x1: number; text: string; rtl: boolean }

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
  page.cleanup?.();

  const frags: Frag[] = [];
  for (const it of tc.items as any[]) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const t = it.transform as number[];
    const h = Math.hypot(t[2], t[3]) || it.height || 10;
    frags.push({ s: it.str, x: t[4], y: t[5], w: it.width ?? 0, h });
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
    let text = '';
    gr.forEach((f, k) => {
      if (k > 0) {
        const prev = gr[k - 1];
        const gap = rtl ? prev.x - (f.x + f.w) : f.x - (prev.x + prev.w);
        // Word gaps are ~0.25em; the gap after Arabic non-joining letters (ا د ذ ر ز و) is far smaller.
        const word = gap > (rtl ? 0.24 : 0.17) * h;
        if (word && !text.endsWith(' ') && !f.s.startsWith(' ') && !MARK_ONLY.test(f.s[0])) text += ' ';
      }
      text += f.s;
    });
    return {
      y: gr.reduce((a, f) => a + f.y, 0) / gr.length,
      h,
      x0: Math.min(...gr.map((f) => f.x)),
      x1: Math.max(...gr.map((f) => f.x + f.w)),
      text: text.replace(/\s+/g, ' ').trim(),
      rtl,
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

  /* ---- lines → paragraphs ---- */
  type Raw = { text: string; head: boolean };
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
    if (startNew) {
      cur = { text: l.text, head };
      raws.push(cur);
    } else if (cur) {
      if (cur.text.endsWith('-') && /^[a-zà-ÿ]/.test(l.text)) cur.text = cur.text.slice(0, -1) + l.text;
      else cur.text += ' ' + l.text;
    }
    prev = l;
  }

  const paras: Para[] = raws
    .map((r) => {
      const text = r.text.normalize('NFKC').replace(/\s+/g, ' ').trim();
      return { text, kind: (r.head ? 'h' : 'p') as 'h' | 'p', rtl: isRtl(text) };
    })
    .filter((p) => p.text.length > 0);

  const last = paras[paras.length - 1];
  return {
    paras,
    chars: paras.reduce((a, p) => a + p.text.length, 0),
    endsOpen: !!last && last.kind === 'p' && !TERMINATOR.test(last.text),
  };
}
