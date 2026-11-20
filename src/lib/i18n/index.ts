import { useApp } from '../../store/useApp';
import type { Lang } from '../types';
import { intlLocale } from '../utils';
import { en, type Dict } from './en';
import { ar } from './ar';
import { fr } from './fr';

export type TKey = keyof Dict;
const dicts: Record<Lang, Dict> = { en, ar, fr };

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const d = dicts[lang] as Record<string, string>;
  let s = d[key] ?? (en as Record<string, string>)[key] ?? key;
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (_m, k: string) => (k in params ? String(params[k]) : `{${k}}`));
  }
  return s;
}

export type TFn = (key: TKey | (string & {}), params?: Record<string, string | number>) => string;

export function useT() {
  const lang = useApp((s) => s.settings.lang);
  const t: TFn = (key, params) => translate(lang, key, params);
  const n = (v: number) => new Intl.NumberFormat(intlLocale(lang)).format(v);
  // The interface layout is always LTR, whatever the language: only the text changes.
  return { t, lang, dir: 'ltr' as const, n };
}

export const LANG_NAMES: Record<Lang, string> = { ar: 'العربية', fr: 'Français', en: 'English' };
