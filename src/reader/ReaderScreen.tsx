import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Copy,
  Expand,
  List,
  Minimize,
  NotebookPen,
  Search as SearchIcon,
  SkipBack,
  SkipForward,
  StickyNote,
  Type,
  X,
} from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { deleteAnnotation, getAnnotations, getFile, patchBook, putAnnotation } from '../lib/db';
import { cfiCompare } from '../lib/cfi';
import { HIGHLIGHT_COLORS } from '../lib/readerCss';
import { pushBackHandler } from '../lib/backStack';
import { openExternal } from '../lib/platform';
import { debounce, uid } from '../lib/utils';
import type { AnnotationRecord, BookRecord, ErrorCode, HighlightColor, ReaderApi, ReaderPosition, ReaderReadyInfo, ThemeName, TocItem } from '../lib/types';
import { Sheet } from '../components/Sheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TypographyControls } from '../components/TypographyControls';
import { EpubView, type EpubSelection } from './EpubView';
import { PdfView } from './PdfView';
import { AnnotationsPanel, NoteDialog, PdfViewControls, SearchPanel, ThumbsPanel, TocList, useBookSearch } from './panels';

type Panel = null | 'toc' | 'search' | 'notes' | 'typo';

export function ReaderScreen({ id }: { id: string }) {
  const { t, n, lang } = useT();
  const book = useApp((s) => s.books.find((b) => b.id === id));
  const settings = useApp((s) => s.settings);
  const resolved = useApp((s) => s.resolvedTheme);
  const updateBook = useApp((s) => s.updateBook);
  const navigate = useApp((s) => s.navigate);
  const back = useApp((s) => s.back);
  const toast = useApp((s) => s.toast);

  const rtheme: ThemeName = settings.readerTheme === 'auto' ? resolved : settings.readerTheme;

  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);
  const [ui, setUi] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [tocTab, setTocTab] = useState<'contents' | 'pages'>('contents');
  const [info, setInfo] = useState<ReaderReadyInfo | null>(null);
  const [pos, setPos] = useState<ReaderPosition | null>(null);
  const [sel, setSel] = useState<EpubSelection | null>(null);
  const [editing, setEditing] = useState<AnnotationRecord | null>(null);
  const [extUrl, setExtUrl] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [fs, setFs] = useState(false);

  const format = book?.format ?? 'epub';
  const infoRef = useRef<ReaderReadyInfo | null>(null);
  infoRef.current = info;
  const getApi = useCallback(() => infoRef.current?.api ?? null, []);
  const search = useBookSearch(getApi);
  const clearSel = useRef<() => void>(() => undefined);
  const posRef = useRef<ReaderPosition | null>(null);
  const uiTouched = useRef(false);

  /* ---------- load the file + annotations ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const blob = await getFile(id);
        if (!blob) throw new Error('missing');
        const buf = await blob.arrayBuffer();
        const ann = await getAnnotations(id);
        if (!alive) return;
        setAnnotations(ann);
        setData(buf);
        updateBook(id, { lastOpenedAt: Date.now() });
      } catch {
        if (alive) setError('restoreFailed');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ---------- progress persistence ---------- */
  const persist = useMemo(
    () =>
      debounce(() => {
        const p = posRef.current;
        if (!p) return;
        const cur = useApp.getState().books.find((b) => b.id === id);
        const patch: Partial<BookRecord> = { location: p.location, percentage: p.percentage, lastOpenedAt: Date.now() };
        if (p.atEnd) patch.finished = true;
        else if (p.percentage < 0.9 && cur?.finished) patch.finished = false;
        updateBook(id, patch);
      }, 700),
    [id, updateBook]
  );
  useEffect(() => {
    const flush = () => persist.flush();
    const vis = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [persist]);

  const onPosition = useCallback(
    (p: ReaderPosition) => {
      posRef.current = p;
      setPos(p);
      persist();
    },
    [persist]
  );

  /* ---------- toolbar auto-hide (first reveal) ---------- */
  useEffect(() => {
    if (!data || uiTouched.current) return;
    const timer = setTimeout(() => {
      if (!uiTouched.current) setUi(false);
    }, 3200);
    return () => clearTimeout(timer);
  }, [data]);
  const toggleUi = useCallback(() => {
    uiTouched.current = true;
    setUi((v) => !v);
  }, []);

  /* ---------- bookmarks ---------- */
  const bookmarks = useMemo(() => annotations.filter((a) => a.type === 'bookmark'), [annotations]);
  const bookmarksHere = useMemo(() => {
    if (!pos) return [];
    if (format === 'pdf') return bookmarks.filter((b) => b.page === pos.page);
    const s = pos.start ?? pos.location;
    const e = pos.end ?? pos.location;
    return bookmarks.filter((b) => cfiCompare(b.location, s) >= 0 && cfiCompare(b.location, e) <= 0);
  }, [bookmarks, pos, format]);

  const saveAnn = async (a: AnnotationRecord) => {
    try {
      await putAnnotation(a);
      setAnnotations((list) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a]));
    } catch (e) {
      toast((e as { code?: string })?.code === 'quota' ? 'err.quota' : 'err.importFailed', 'error', { name: '' });
    }
  };
  const removeAnn = async (a: AnnotationRecord) => {
    try {
      await deleteAnnotation(a.id);
      setAnnotations((list) => list.filter((x) => x.id !== a.id));
    } catch {
      toast('err.storageUnavailable', 'error');
    }
  };

  const toggleBookmark = async () => {
    if (!pos) return;
    if (bookmarksHere.length) {
      for (const b of bookmarksHere) await removeAnn(b);
      toast('annot.bookmarkRemoved');
      return;
    }
    const now = Date.now();
    await saveAnn({
      id: uid(),
      bookId: id,
      type: 'bookmark',
      location: format === 'pdf' ? `p:${pos.page}:0` : pos.start ?? pos.location,
      page: pos.page,
      chapter: pos.chapter,
      percentage: pos.percentage,
      createdAt: now,
      updatedAt: now,
    });
    toast('annot.bookmarkAdded');
  };

  /* ---------- selection / highlights (EPUB) ---------- */
  const lastColor = useRef<HighlightColor>('gold');
  const makeHighlight = async (color: HighlightColor): Promise<AnnotationRecord | null> => {
    if (!sel) return null;
    lastColor.current = color;
    const now = Date.now();
    const a: AnnotationRecord = {
      id: uid(),
      bookId: id,
      type: 'highlight',
      location: sel.cfiRange,
      cfiRange: sel.cfiRange,
      text: sel.text.slice(0, 1200),
      color,
      chapter: pos?.chapter,
      percentage: pos?.percentage ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    await saveAnn(a);
    clearSel.current();
    setSel(null);
    return a;
  };
  const copySel = async () => {
    if (!sel) return;
    try {
      await navigator.clipboard.writeText(sel.text);
      toast('reader.copied');
    } catch {
      toast('reader.copyFailed', 'error');
    }
    clearSel.current();
    setSel(null);
  };
  const onHighlightClick = useCallback((annId: string) => {
    setAnnotations((list) => {
      const a = list.find((x) => x.id === annId);
      if (a) setEditing(a);
      return list;
    });
  }, []);

  /* ---------- navigation ---------- */
  const goAnn = (a: AnnotationRecord) => {
    setPanel(null);
    info?.api.goToLocation(a.location);
  };
  const exit = useCallback(() => {
    persist.flush();
    if (!back()) navigate({ name: 'library' }, { replace: true });
  }, [back, navigate, persist]);

  // Android back / Esc: selection first (panels and dialogs register themselves).
  useEffect(() => {
    if (!sel) return;
    return pushBackHandler(() => {
      clearSel.current();
      setSel(null);
    });
  }, [sel]);

  /* ---------- fullscreen (desktop browsers) ---------- */
  const canFs = typeof document !== 'undefined' && document.fullscreenEnabled;
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  /* ---------- keyboard ---------- */
  const rtlBook = format === 'epub' && !!book?.rtl;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const api = infoRef.current?.api;
      if (!api) return;
      if (panel || editing || extUrl) return;
      const scrollEpub = format === 'epub' && useApp.getState().settings.readingMode === 'scroll';
      switch (e.key) {
        case 'ArrowRight':
          return void (rtlBook ? api.prev() : api.next());
        case 'ArrowLeft':
          return void (rtlBook ? api.next() : api.prev());
        case 'ArrowDown':
        case 'PageDown':
          if (scrollEpub) return;
          e.preventDefault();
          return api.next();
        case 'ArrowUp':
        case 'PageUp':
          if (scrollEpub) return;
          e.preventDefault();
          return api.prev();
        case ' ':
          if (scrollEpub) return;
          e.preventDefault();
          return void (e.shiftKey ? api.prev() : api.next());
        case 't':
          return setPanel('toc');
        case 'n':
          return setPanel('notes');
        case 'a':
          return setPanel('typo');
        case '/':
        case 's':
          e.preventDefault();
          return setPanel('search');
        case 'b':
          return void toggleBookmark();
        case 'f':
          return canFs ? toggleFs() : undefined;
        case '+':
        case '=':
          return api.zoomBy?.(1.25);
        case '-':
          return api.zoomBy?.(1 / 1.25);
        case 'h':
          return toggleUi();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, editing, extUrl, format, rtlBook, pos, bookmarksHere]);

  /* ---------- render ---------- */
  const title = book?.title ?? '';
  const showBars = ui && !sel;
  const total = pos?.total ?? info?.numPages ?? book?.pages ?? 0;
  const pct = scrub ?? pos?.percentage ?? book?.percentage ?? 0;
  const footLeft = format === 'epub' ? pos?.chapter ?? '' : '';
  const footRight = format === 'epub' ? `${n(Math.round(pct * 100))}%` : total ? `${n(pos?.page ?? 1)} / ${n(total)}` : '';
  const isBookmarked = bookmarksHere.length > 0;
  const rtlUi = lang === 'ar';

  const openPanel = (p: Panel) => () => setPanel(p);
  const onReady = useCallback((i: ReaderReadyInfo) => setInfo(i), []);
  const onError = useCallback((c: ErrorCode) => setError(c), []);
  const registerClear = useCallback((fn: () => void) => {
    clearSel.current = fn;
  }, []);
  const onSelect = useCallback((s: EpubSelection | null) => setSel(s), []);

  if (error) {
    return (
      <div className="reader" data-theme={rtheme}>
        <div className="reader-state">
          <h2>{t('reader.errorTitle')}</h2>
          <p>{t(`err.${error}`, { name: title })}</p>
          <button className="btn btn-primary" onClick={exit}>
            {t('common.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reader" data-theme={rtheme} data-format={format}>
      <div className="reader-stage">
        {book && data && format === 'epub' && (
          <EpubView
            bookId={id}
            data={data}
            rtl={!!book.rtl}
            settings={settings}
            theme={rtheme}
            initialLocation={book.location}
            annotations={annotations}
            onReady={onReady}
            onPosition={onPosition}
            onToggleUi={toggleUi}
            onSelect={onSelect}
            onHighlightClick={onHighlightClick}
            onExternalLink={setExtUrl}
            onError={onError}
            registerClearSelection={registerClear}
          />
        )}
        {book && data && format === 'pdf' && (
          <PdfView bookId={id} data={data} settings={settings} theme={rtheme} initialLocation={book.location} onReady={onReady} onPosition={onPosition} onToggleUi={toggleUi} onExternalLink={setExtUrl} onError={onError} />
        )}
        {!data && (
          <div className="reader-state">
            <div className="spinner" />
            <p>{t('reader.opening')}</p>
          </div>
        )}
      </div>

      {format === 'epub' && (
        <div className="rfoot" aria-hidden="true">
          <span dir="auto">{footLeft}</span>
          <span>{footRight}</span>
        </div>
      )}
      {format === 'pdf' && (
        <div className="rfoot" aria-hidden="true">
          <span />
          <span>{footRight}</span>
        </div>
      )}

      {/* ---------- top bar ---------- */}
      <div className={'rbar top' + (showBars ? '' : ' hidden')} aria-hidden={!showBars}>
        <button className="icon-btn" onClick={exit} aria-label={t('reader.back')} tabIndex={showBars ? 0 : -1}>
          <ArrowLeft className="flip" size={22} />
        </button>
        <div className="title" dir="auto">
          <b className="clamp1">{title}</b>
          {pos?.chapter && format === 'epub' && <small className="clamp1">{pos.chapter}</small>}
        </div>
        {canFs && (
          <button className="icon-btn" onClick={toggleFs} aria-label={fs ? t('reader.exitFullscreen') : t('reader.fullscreen')} tabIndex={showBars ? 0 : -1}>
            {fs ? <Minimize size={20} /> : <Expand size={20} />}
          </button>
        )}
        <button className="icon-btn" onClick={() => void toggleBookmark()} aria-pressed={isBookmarked} aria-label={isBookmarked ? t('annot.removeBookmark') : t('annot.addBookmark')} tabIndex={showBars ? 0 : -1}>
          {isBookmarked ? <BookmarkCheck size={22} /> : <Bookmark size={22} />}
        </button>
        <button className="icon-btn" onClick={openPanel('search')} aria-label={t('reader.search')} tabIndex={showBars ? 0 : -1}>
          <SearchIcon size={21} />
        </button>
      </div>

      {/* ---------- bottom bar ---------- */}
      <div className={'rbar bottom' + (showBars ? '' : ' hidden')} aria-hidden={!showBars}>
        <div className="scrub">
          <button className="icon-btn" onClick={() => info?.api.prevSection()} aria-label={t(format === 'pdf' ? 'reader.prevPage' : 'reader.prevChapter')} tabIndex={showBars ? 0 : -1}>
            <SkipBack className="flip" size={19} />
          </button>
          <input
            className="range"
            type="range"
            min={0}
            max={1000}
            step={1}
            value={Math.round(pct * 1000)}
            aria-label={t('reader.progress')}
            aria-valuetext={footRight}
            tabIndex={showBars ? 0 : -1}
            onChange={(e) => setScrub(Number(e.target.value) / 1000)}
            onPointerUp={() => {
              if (scrub != null) info?.api.goToPercent(scrub);
              setScrub(null);
            }}
            onKeyUp={() => {
              if (scrub != null) info?.api.goToPercent(scrub);
              setScrub(null);
            }}
            style={{ flex: 1 }}
          />
          <button className="icon-btn" onClick={() => info?.api.nextSection()} aria-label={t(format === 'pdf' ? 'reader.nextPage' : 'reader.nextChapter')} tabIndex={showBars ? 0 : -1}>
            <SkipForward className="flip" size={19} />
          </button>
        </div>
        <div className="tools" style={{ direction: rtlUi ? 'rtl' : 'ltr' }}>
          <ToolButton icon={<List size={22} />} label={t(format === 'pdf' ? 'reader.outline' : 'reader.contents')} onClick={openPanel('toc')} enabled={showBars} />
          <ToolButton icon={<NotebookPen size={22} />} label={t('reader.notes')} onClick={openPanel('notes')} enabled={showBars} />
          <ToolButton icon={<Type size={22} />} label={t(format === 'pdf' ? 'reader.view' : 'reader.appearance')} onClick={openPanel('typo')} enabled={showBars} />
        </div>
        {format === 'pdf' && showBars && (
          <PageJump page={pos?.page ?? 1} total={total} onGo={(p) => info?.api.goToPage?.(p)} />
        )}
      </div>

      {/* ---------- selection dock (EPUB) ---------- */}
      {sel && format === 'epub' && (
        <div className="sel-dock" role="toolbar" aria-label={t('reader.selection')}>
          <div className="colors" role="group" aria-label={t('annot.color')}>
            {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((c) => (
              <button key={c} className="color-dot" style={{ ['--c' as string]: HIGHLIGHT_COLORS[c].fill }} onClick={() => void makeHighlight(c)} aria-label={`${t('annot.highlight')} — ${t(`hl.${c}`)}`} />
            ))}
          </div>
          <span className="sep" />
          <button
            className="act"
            onClick={async () => {
              const a = await makeHighlight(lastColor.current);
              if (a) setEditing(a);
            }}
          >
            <StickyNote size={19} aria-hidden="true" />
            {t('annot.addNote')}
          </button>
          <button className="act" onClick={() => void copySel()}>
            <Copy size={18} aria-hidden="true" />
            {t('common.copy')}
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              clearSel.current();
              setSel(null);
            }}
            aria-label={t('common.close')}
          >
            <X size={20} />
          </button>
        </div>
      )}

      {/* ---------- panels ---------- */}
      {panel === 'toc' && (
        <Sheet
          title={format === 'pdf' ? t('reader.outline') : t('reader.contents')}
          onClose={() => setPanel(null)}
          tabs={
            format === 'pdf' ? (
              <div className="seg" role="group">
                <button aria-pressed={tocTab === 'contents'} onClick={() => setTocTab('contents')}>{t('reader.outline')}</button>
                <button aria-pressed={tocTab === 'pages'} onClick={() => setTocTab('pages')}>{t('reader.pages')}</button>
              </div>
            ) : undefined
          }
        >
          {format === 'pdf' && tocTab === 'pages' && info?.pdfDoc ? (
            <ThumbsPanel
              doc={info.pdfDoc}
              total={info.numPages ?? 0}
              current={pos?.page ?? 1}
              onGo={(p) => {
                setPanel(null);
                info.api.goToPage?.(p);
              }}
            />
          ) : (
            <TocList
              items={info?.toc ?? []}
              current={pos?.chapter}
              emptyText={t(format === 'pdf' ? 'reader.noOutline' : 'reader.noContents')}
              onSelect={(item: TocItem) => {
                setPanel(null);
                info?.api.goToToc(item);
              }}
            />
          )}
        </Sheet>
      )}
      {panel === 'search' && (
        <Sheet title={t('reader.search')} onClose={() => setPanel(null)}>
          <SearchPanel
            format={format}
            search={search}
            onGo={(h) => {
              setPanel(null);
              info?.api.goToHit(h);
            }}
          />
        </Sheet>
      )}
      {panel === 'notes' && (
        <Sheet title={t('reader.notes')} onClose={() => setPanel(null)}>
          <AnnotationsPanel format={format} items={annotations} onGo={goAnn} onEdit={(a) => setEditing(a)} onDelete={(a) => void removeAnn(a)} />
        </Sheet>
      )}
      {panel === 'typo' && (
        <Sheet title={format === 'pdf' ? t('reader.view') : t('reader.appearance')} onClose={() => setPanel(null)}>
          {format === 'pdf' ? <PdfViewControls api={info?.api ?? null} /> : <TypographyControls />}
        </Sheet>
      )}

      {editing && (
        <NoteDialog
          annotation={editing}
          onClose={() => setEditing(null)}
          onDelete={async () => {
            const a = editing;
            setEditing(null);
            await removeAnn(a);
          }}
          onSave={async (patch) => {
            const a = editing;
            setEditing(null);
            await saveAnn({ ...a, ...patch, updatedAt: Date.now() });
          }}
        />
      )}
      {extUrl && (
        <ConfirmDialog
          title={t('reader.externalTitle')}
          body={extUrl}
          confirmLabel={t('reader.externalOpen')}
          onCancel={() => setExtUrl(null)}
          onConfirm={() => {
            const u = extUrl;
            setExtUrl(null);
            void openExternal(u);
          }}
        />
      )}
    </div>
  );
}

function ToolButton({ icon, label, onClick, enabled }: { icon: React.ReactNode; label: string; onClick(): void; enabled: boolean }) {
  return (
    <button className="icon-btn" style={{ width: 'auto', minWidth: 76, flexDirection: 'column', gap: 2, height: 52, fontSize: 11.5 }} onClick={onClick} aria-label={label} tabIndex={enabled ? 0 : -1}>
      {icon}
      <span style={{ fontWeight: 500 }}>{label}</span>
    </button>
  );
}

function PageJump({ page, total, onGo }: { page: number; total: number; onGo(p: number): void }) {
  const { t, n } = useT();
  const [val, setVal] = useState(String(page));
  useEffect(() => setVal(String(page)), [page]);
  if (!total) return null;
  return (
    <form
      className="pagebox"
      style={{ justifyContent: 'center', paddingBottom: 4 }}
      onSubmit={(e) => {
        e.preventDefault();
        const p = parseInt(val, 10);
        if (Number.isFinite(p)) onGo(Math.min(total, Math.max(1, p)));
        (document.activeElement as HTMLElement | null)?.blur?.();
      }}
    >
      <label className="sr-only" htmlFor="pdf-page-input">{t('reader.goToPage')}</label>
      <span className="muted">{t('reader.page')}</span>
      <input id="pdf-page-input" type="number" inputMode="numeric" min={1} max={total} value={val} onChange={(e) => setVal(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
      <span className="muted">/ {n(total)}</span>
    </form>
  );
}
