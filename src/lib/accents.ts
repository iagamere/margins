import type { AccentName, ThemeName } from './types';
import { hexToRgb, isHex, rgbToHsl } from './color';

/** Stock (olive) colours — the same values as tokens.css. */
export const THEME_COLORS: Record<ThemeName, { bg: string; fg: string; fg2: string; accent: string }> = {
  light: { bg: '#f5f7f9', fg: '#16181a', fg2: '#5f656b', accent: '#16181a' },
  dark: { bg: '#0e0f10', fg: '#ecedee', fg2: '#a0a3a6', accent: '#dfe3e7' },
  sepia: { bg: '#F0E5D0', fg: '#43392F', fg2: '#776858', accent: '#6B5A3E' },
};

/**
 * Muted, earthy accents in the same family as the default olive.
 * `hue` tints the whole interface (backgrounds, surfaces, borders, text) — not only the buttons.
 * `ink` is the accessible shade for text/buttons on light + sepia, `dark` the shade for the dark theme.
 * The stock palette in tokens.css is the black/white one (mono); olive has its own block (OLIVE_CSS).
 */
export const ACCENTS: Record<AccentName, { swatch: string; hue: number; light: { accent: string; ink: string } | null; dark: string | null; neutral?: boolean }> = {
  // Charcoal black / snow white: no hue. Charcoal ink on the light theme, snow ink on the dark one.
  mono: { swatch: 'linear-gradient(135deg, #16181a 50%, #f5f7f9 50%)', hue: 0, neutral: true, light: { accent: '#26292c', ink: '#16181a' }, dark: '#dfe3e7' },
  olive: { swatch: '#78816c', hue: 86, light: null, dark: null },
  clay: { swatch: '#a27061', hue: 14, light: { accent: '#a27061', ink: '#865c4f' }, dark: '#c7a297' },
  ochre: { swatch: '#947d4f', hue: 40, light: { accent: '#947d4f', ink: '#76643f' }, dark: '#bea77a' },
  sea: { swatch: '#5c8885', hue: 176, light: { accent: '#5c8885', ink: '#4a6c6a' }, dark: '#7eb4b0' },
  slate: { swatch: '#677f95', hue: 208, light: { accent: '#677f95', ink: '#54687a' }, dark: '#96adc1' },
  plum: { swatch: '#8d7396', hue: 285, light: { accent: '#8d7396', ink: '#755e7d' }, dark: '#bba1c3' },
  rose: { swatch: '#9c707b', hue: 345, light: { accent: '#9c707b', ink: '#835b65' }, dark: '#c99faa' },
  cocoa: { swatch: '#907966', hue: 26, light: { accent: '#907966', ink: '#766253' }, dark: '#bda693' },
  // filled in by setCustomAccent()
  custom: { swatch: '#6b7fa8', hue: 220, light: null, dark: null },
};

export const PRESET_ACCENTS = (Object.keys(ACCENTS) as AccentName[]).filter((a) => a !== 'custom');

/** Derives a full muted accent (light / sepia / dark shades and the tint hue) from any colour the user picked. */
export function setCustomAccent(hex: string) {
  if (!isHex(hex)) return;
  const [h, s0, l0] = rgbToHsl(...hexToRgb(hex));
  // Black / white / grey: no hue at all. Forcing a minimum saturation here is what turned them brown.
  if (s0 < 0.12 || l0 < 0.1 || l0 > 0.92) {
    ACCENTS.custom =
      l0 >= 0.5
        ? // snow white: snow-white accent on dark, deep charcoal ink on light (white on white would vanish)
          { swatch: hex, hue: 0, neutral: true, light: { accent: '#3a3f44', ink: '#2b2f33' }, dark: '#f3f6f9' }
        : // deep charcoal black: charcoal on light, soft snow on dark
          { swatch: hex, hue: 0, neutral: true, light: { accent: '#26292c', ink: '#16181a' }, dark: '#dfe3e7' };
    return;
  }
  const s = Math.min(0.5, Math.max(0.22, s0));
  ACCENTS.custom = {
    swatch: hex,
    hue: h,
    light: { accent: hsl(h, s, 0.52), ink: hsl(h, s, 0.4) },
    dark: hsl(h, s, 0.7),
  };
}

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];

function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

interface Tint {
  bg: string; bg2: string; surface: string; fg: string; fg2: string; border: string;
}

/** Neutrals for light / dark tinted with the accent hue (same lightness steps as the stock palette). */
function tint(hue: number, theme: 'light' | 'dark', neutral = false): Tint {
  if (neutral) {
    // colourless: deep carbon in dark, cool snow in light — no warm or brown cast anywhere
    return theme === 'light'
      ? { bg: '#f5f7f9', bg2: '#ebeef1', surface: '#ffffff', fg: '#16181a', fg2: '#5f656b', border: '#dfe3e7' }
      : { bg: '#0e0f10', bg2: '#151617', surface: '#1c1d1f', fg: '#ecedee', fg2: '#a0a3a6', border: '#2a2c2e' };
  }
  return theme === 'light'
    ? { bg: hsl(hue, 0.22, 0.955), bg2: hsl(hue, 0.18, 0.925), surface: '#ffffff', fg: hsl(hue, 0.12, 0.15), fg2: hsl(hue, 0.07, 0.43), border: hsl(hue, 0.16, 0.885) }
    : { bg: hsl(hue, 0.08, 0.1), bg2: hsl(hue, 0.08, 0.13), surface: hsl(hue, 0.09, 0.165), fg: hsl(hue, 0.14, 0.9), fg2: hsl(hue, 0.07, 0.66), border: hsl(hue, 0.09, 0.23) };
}

/** bg / fg / fg2 / link colour of a reading theme under the chosen accent (sepia keeps its own paper). */
export function themeColors(name: AccentName, theme: ThemeName): { bg: string; fg: string; fg2: string; accent: string } {
  const a = ACCENTS[name];
  const stock = THEME_COLORS[theme];
  if (name === 'olive') return theme === 'light' ? { bg: '#F6F4EF', fg: '#252824', fg2: '#77776F', accent: '#5F6954' } : theme === 'dark' ? { bg: '#191B19', fg: '#EAE8E1', fg2: '#AAA99F', accent: '#A2AE91' } : stock;
  if (!a?.light || !a.dark) return stock;
  if (theme === 'sepia') return { ...stock, accent: a.light.ink };
  const t = tint(a.hue, theme, a.neutral);
  return { bg: t.bg, fg: t.fg, fg2: t.fg2, accent: theme === 'dark' ? a.dark : a.light.ink };
}

/**
 * CSS that re-colours the whole interface for every theme. A single <style> is used (rather than :root overrides)
 * because the reader sets its own data-theme and PDF pages have their own backdrop.
 */
const OLIVE_CSS =
  "[data-theme='light']{--bg:#f6f4ef;--bg2:#edeae3;--surface:#ffffff;--fg:#252824;--fg2:#77776f;--border:#e4e0d7;--accent:#78816c;--accent-ink:#5f6954;--overlay:rgba(37,40,36,0.38);--shadow:0 1px 2px rgba(37,40,36,0.06),0 8px 24px rgba(37,40,36,0.08);}" +
  "[data-theme='dark']{--bg:#191b19;--bg2:#222521;--surface:#292d28;--fg:#eae8e1;--fg2:#aaa99f;--border:#383d36;--accent:#a2ae91;--accent-ink:#a2ae91;--on-accent:#191b19;--overlay:rgba(0,0,0,0.55);--shadow:0 1px 2px rgba(0,0,0,0.3),0 8px 24px rgba(0,0,0,0.35);}" +
  "[data-theme='sepia']{--accent:#8a7a55;--accent-ink:#6b5a3e;}";

export function accentCss(name: AccentName): string {
  if (name === 'olive') return OLIVE_CSS;
  const a = ACCENTS[name];
  if (!a?.light || !a.dark) return '';
  const L = tint(a.hue, 'light', a.neutral);
  const D = tint(a.hue, 'dark', a.neutral);
  const sat = a.neutral ? 0 : 1;
  const light = `[data-theme='light']{--bg:${L.bg};--bg2:${L.bg2};--surface:${L.surface};--fg:${L.fg};--fg2:${L.fg2};--border:${L.border};--accent:${a.light.accent};--accent-ink:${a.light.ink};--overlay:${hsl(a.hue, 0.15 * sat, 0.15)}61;--shadow:0 1px 2px ${hsl(a.hue, 0.12 * sat, 0.15)}0f,0 8px 24px ${hsl(a.hue, 0.12 * sat, 0.15)}14;}`;
  const dark = `[data-theme='dark']{--bg:${D.bg};--bg2:${D.bg2};--surface:${D.surface};--fg:${D.fg};--fg2:${D.fg2};--border:${D.border};--accent:${a.dark};--accent-ink:${a.dark};--on-accent:${D.bg};}`;
  const sepia = `[data-theme='sepia']{--accent:${a.light.accent};--accent-ink:${a.light.ink};}`;
  const pdf = `.reader[data-theme='light'] .pdf-scroller{--pdf-bg:${hsl(a.hue, 0.1 * sat, 0.9)};}.reader[data-theme='dark'] .pdf-scroller{--pdf-bg:${hsl(a.hue, 0.08 * sat, 0.075)};}`;
  return light + dark + sepia + pdf;
}
