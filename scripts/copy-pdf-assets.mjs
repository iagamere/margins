// Copies the PDF.js character maps and standard fonts into public/ so that
// PDFs which rely on them (CJK text, non-embedded base-14 fonts) render correctly offline.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'node_modules/pdfjs-dist');
const dest = resolve(root, 'public/pdfjs');

if (!existsSync(src)) {
  console.warn('[copy-pdf-assets] pdfjs-dist is not installed yet — skipping.');
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts']) {
  const from = resolve(src, dir);
  if (existsSync(from)) {
    cpSync(from, resolve(dest, dir), { recursive: true });
    console.log(`[copy-pdf-assets] copied ${dir}`);
  } else {
    console.warn(`[copy-pdf-assets] ${dir} not found in pdfjs-dist — skipping.`);
  }
}
