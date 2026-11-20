import type { AccentName, ThemeName } from './types';
import { hexToRgb, isHex, rgbToHsl } from './color';

/** Stock (olive) colours — the same values as tokens.css. */
export const THEME_COLORS: Record<ThemeName, { bg: string; fg: string; fg2: string; accent: string }> = {
  light: { bg: '#F6F4EF', fg: '#252824', fg2: '#77776F', accent: '#5F6954' },
  dark: { bg: '#191B19', fg: '#EAE8E1', fg2: '#AAA99F', accent: '#A2AE91' },
  sepia: { bg: '#F0E5D0', fg: '#43392F', fg2: '#776858', accent: '#6B5A3E' },
};

/**
 * Muted, earthy accents in the same family as the default olive.
 * `hue` tints the whole interface (backgrounds, surfaces, borders, text) — not only the buttons.
 * `ink` is the accessible shade for text/buttons on light + sepia, `dark` the shade for the dark theme.
 * Olive is the stock palette from tokens.css and needs no override.
 */
export const ACCENTS: Record<AccentName, { swatch: string; hue: number; light: { accent: string; ink: string } | null; dark: string | null }> = {
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
  const [h, s0] = rgbToHsl(...hexToRgb(hex));
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
function tint(hue: number, theme: 'light' | 'dark'): Tint {
  return theme === 'light'
    ? { bg: hsl(hue, 0.22, 0.955), bg2: hsl(hue, 0.18, 0.925), surface: '#ffffff', fg: hsl(hue, 0.12, 0.15), fg2: hsl(hue, 0.07, 0.43), border: hsl(hue, 0.16, 0.885) }
    : { bg: hsl(hue, 0.08, 0.1), bg2: hsl(hue, 0.08, 0.13), surface: hsl(hue, 0.09, 0.165), fg: hsl(hue, 0.14, 0.9), fg2: hsl(hue, 0.07, 0.66), border: hsl(hue, 0.09, 0.23) };
}

/** bg / fg / fg2 / link colour of a reading theme under the chosen accent (sepia keeps its own paper). */
export function themeColors(name: AccentName, theme: ThemeName): { bg: string; fg: string; fg2: string; accent: string } {
  const a = ACCENTS[name];
  const stock = THEME_COLORS[theme];
  if (!a?.light || !a.dark) return stock;
  if (theme === 'sepia') return { ...stock, accent: a.light.ink };
  const t = tint(a.hue, theme);
  return { bg: t.bg, fg: t.fg, fg2: t.fg2, accent: theme === 'dark' ? a.dark : a.light.ink };
}

/**
 * CSS that re-colours the whole interface for every theme. A single <style> is used (rather than :root overrides)
 * because the reader sets its own data-theme and PDF pages have their own backdrop.
 */
export function accentCss(name: AccentName): string {
  const a = ACCENTS[name];
  if (!a?.light || !a.dark) return '';
  const L = tint(a.hue, 'light');
  const D = tint(a.hue, 'dark');
  const light = `[data-theme='light']{--bg:${L.bg};--bg2:${L.bg2};--surface:${L.surface};--fg:${L.fg};--fg2:${L.fg2};--border:${L.border};--accent:${a.light.accent};--accent-ink:${a.light.ink};--overlay:${hsl(a.hue, 0.15, 0.15)}61;--shadow:0 1px 2px ${hsl(a.hue, 0.12, 0.15)}0f,0 8px 24px ${hsl(a.hue, 0.12, 0.15)}14;}`;
  const dark = `[data-theme='dark']{--bg:${D.bg};--bg2:${D.bg2};--surface:${D.surface};--fg:${D.fg};--fg2:${D.fg2};--border:${D.border};--accent:${a.dark};--accent-ink:${a.dark};--on-accent:${D.bg};}`;
  const sepia = `[data-theme='sepia']{--accent:${a.light.accent};--accent-ink:${a.light.ink};}`;
  const pdf = `.reader[data-theme='light'] .pdf-scroller{--pdf-bg:${hsl(a.hue, 0.1, 0.9)};}.reader[data-theme='dark'] .pdf-scroller{--pdf-bg:${hsl(a.hue, 0.08, 0.075)};}`;
  return light + dark + sepia + pdf;
}
