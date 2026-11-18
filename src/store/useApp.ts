import { create } from 'zustand';
import { clearAllData, deleteBook, getAllBooks, patchBook } from '../lib/db';
import { clearSettings, defaultSettings, loadSettings, saveSettings } from '../lib/settings';
import { importFile, type ImportResult } from '../lib/importer';
import type { BookRecord, Route, Settings, ThemeName } from '../lib/types';
import { uid } from '../lib/utils';

export interface Toast {
  id: string;
  kind: 'info' | 'error' | 'success';
  /** i18n key */
  key: string;
  params?: Record<string, string | number>;
}

interface AppState {
  settings: Settings;
  books: BookRecord[];
  booksLoaded: boolean;
  route: Route;
  history: Route[];
  toasts: Toast[];
  importing: { done: number; total: number } | null;
  /** The theme actually in effect for the app chrome. */
  resolvedTheme: ThemeName;

  init(): Promise<void>;
  setSettings(patch: Partial<Settings>): void;
  resetReading(): void;
  setResolvedTheme(t: ThemeName): void;

  navigate(r: Route, opts?: { replace?: boolean }): void;
  back(): boolean;

  importFiles(files: File[]): Promise<BookRecord | null>;
  updateBook(id: string, patch: Partial<BookRecord>): void;
  removeBook(id: string): Promise<void>;
  resetEverything(): Promise<void>;

  toast(key: string, kind?: Toast['kind'], params?: Toast['params']): void;
  dismissToast(id: string): void;
}

export const useApp = create<AppState>((set, get) => ({
  settings: loadSettings(),
  books: [],
  booksLoaded: false,
  route: { name: 'library' },
  history: [],
  toasts: [],
  importing: null,
  resolvedTheme: 'light',

  async init() {
    try {
      const books = await getAllBooks();
      set({ books, booksLoaded: true });
    } catch {
      set({ books: [], booksLoaded: true });
      get().toast('err.storageUnavailable', 'error');
    }
  },

  setSettings(patch) {
    const settings = { ...get().settings, ...patch };
    saveSettings(settings);
    set({ settings });
  },

  resetReading() {
    const d = defaultSettings();
    const cur = get().settings;
    const settings: Settings = {
      ...cur,
      readingMode: d.readingMode,
      font: d.font,
      fontSize: d.fontSize,
      lineHeight: d.lineHeight,
      paragraphSpacing: d.paragraphSpacing,
      margin: d.margin,
      maxWidth: d.maxWidth,
      textAlign: d.textAlign,
      textDir: d.textDir,
      textWeight: d.textWeight,
      markColor: d.markColor,
      magnet: d.magnet,
      readerTheme: d.readerTheme,
      pdfAdaptTheme: d.pdfAdaptTheme,
    };
    saveSettings(settings);
    set({ settings });
  },

  setResolvedTheme(t) {
    if (get().resolvedTheme !== t) set({ resolvedTheme: t });
  },

  navigate(r, opts) {
    const { route, history } = get();
    if (opts?.replace) set({ route: r });
    else set({ route: r, history: [...history, route].slice(-30) });
  },

  back() {
    const { history } = get();
    if (history.length === 0) return false;
    const prev = history[history.length - 1];
    set({ route: prev, history: history.slice(0, -1) });
    return true;
  },

  async importFiles(files) {
    if (!files.length) return null;
    set({ importing: { done: 0, total: files.length } });
    let last: BookRecord | null = null;
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      let res: ImportResult;
      try {
        res = await importFile(files[i]);
      } catch {
        res = { status: 'error', code: 'importFailed', fileName: files[i].name };
      }
      if (res.status === 'added') {
        added++;
        last = res.book;
        set({ books: [res.book, ...get().books] });
      } else if (res.status === 'duplicate') {
        last = res.book;
        get().toast('import.duplicate', 'info', { title: res.book.title });
      } else {
        get().toast(`err.${res.code}`, 'error', { name: res.fileName });
      }
      set({ importing: { done: i + 1, total: files.length } });
    }
    set({ importing: null });
    if (added === 1 && files.length === 1) get().toast('import.added', 'success', { title: last!.title });
    else if (added > 0) get().toast('import.addedMany', 'success', { count: added });
    return last;
  },

  updateBook(id, patch) {
    set({ books: get().books.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
    void patchBook(id, patch).catch(() => undefined);
  },

  async removeBook(id) {
    try {
      await deleteBook(id);
      set({ books: get().books.filter((b) => b.id !== id) });
      get().toast('library.removed', 'info');
    } catch {
      get().toast('err.importFailed', 'error', { name: '' });
    }
  },

  async resetEverything() {
    try {
      await clearAllData();
    } catch {
      /* ignore */
    }
    clearSettings();
    set({ books: [], settings: defaultSettings(), route: { name: 'library' }, history: [] });
    get().toast('settings.cleared', 'info');
  },

  toast(key, kind = 'info', params) {
    const id = uid();
    set({ toasts: [...get().toasts, { id, key, kind, params }].slice(-3) });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
