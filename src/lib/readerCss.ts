import type { ReadFont, Settings, ThemeName } from './types';

export const THEME_COLORS: Record<ThemeName, { bg: string; fg: string; fg2: string; accent: string }> = {
  light: { bg: '#F6F4EF', fg: '#252824', fg2: '#77776F', accent: '#5F6954' },
  dark: { bg: '#191B19', fg: '#EAE8E1', fg2: '#AAA99F', accent: '#A2AE91' },
  sepia: { bg: '#F0E5D0', fg: '#43392F', fg2: '#776858', accent: '#6B5A3E' },
};

export const HIGHLIGHT_COLORS = {
  sage: { fill: '#8FA17B', label: 'sage' },
  gold: { fill: '#D2A95F', label: 'gold' },
  rose: { fill: '#C98B84', label: 'rose' },
  sky: { fill: '#7FA3B8', label: 'sky' },
} as const;

const STACKS: Record<Exclude<ReadFont, 'auto' | 'original'>, string> = {
  literata: "'Literata', 'Source Serif 4', Georgia, 'Times New Roman', serif",
  sourceSerif: "'Source Serif 4', 'Literata', Georgia, 'Times New Roman', serif",
  naskh: "'Noto Naskh Arabic', 'Literata', 'Traditional Arabic', serif",
  amiri: "'Amiri', 'Noto Naskh Arabic', 'Traditional Arabic', serif",
  cairo: "'Cairo', 'IBM Plex Sans Arabic', system-ui, sans-serif",
  plexArabic: "'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif",
  inter: "'Inter', 'IBM Plex Sans Arabic', system-ui, sans-serif",
};

export function resolveFont(font: ReadFont, rtlBook: boolean): { stack: string | null; arabicScale: number } {
  if (font === 'original') return { stack: null, arabicScale: 1 };
  const key = font === 'auto' ? (rtlBook ? 'naskh' : 'literata') : font;
  const arabicFont = key === 'naskh' || key === 'plexArabic' || key === 'amiri' || key === 'cairo';
  return { stack: STACKS[key], arabicScale: arabicFont && rtlBook ? 1.1 : 1 };
}

/** CSS injected into every EPUB chapter document. User preferences intentionally override publisher styling for readability. */
export function buildEpubCss(s: Settings, theme: ThemeName, rtlBook: boolean): string {
  const c = THEME_COLORS[theme];
  const { stack, arabicScale } = resolveFont(s.font, rtlBook);
  const size = Math.round(s.fontSize * arabicScale * 10) / 10;
  const align =
    s.textAlign === 'original'
      ? ''
      : s.textAlign === 'justify'
        ? 'text-align: justify !important; text-justify: inter-word;'
        : 'text-align: start !important;';
  const lh = rtlBook ? Math.round(s.lineHeight * 1.12 * 100) / 100 : s.lineHeight;
  const family = stack ? `font-family: ${stack} !important;` : '';
  const textEls =
    'body, p, li, blockquote, dd, dt, td, th, div, span, em, strong, i, b, small, cite, q, h1, h2, h3, h4, h5, h6, figcaption, caption, label';
  return `
html { color-scheme: ${theme === 'dark' ? 'dark' : 'light'}; -webkit-text-size-adjust: 100%; }
${rtlBook ? ':where(html:not([dir])) { direction: rtl; }' : ''}
html, body { background: transparent !important; color: ${c.fg} !important; }
body { font-size: ${size}px !important; line-height: ${lh} !important; overflow-wrap: break-word; word-wrap: break-word; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
${textEls} { color: ${c.fg} !important; background-color: transparent !important; ${family} }
p, li, blockquote, dd, dt { font-size: 1em !important; line-height: ${lh} !important; ${align} }
p { margin-top: 0 !important; margin-bottom: ${s.paragraphSpacing}em !important; orphans: 2; widows: 2; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3 !important; text-align: start; }
a, a * { color: ${c.accent} !important; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
pre, code, kbd, samp { font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace !important; font-size: 0.9em !important; }
img, svg, video { max-width: 100%; }
table { border-color: ${c.fg2} !important; }
hr { border-color: ${c.fg2} !important; opacity: 0.4; }
::selection { background: ${c.accent}55; }
${
  rtlBook
    ? `/* Arabic: letter-spacing breaks letter joining; keep shaping features and diacritics intact */
*, *::before, *::after { letter-spacing: normal !important; word-spacing: normal !important; font-variant-ligatures: normal !important; font-feature-settings: normal !important; font-kerning: normal !important; text-transform: none !important; hyphens: none !important; }
`
    : ''
}`;
}

/** Copies the @font-face rules of the host document so book iframes can use the bundled fonts offline. */
let fontCssCache: string | null = null;
export function collectFontFaceCss(): string {
  if (fontCssCache) return fontCssCache;
  let out = '';
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const base = sheet.href || document.baseURI;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) {
        out +=
          rule.cssText.replace(/url\((["']?)(.*?)\1\)/g, (_m, _q, u: string) => {
            try {
              return `url("${new URL(u, base).href}")`;
            } catch {
              return _m;
            }
          }) + '\n';
      }
    }
  }
  if (out) fontCssCache = out;
  return out;
}
