import type { Lang, Settings } from './types';

const KEY = 'margins.settings';

export function detectLang(): Lang {
  const l = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return l === 'ar' || l === 'fr' ? (l as Lang) : 'en';
}

export const DEFAULT_READING = {
  readingMode: 'paged',
  font: 'auto',
  fontSize: 19,
  lineHeight: 1.7,
  paragraphSpacing: 0.6,
  margin: 14,
  maxWidth: 720,
  textAlign: 'original',
  textDir: 'auto',
  textWeight: 'regular',
  markColor: 'auto',
  magnet: true,
  readerTheme: 'auto',
  pdfAdaptTheme: false,
} as const satisfies Partial<Settings>;

export function defaultSettings(): Settings {
  return {
    lang: detectLang(),
    theme: 'system',
    pdfReflow: false,
    libraryView: 'grid',
    librarySort: 'opened',
    ...DEFAULT_READING,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...d, ...parsed };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore quota/private mode */
  }
}

export function clearSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
