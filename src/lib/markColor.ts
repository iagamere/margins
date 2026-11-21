import type { ThemeName } from './types';

/** The colour of a bookmark: its own choice, else the app-wide "Bookmark colour", else the theme's default. */
export function resolveMarkColor(own: string | undefined, global: string | undefined, theme: ThemeName): string {
  const pick = own || (global && global !== 'auto' ? global : '');
  if (pick && /^#[0-9a-f]{6}$/i.test(pick)) return pick;
  return theme === 'dark' ? '#d98b7f' : theme === 'sepia' ? '#a4493d' : '#b0503f';
}

/** A soft, see-through version of the colour for tinting the marked sentence (not a loud highlighter). */
export function softFill(hex: string, theme: ThemeName): string {
  const n = parseInt(hex.slice(1), 16);
  const a = theme === 'dark' ? 0.34 : 0.26;
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`;
}
