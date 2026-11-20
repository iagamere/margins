import { create } from 'zustand';
import { clearAllData, deleteBook, duplicateBook, getAllBooks, getShelves, patchBook, saveShelves } from '../lib/db';
import { clearSettings, defaultSettings, loadSettings, saveSettings } from '../lib/settings';
import { importFile, type ImportResult } from '../lib/importer';
import type { BookRecord, Route, Settings, ShelfRecord, ThemeName } from '../lib/types';
import { uid } from '../lib/utils';
import { TRIM_VERSION, trimExistingCovers } from '../lib/trim';
import { AppError } from '../lib/types';

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
  shelves: ShelfRecord[];
  /** shelf currently opened in the library (kept when going to a book and back) */
  openShelf: string | null;
  /** books waiting to be pasted (cut = move, copy = duplicate) */
  clipboard: { mode: 'cut' | 'copy'; ids: string[] } | null;
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

  importFiles(files: File[], shelfId?: string): Promise<BookRecord | null>;
  setOpenShelf(id: string | null): void;
  setClipboard(c: { mode: 'cut' | 'copy'; ids: string[] } | null): void;
  moveBooks(ids: string[], shelfId: string | undefined): void;
  removeBooks(ids: string[]): Promise<void>;
  pasteClipboard(shelfId: string | undefined): Promise<void>;
  createShelf(name: string): string;
  renameShelf(id: string, name: string): void;
  deleteShelf(id: string): void;
  moveBook(bookId: string, shelfId: string | undefined): void;
  updateBook(id: string, patch: Partial<BookRecord>): void;
  removeBook(id: string): Promise<void>;
  resetEverything(): Promise<void>;

  toast(key: string, kind?: Toast['kind'], params?: Toast['params']): void;
  dismissToast(id: string): void;
}

export const useApp = create<AppState>((set, get) => ({
  settings: loadSettings(),
  books: [],
  shelves: [],
  openShelf: null,
  clipboard: null,
  booksLoaded: false,
  route: { name: 'library' },
  history: [],
  toasts: [],
  importing: null,
  resolvedTheme: 'light',

  async init() {
    try {
      const books = await getAllBooks();
      const shelves = await getShelves().catch(() => [] as ShelfRecord[]);
      set({ books, shelves, booksLoaded: true });
      // Covers saved earlier still carry their white page margins: clean them once, in the background.
      void trimExistingCovers(books, (id, cover) => get().updateBook(id, { cover, coverTrimmed: true, coverTrimV: TRIM_VERSION }));
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

  async importFiles(files, shelfId) {
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
        const book = shelfId ? { ...res.book, shelfId } : res.book;
        last = book;
        if (shelfId) void patchBook(book.id, { shelfId }).catch(() => undefined);
        set({ books: [book, ...get().books] });
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

  setOpenShelf(id) {
    set({ openShelf: id });
  },

  setClipboard(c) {
    set({ clipboard: c });
  },

  moveBooks(ids, shelfId) {
    for (const id of ids) get().updateBook(id, { shelfId });
  },

  async removeBooks(ids) {
    let done = 0;
    for (const id of ids) {
      try {
        await deleteBook(id);
        done++;
      } catch {
        /* keep going with the others */
      }
    }
    const gone = new Set(ids);
    set({ books: get().books.filter((b) => !gone.has(b.id)), clipboard: null });
    if (done === 1) get().toast('library.removed', 'info');
    else if (done > 1) get().toast('select.deleted', 'info', { count: done });
  },

  async pasteClipboard(shelfId) {
    const clip = get().clipboard;
    if (!clip) return;
    const ids = clip.ids.filter((id) => get().books.some((b) => b.id === id));
    set({ clipboard: null });
    if (clip.mode === 'cut') {
      get().moveBooks(ids, shelfId);
    } else {
      for (const id of ids) {
        try {
          const copy = await duplicateBook(id, shelfId);
          if (copy) set({ books: [copy, ...get().books] });
        } catch (e) {
          get().toast(e instanceof AppError && e.code === 'quota' ? 'err.quota' : 'err.importFailed', 'error', { name: '' });
          return;
        }
      }
    }
    if (ids.length) get().toast('clip.pasted', 'success', { count: ids.length });
  },

  createShelf(name) {
    const shelf: ShelfRecord = { id: uid(), name: name.trim(), createdAt: Date.now() };
    const shelves = [...get().shelves, shelf];
    set({ shelves });
    void saveShelves(shelves).catch(() => undefined);
    return shelf.id;
  },

  renameShelf(id, name) {
    const shelves = get().shelves.map((s) => (s.id === id ? { ...s, name: name.trim() } : s));
    set({ shelves });
    void saveShelves(shelves).catch(() => undefined);
  },

  deleteShelf(id) {
    // The books stay in the library; they just come off the shelf.
    for (const b of get().books) if (b.shelfId === id) get().updateBook(b.id, { shelfId: undefined });
    const shelves = get().shelves.filter((s) => s.id !== id);
    set({ shelves, openShelf: get().openShelf === id ? null : get().openShelf });
    void saveShelves(shelves).catch(() => undefined);
    get().toast('shelf.deleted', 'info');
  },

  moveBook(bookId, shelfId) {
    get().updateBook(bookId, { shelfId });
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
    set({ books: [], shelves: [], openShelf: null, clipboard: null, settings: defaultSettings(), route: { name: 'library' }, history: [] });
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
