import type { AccentName, ThemeName } from './types';

/**
 * Muted, earthy accent colours in the same family as the default olive (low saturation, warm-grey undertone).
 * `ink` is the accessible shade used for text/buttons on light + sepia (≥ 4.6:1 on both backgrounds);
 * `dark` is the lighter shade used on the dark theme (≥ 6:1 on its surfaces).
 * Olive is the stock palette defined in tokens.css, so it needs no override.
 */
export const ACCENTS: Record<AccentName, { swatch: string; light: { accent: string; ink: string } | null; dark: string | null }> = {
  olive: { swatch: '#78816c', light: null, dark: null },
  clay: { swatch: '#a27061', light: { accent: '#a27061', ink: '#865c4f' }, dark: '#c7a297' },
  ochre: { swatch: '#947d4f', light: { accent: '#947d4f', ink: '#76643f' }, dark: '#bea77a' },
  sea: { swatch: '#5c8885', light: { accent: '#5c8885', ink: '#4a6c6a' }, dark: '#7eb4b0' },
  slate: { swatch: '#677f95', light: { accent: '#677f95', ink: '#54687a' }, dark: '#96adc1' },
  plum: { swatch: '#8d7396', light: { accent: '#8d7396', ink: '#755e7d' }, dark: '#bba1c3' },
  rose: { swatch: '#9c707b', light: { accent: '#9c707b', ink: '#835b65' }, dark: '#c99faa' },
  cocoa: { swatch: '#907966', light: { accent: '#907966', ink: '#766253' }, dark: '#bda693' },
};

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];

/** CSS that re-colours --accent / --accent-ink for every theme (the reader has its own data-theme, so a :root override is not enough). */
export function accentCss(name: AccentName): string {
  const a = ACCENTS[name];
  if (!a?.light || !a.dark) return '';
  const rule = (theme: ThemeName, accent: string, ink: string) => `[data-theme='${theme}']{--accent:${accent};--accent-ink:${ink};}`;
  return rule('light', a.light.accent, a.light.ink) + rule('sepia', a.light.accent, a.light.ink) + rule('dark', a.dark, a.dark);
}

/** Link / selection colour inside EPUB pages. Returns null for olive so the stock value is kept. */
export function accentInk(name: AccentName, theme: ThemeName): string | null {
  const a = ACCENTS[name];
  if (!a?.light || !a.dark) return null;
  return theme === 'dark' ? a.dark : a.light.ink;
}
