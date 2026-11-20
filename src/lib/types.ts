export type BookFormat = 'epub' | 'pdf';
export type Lang = 'ar' | 'fr' | 'en';
export type ThemeName = 'light' | 'dark' | 'sepia';
export type AppTheme = 'system' | ThemeName;
export type AccentName = 'olive' | 'clay' | 'ochre' | 'sea' | 'slate' | 'plum' | 'rose' | 'cocoa';
export type ReaderTheme = 'auto' | ThemeName;
export type ReadingMode = 'scroll' | 'paged';
export type ReadFont = 'auto' | 'original' | 'literata' | 'sourceSerif' | 'naskh' | 'amiri' | 'plexArabic' | 'cairo' | 'inter';
export type TextDir = 'auto' | 'rtl' | 'ltr';
export type TextWeight = 'regular' | 'bold';
export type TextAlign = 'original' | 'start' | 'justify';
export type HighlightColor = 'sage' | 'gold' | 'rose' | 'sky';
export type LibraryFilter = 'all' | 'reading' | 'completed' | 'recent';
export type LibrarySort = 'opened' | 'added' | 'title' | 'author' | 'progress';

export interface BookRecord {
  id: string;
  hash: string;
  format: BookFormat;
  title: string;
  author?: string;
  fileName: string;
  size: number;
  addedAt: number;
  lastOpenedAt?: number;
  /** 0..1 */
  percentage: number;
  /** EPUB: CFI string. PDF: "p:<page>:<offset 0..1>" */
  location?: string;
  finished: boolean;
  cover?: Blob;
  /** white page margins already cut off the cover */
  coverTrimmed?: boolean;
  /** version of the trimming algorithm applied to the cover (see trim.ts) */
  coverTrimV?: number;
  language?: string;
  rtl?: boolean;
  pages?: number;
  /** PDF: this book is read in text-reflow mode */
  pdfReflow?: boolean;
  /** the shelf this book sits on (none = loose in the library) */
  shelfId?: string;
}

export interface ShelfRecord {
  id: string;
  name: string;
  createdAt: number;
}

export interface AnnotationRecord {
  id: string;
  bookId: string;
  type: 'bookmark' | 'highlight';
  /** EPUB: CFI of the position. PDF: "p:<page>:0" */
  location: string;
  /** EPUB highlights only */
  cfiRange?: string;
  text?: string;
  note?: string;
  /** bookmarks: user-given name and marker colour ('#rrggbb', unset = default) */
  title?: string;
  markColor?: string;
  color?: HighlightColor;
  chapter?: string;
  page?: number;
  percentage: number;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  lang: Lang;
  theme: AppTheme;
  /** interface accent colour */
  accent: AccentName;
  readerTheme: ReaderTheme;
  readingMode: ReadingMode;
  font: ReadFont;
  /** px */
  fontSize: number;
  lineHeight: number;
  /** em */
  paragraphSpacing: number;
  /** px, side margins inside the reading area */
  margin: number;
  /** px, maximum width of the reading column */
  maxWidth: number;
  textAlign: TextAlign;
  /** PDF text reflow only: force the paragraph direction */
  textDir: TextDir;
  /** PDF text reflow only */
  textWeight: TextWeight;
  /** bookmark marker colour: 'auto' follows the theme, otherwise a #rrggbb value */
  markColor: string;
  /** progress-bar bookmarks attract the slider while dragging */
  magnet: boolean;
  pdfAdaptTheme: boolean;
  /** PDF: show extracted text re-flowed to the screen instead of the original pages */
  pdfReflow: boolean;
  libraryView: 'grid' | 'list';
  librarySort: LibrarySort;
  /** flips the natural direction of librarySort (newest/A→Z/most read first) */
  libraryReverse: boolean;
}

export type Route =
  | { name: 'library' }
  | { name: 'continue' }
  | { name: 'settings' }
  | { name: 'details'; id: string }
  | { name: 'reader'; id: string };

export interface TocItem {
  id: string;
  label: string;
  /** EPUB */
  href?: string;
  /** PDF outline destination (unresolved) */
  dest?: unknown;
  children: TocItem[];
}

export interface ReaderPosition {
  location: string;
  percentage: number;
  chapter?: string;
  /** EPUB: range of the visible content */
  start?: string;
  end?: string;
  /** PDF */
  page?: number;
  total?: number;
  atEnd?: boolean;
  excerpt?: string;
}

export interface SearchHit {
  id: string;
  location: string;
  label?: string;
  excerpt: string;
}

export interface SearchOutcome {
  /** false when a PDF has no text layer at all */
  hasText: boolean;
}

export interface ReaderApi {
  next(): void;
  prev(): void;
  nextSection(): void;
  prevSection(): void;
  goToLocation(loc: string): void;
  goToToc(item: TocItem): void;
  goToPercent(p: number): void;
  search(query: string, onHit: (h: SearchHit) => void, cancel: { cancelled: boolean }): Promise<SearchOutcome>;
  goToHit(hit: SearchHit): void;
  /** PDF only */
  goToPage?(page: number): void;
  zoomBy?(factor: number): void;
  setFit?(mode: 'width' | 'page'): void;
}

export interface ReaderReadyInfo {
  toc: TocItem[];
  api: ReaderApi;
  pdfDoc?: unknown;
  numPages?: number;
}

export type ErrorCode =
  | 'unsupported'
  | 'invalid'
  | 'corruptEpub'
  | 'corruptPdf'
  | 'passwordPdf'
  | 'quota'
  | 'importFailed'
  | 'restoreFailed'
  | 'storageUnavailable';

export class AppError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}
