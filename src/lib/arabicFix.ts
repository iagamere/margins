/**
 * Arabic ligature repair for PDF text extraction.
 *
 * Root cause: PDF fonts map ligature glyphs (e.g. lam‑alef) to MULTI‑character
 * ToUnicode values ("لا"). When pdf.js extracts a right‑to‑left run it reverses
 * the whole string to get logical order — and that also reverses the characters
 * *inside* each ligature, giving "ال" instead of "لا", "أل" instead of "لأ", etc.
 *
 * Fix: before extraction, rewrite every multi‑character Arabic ToUnicode value
 * in reverse, so pdf.js's reversal puts them back in logical order.
 * Only text extraction is affected — rendering never uses ToUnicode.
 */
import { PDFDocument, PDFName, PDFDict, PDFRef, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

const ARABIC = /^[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+$/;

function fixCMap(src: string): string | null {
  let changed = false;
  const out = src.replace(/beginbfchar([\s\S]*?)endbfchar/g, (_m, body: string) => {
    const nb = body.replace(/<([0-9A-Fa-f]+)>(\s*)<([0-9A-Fa-f]{8,})>/g, (m, a: string, sp: string, dst: string) => {
      if (dst.length % 4) return m;
      const units: string[] = dst.match(/.{4}/g) || [];
      const text = units.map((u) => String.fromCharCode(parseInt(u, 16))).join('');
      if (!ARABIC.test(text)) return m;
      changed = true;
      return `<${a}>${sp}<${units.reverse().join('')}>`;
    });
    return 'beginbfchar' + nb + 'endbfchar';
  });
  // bfrange sections: "<lo> <hi> <dst>" with a multi‑character destination
  const out2 = out.replace(/beginbfrange([\s\S]*?)endbfrange/g, (_m, body: string) => {
    // array form: "<lo> <hi> [<d1> <d2> …]"
    body = body.replace(/\[([^\]]*)\]/g, (m, inner: string) => {
      const r = inner.replace(/<([0-9A-Fa-f]{8,})>/g, (mm, dst: string) => {
        if (dst.length % 4) return mm;
        const units: string[] = dst.match(/.{4}/g) || [];
        const text = units.map((u) => String.fromCharCode(parseInt(u, 16))).join('');
        if (!ARABIC.test(text)) return mm;
        changed = true;
        return `<${units.reverse().join('')}>`;
      });
      return `[${r}]`;
    });
    const nb = body.replace(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]{8,})>/g, (m, lo: string, hi: string, dst: string) => {
      if (dst.length % 4) return m;
      const units: string[] = dst.match(/.{4}/g) || [];
      const text = units.map((u) => String.fromCharCode(parseInt(u, 16))).join('');
      if (!ARABIC.test(text)) return m;
      const a = parseInt(lo, 16), b = parseInt(hi, 16);
      if (b < a || b - a > 256) return m;
      changed = true;
      const w = lo.length;
      const rows: string[] = [];
      for (let c = a; c <= b; c++) {
        const u = units.slice();
        u[u.length - 1] = (parseInt(u[u.length - 1], 16) + (c - a)).toString(16).toUpperCase().padStart(4, '0');
        const code = c.toString(16).toUpperCase().padStart(w, '0');
        rows.push(`<${code}> <${code}> <${u.reverse().join('')}>`);
      }
      return rows.join('\n');
    });
    return 'beginbfrange' + nb + 'endbfrange';
  });
  return changed ? out2 : null;
}

/** Returns patched PDF bytes, or null when nothing needed fixing / patching failed. */
export async function fixArabicLigatures(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const ctx = doc.context;
    const done = new Set<string>();
    let any = false;
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const tuRef = obj.get(PDFName.of('ToUnicode'));
      if (!(tuRef instanceof PDFRef)) continue;
      const key = tuRef.toString();
      if (done.has(key)) continue;
      done.add(key);
      const stream = ctx.lookup(tuRef);
      if (!(stream instanceof PDFRawStream)) continue;
      let text: string;
      try {
        text = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
      } catch { continue; }
      const fixed = fixCMap(text);
      if (!fixed) continue;
      const u8 = new Uint8Array(fixed.length);
      for (let i = 0; i < fixed.length; i++) u8[i] = fixed.charCodeAt(i) & 255;
      ctx.assign(tuRef, ctx.flateStream(u8));
      any = true;
    }
    if (!any) return null;
    return await doc.save({ useObjectStreams: false });
  } catch {
    return null;
  }
}
