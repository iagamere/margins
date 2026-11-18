import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, ChevronRight, Highlighter, Info, Maximize2, Minus, Pencil, Plus, Search as SearchIcon, Trash2, X } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useApp } from '../store/useApp';
import { HIGHLIGHT_COLORS } from '../lib/readerCss';
import { pushBackHandler } from '../lib/backStack';
import type { AnnotationRecord, HighlightColor, ReaderApi, SearchHit, TocItem } from '../lib/types';
import { TypographyControls } from '../components/TypographyControls';

/* =========================================================
   Table of contents / PDF outline
   ========================================================= */
export function TocList({ items, current, onSelect, emptyText }: { items: TocItem[]; current?: string; onSelect(i: TocItem): void; emptyText: string }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(items.filter((i) => i.children.length).map((i) => i.id)));
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, []);
  if (!items.length) return <p className="muted" style={{ padding: '12px 0', lineHeight: 1.6 }}>{emptyText}</p>;
  let usedCurrent = false;
  const render = (list: TocItem[], depth: number) =>
    list.map((it) => {
      const isCur = !usedCurrent && !!current && it.label === current;
      if (isCur) usedCurrent = true;
      const expanded = open.has(it.id);
      return (
        <Fragment key={it.id}>
          <div style={{ paddingInlineStart: Math.min(depth, 4) * 14 }} className="row">
            <button
              ref={isCur ? currentRef : undefined}
              className={`toc-item depth${depth}${isCur ? ' current' : ''}`}
              onClick={() => onSelect(it)}
              aria-current={isCur ? 'location' : undefined}
              dir="auto"
            >
              {it.children.length ? (
                <span
                  className="chev"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  aria-label={it.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen((s) => {
                      const n = new Set(s);
                      n.has(it.id) ? n.delete(it.id) : n.add(it.id);
                      return n;
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpen((s) => {
                        const n = new Set(s);
                        n.has(it.id) ? n.delete(it.id) : n.add(it.id);
                        return n;
                      });
                    }
                  }}
                >
                  <ChevronRight size={18} />
                </span>
              ) : (
                <span className="spacer" />
              )}
              <span style={{ flex: 1 }}>{it.label}</span>
            </button>
          </div>
          {it.children.length > 0 && expanded && render(it.children, depth + 1)}
        </Fragment>
      );
    });
  return <div className="toc">{render(items, 0)}</div>;
}

/* =========================================================
   Search
   ========================================================= */
export interface SearchState {
  query: string;
  hits: SearchHit[];
  running: boolean;
  done: boolean;
  noText: boolean;
}

export function useBookSearch(getApi: () => ReaderApi | null) {
  const [state, setState] = useState<SearchState>({ query: '', hits: [], running: false, done: false, noText: false });
  const cancel = useRef({ cancelled: false });
  const stop = () => {
    cancel.current.cancelled = true;
  };
  const run = async (query: string) => {
    const api = getApi();
    stop();
    const mine = { cancelled: false };
    cancel.current = mine;
    const q = query.trim();
    if (!api || !q) {
      setState({ query, hits: [], running: false, done: false, noText: false });
      return;
    }
    const buf: SearchHit[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      if (!mine.cancelled) setState((s) => ({ ...s, hits: buf.slice() }));
    };
    setState({ query, hits: [], running: true, done: false, noText: false });
    try {
      const out = await api.search(
        q,
        (h) => {
          buf.push(h);
          if (!timer) timer = setTimeout(flush, 160);
        },
        mine
      );
      if (timer) clearTimeout(timer);
      if (!mine.cancelled) setState({ query, hits: buf.slice(), running: false, done: true, noText: !out.hasText });
    } catch {
      if (!mine.cancelled) setState({ query, hits: buf.slice(), running: false, done: true, noText: false });
    }
  };
  useEffect(() => stop, []);
  return { state, run, stop };
}

function Excerpt({ text, q }: { text: string; q: string }) {
  const parts = useMemo(() => {
    if (!q) return [text];
    const low = text.toLowerCase();
    const needle = q.toLowerCase();
    const out: Array<string | { m: string }> = [];
    let from = 0;
    let i: number;
    while ((i = low.indexOf(needle, from)) !== -1) {
      out.push(text.slice(from, i), { m: text.slice(i, i + needle.length) });
      from = i + needle.length;
    }
    out.push(text.slice(from));
    return out;
  }, [text, q]);
  return (
    <span dir="auto">
      {parts.map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <mark key={i}>{p.m}</mark>))}
    </span>
  );
}

export function SearchPanel({ format, search, onGo }: { format: 'epub' | 'pdf'; search: ReturnType<typeof useBookSearch>; onGo(h: SearchHit): void }) {
  const { t, n } = useT();
  const [text, setText] = useState(search.state.query);
  const { state } = search;
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search.run(text);
          (document.activeElement as HTMLElement | null)?.blur?.();
        }}
      >
        <label className="field">
          <SearchIcon size={18} aria-hidden="true" />
          <input autoFocus type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('search.placeholder')} aria-label={t('search.placeholder')} enterKeyHint="search" dir="auto" />
          {text && (
            <button type="button" className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => { setText(''); search.stop(); void search.run(''); }} aria-label={t('common.clear')}>
              <X size={18} />
            </button>
          )}
        </label>
      </form>
      {format === 'pdf' && (
        <div className="notice" style={{ marginTop: 12 }}>
          <Info size={16} aria-hidden="true" />
          <span>{t('search.pdfNote')}</span>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        {state.running && (
          <div className="row muted" style={{ fontSize: 13, padding: '6px 0' }}>
            <div className="spinner" />
            <span>{t('search.searching', { count: n(state.hits.length) })}</span>
            <button className="btn btn-ghost btn-sm" onClick={search.stop} style={{ marginInlineStart: 'auto' }}>{t('common.cancel')}</button>
          </div>
        )}
        {state.done && state.noText && <div className="notice"><Info size={16} aria-hidden="true" /><span>{t('search.noText')}</span></div>}
        {state.done && !state.noText && state.hits.length === 0 && <p className="muted" style={{ padding: '12px 0' }}>{t('search.none')}</p>}
        {state.hits.length > 0 && (
          <p className="eyebrow" style={{ padding: '8px 0' }}>{t('search.results', { count: n(state.hits.length) })}</p>
        )}
        {state.hits.map((h) => (
          <button key={h.id} className="hit" onClick={() => onGo(h)}>
            {format === 'epub' && h.label && <small dir="auto">{h.label}</small>}
            {format === 'pdf' && <small>{t('reader.pageN', { n: n(Number(/^p:(\d+)/.exec(h.location)?.[1] ?? 0)) })}</small>}
            <Excerpt text={h.excerpt} q={state.query.trim()} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   Bookmarks, highlights & notes
   ========================================================= */
export function AnnotationsPanel({
  format,
  items,
  onGo,
  onEdit,
  onDelete,
}: {
  format: 'epub' | 'pdf';
  items: AnnotationRecord[];
  onGo(a: AnnotationRecord): void;
  onEdit(a: AnnotationRecord): void;
  onDelete(a: AnnotationRecord): void;
}) {
  const { t, n } = useT();
  const sorted = useMemo(() => [...items].sort((a, b) => a.percentage - b.percentage || a.createdAt - b.createdAt), [items]);
  return (
    <div>
      {format === 'pdf' && (
        <div className="notice" style={{ marginBottom: 8 }}>
          <Info size={16} aria-hidden="true" />
          <span>{t('annot.pdfLimit')}</span>
        </div>
      )}
      {sorted.length === 0 ? (
        <p className="muted" style={{ padding: '16px 0', lineHeight: 1.65 }}>{t(format === 'epub' ? 'annot.emptyEpub' : 'annot.emptyPdf')}</p>
      ) : (
        sorted.map((a) => (
          <div key={a.id} className="note-card" style={{ ['--hl' as string]: a.color ? HIGHLIGHT_COLORS[a.color].fill : 'var(--accent2)' }}>
            <button style={{ textAlign: 'start', display: 'flex', flexDirection: 'column', gap: 8 }} onClick={() => onGo(a)}>
              {a.type === 'highlight' ? (
                <div className="quote" dir="auto">{a.text}</div>
              ) : (
                <div className="row" style={{ gap: 8 }}>
                  <Bookmark size={17} style={{ color: 'var(--mark)' }} aria-hidden="true" />
                  <span style={{ fontWeight: 600 }}>{a.page ? t('reader.pageN', { n: n(a.page) }) : t('annot.bookmark')}</span>
                </div>
              )}
              {a.type === 'bookmark' && a.text && (
                <div className="quote" dir="auto" style={{ ['--hl' as string]: 'var(--mark)' }}>{a.text}</div>
              )}
              {a.note && <div className="note" dir="auto">{a.note}</div>}
            </button>
            <div className="foot">
              <span dir="auto" className="clamp1" style={{ flex: 1 }}>
                {[a.chapter, `${n(Math.round(a.percentage * 100))}%`].filter(Boolean).join(' · ')}
              </span>
              <span className="acts">
                <button onClick={() => onEdit(a)} aria-label={t('common.edit')}><Pencil size={17} /></button>
                <button onClick={() => onDelete(a)} aria-label={t('common.delete')}><Trash2 size={17} /></button>
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function NoteDialog({
  annotation,
  onSave,
  onDelete,
  onClose,
}: {
  annotation: AnnotationRecord;
  onSave(patch: Partial<AnnotationRecord>): void;
  onDelete(): void;
  onClose(): void;
}) {
  const { t } = useT();
  const [note, setNote] = useState(annotation.note ?? '');
  const [color, setColor] = useState<HighlightColor>(annotation.color ?? 'gold');
  useEffect(() => {
    const off = pushBackHandler(onClose);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <div className="scrim top" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t('annot.editTitle')}>
        <h2>{annotation.type === 'highlight' ? t('annot.editHighlight') : t('annot.editBookmark')}</h2>
        {annotation.type === 'highlight' && annotation.text && (
          <div className="note-card" style={{ padding: 0, border: 0, ['--hl' as string]: HIGHLIGHT_COLORS[color].fill }}>
            <div className="quote clamp2" dir="auto" style={{ WebkitLineClamp: 4 }}>{annotation.text}</div>
          </div>
        )}
        {annotation.type === 'highlight' && (
          <div className="colors" role="group" aria-label={t('annot.color')}>
            {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((c) => (
              <button key={c} className="color-dot" style={{ ['--c' as string]: HIGHLIGHT_COLORS[c].fill }} aria-pressed={color === c} aria-label={t(`hl.${c}`)} onClick={() => setColor(c)} />
            ))}
          </div>
        )}
        <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('annot.notePlaceholder')} aria-label={t('annot.note')} dir="auto" autoFocus />
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-ghost btn-danger" onClick={onDelete}><Trash2 size={18} aria-hidden="true" />{t('common.delete')}</button>
          <div className="row">
            <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={() => onSave({ note: note.trim() || undefined, color: annotation.type === 'highlight' ? color : undefined })}>{t('common.save')}</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* =========================================================
   PDF thumbnails
   ========================================================= */
const thumbLimiter = (() => {
  let active = 0;
  const q: Array<() => void> = [];
  return {
    acquire: () => new Promise<void>((res) => { const go = () => { active++; res(); }; active < 2 ? go() : q.push(go); }),
    release: () => { active--; q.shift()?.(); },
  };
})();

function Thumb({ doc, num, current, onGo, label }: { doc: any; num: number; current: boolean; onGo(): void; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  const [ratio, setRatio] = useState(1.4);
  useEffect(() => {
    const io = new IntersectionObserver((e) => setNear(e[0].isIntersecting), { rootMargin: '200px' });
    io.observe(btn.current!);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (current) btn.current?.scrollIntoView({ block: 'center' });
  }, [current]);
  useEffect(() => {
    const h = host.current!;
    if (!near) {
      h.querySelectorAll('canvas').forEach((c) => { c.width = 0; c.height = 0; });
      h.replaceChildren();
      return;
    }
    let cancelled = false;
    let task: any;
    (async () => {
      await thumbLimiter.acquire();
      try {
        if (cancelled) return;
        const page = await doc.getPage(num);
        const base = page.getViewport({ scale: 1 });
        const scale = (110 * Math.min(window.devicePixelRatio || 1, 2)) / base.width;
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        task = page.render({ canvasContext: c.getContext('2d', { alpha: false })!, viewport: vp });
        await task.promise;
        if (cancelled) { c.width = 0; return; }
        setRatio(base.height / base.width);
        h.replaceChildren(c);
        page.cleanup?.();
      } catch {
        /* thumbnail is optional */
      } finally {
        thumbLimiter.release();
      }
    })();
    return () => {
      cancelled = true;
      try { task?.cancel(); } catch { /* ignore */ }
    };
  }, [near, doc, num]);
  return (
    <button ref={btn} className={'thumb' + (current ? ' current' : '')} onClick={onGo} aria-label={label} aria-current={current ? 'page' : undefined}>
      <div className="tp" style={{ aspectRatio: `1 / ${ratio}` }} ref={host} />
      <span>{num}</span>
    </button>
  );
}

export function ThumbsPanel({ doc, total, current, onGo }: { doc: any; total: number; current: number; onGo(n: number): void }) {
  const { t, n } = useT();
  return (
    <div className="thumbs">
      {Array.from({ length: total }, (_, i) => (
        <Thumb key={i} doc={doc} num={i + 1} current={current === i + 1} onGo={() => onGo(i + 1)} label={t('reader.pageN', { n: n(i + 1) })} />
      ))}
    </div>
  );
}

/* =========================================================
   Appearance panel (EPUB typography / PDF view options)
   ========================================================= */
export function PdfViewControls({ api }: { api: ReaderApi | null }) {
  const { t } = useT();
  const s = useApp((st) => st.settings);
  const set = useApp((st) => st.setSettings);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="group">
        <div className="setting">
          <span className="label">{t('pdf.style')}</span>
          <div className="seg" role="group" aria-label={t('pdf.style')}>
            <button aria-pressed={!s.pdfReflow} onClick={() => set({ pdfReflow: false })}>{t('pdf.styleOriginal')}</button>
            <button aria-pressed={s.pdfReflow} onClick={() => set({ pdfReflow: true })}>{t('pdf.styleReflow')}</button>
          </div>
          {s.pdfReflow && (
            <div className="notice"><Info size={16} aria-hidden="true" /><span>{t('pdf.reflowNote')}</span></div>
          )}
        </div>
        {!s.pdfReflow && (
          <>
            <div className="setting">
              <span className="label">{t('typo.mode')}</span>
              <div className="seg" role="group" aria-label={t('typo.mode')}>
                <button aria-pressed={s.readingMode === 'paged'} onClick={() => set({ readingMode: 'paged' })}>{t('typo.paged')}</button>
                <button aria-pressed={s.readingMode === 'scroll'} onClick={() => set({ readingMode: 'scroll' })}>{t('typo.scroll')}</button>
              </div>
            </div>
            <div className="setting">
              <span className="label">{t('pdf.zoom')}</span>
              <div className="row">
                <button className="btn" style={{ flex: 1 }} onClick={() => api?.zoomBy?.(1 / 1.25)} aria-label={t('pdf.zoomOut')}><Minus size={20} /></button>
                <button className="btn" style={{ flex: 1 }} onClick={() => api?.zoomBy?.(1.25)} aria-label={t('pdf.zoomIn')}><Plus size={20} /></button>
              </div>
              <div className="row">
                <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => api?.setFit?.('width')}><Maximize2 size={16} aria-hidden="true" />{t('pdf.fitWidth')}</button>
                <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => api?.setFit?.('page')}><Maximize2 size={16} aria-hidden="true" />{t('pdf.fitPage')}</button>
              </div>
            </div>
          </>
        )}
      </div>
      {s.pdfReflow ? <TypographyControls showMode={false} reflow /> : <TypographyControls format="pdf" />}
    </div>
  );
}

export { Highlighter };
