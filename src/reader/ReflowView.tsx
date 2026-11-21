import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, EyeOff } from 'lucide-react';
import { useT } from '../lib/i18n';
import { contentBox } from '../lib/trim';
import { useApp } from '../store/useApp';
import { convertOutline, isPasswordError, loadPdfjs, openPdf, resolveOutlineDest, searchPdf, type OpenedPdf } from '../lib/pdf';
import { extractPage, type PageText } from '../lib/reflow';
import { resolveFont } from '../lib/readerCss';
import type { AnnotationRecord, ErrorCode, ReaderApi, ReaderPosition, ReaderReadyInfo, SearchHit, Settings, ThemeName } from '../lib/types';
import { clamp, throttle } from '../lib/utils';
import { makeLimiter, makeRegistry, type Registry } from './PdfView';
import { resolveMarkColor, softFill } from '../lib/markColor';
import type { EpubSelection } from './EpubView';

export interface ReflowViewProps {
  bookId: string;
  data: ArrayBuffer;
  settings: Settings;
  theme: ThemeName;
  initialLocation?: string;
  onReady(info: ReaderReadyInfo): void;
  onPosition(p: ReaderPosition): void;
  onToggleUi(): void;
  onSelect?(sel: EpubSelection | null): void;
  /** bookmarks made on a passage tint that passage in the bookmark's colour */
  annotations?: AnnotationRecord[];
  registerClearSelection?(fn: () => void): void;
  onExternalLink(url: string): void;
  onError(code: ErrorCode): void;
}

const extractLimiter = makeLimiter(3);
const renderLimiter = makeLimiter(1);
const EST_HEIGHT = 900;

function Highlighted({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const low = text.toLowerCase();
  const out: React.ReactNode[] = [];
  let from = 0;
  let i: number;
  let k = 0;
  while ((i = low.indexOf(needle, from)) !== -1) {
    out.push(<Fragment key={k++}>{text.slice(from, i)}</Fragment>, <mark key={k++}>{text.slice(i, i + needle.length)}</mark>);
    from = i + needle.length;
  }
  out.push(<Fragment key={k++}>{text.slice(from)}</Fragment>);
  return <>{out}</>;
}


/**
 * The DOM range of `needle` inside a rendered page (whitespace-insensitive, as the stored bookmark text is).
 * When the passage occurs more than once, the occurrence nearest to the saved vertical position wins.
 */
function passageRange(root: HTMLElement, needle: string, ratio: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.rf-marker, button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let norm = '';
  const map: { node: Text; off: number }[] = [];
  let lastSpace = true;
  let prevParent: Element | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const t = node.nodeValue ?? '';
    if (prevParent && prevParent !== node.parentElement && !lastSpace) {
      norm += ' ';
      map.push({ node, off: 0 });
      lastSpace = true;
    }
    prevParent = node.parentElement;
    for (let i = 0; i < t.length; i++) {
      if (/\s/.test(t[i])) {
        if (!lastSpace) {
          norm += ' ';
          map.push({ node, off: i });
          lastSpace = true;
        }
      } else {
        norm += t[i];
        map.push({ node, off: i });
        lastSpace = false;
      }
    }
  }
  const find = (q: string): number[] => {
    const hits: number[] = [];
    for (let i = norm.indexOf(q); i !== -1; i = norm.indexOf(q, i + 1)) hits.push(i);
    return hits;
  };
  let len = needle.length;
  let hits = find(needle);
  if (!hits.length && needle.length > 30) {
    hits = find(needle.slice(0, 30)); // the text differs a little: tint from the start of the passage
  }
  if (!hits.length) return null;
  const start = hits.reduce((best, i) => (Math.abs(i / Math.max(1, norm.length) - ratio) < Math.abs(best / Math.max(1, norm.length) - ratio) ? i : best), hits[0]);
  const end = Math.min(norm.length - 1, start + len - 1);
  const a = map[start];
  const b = map[end];
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.off);
  r.setEnd(b.node, b.off + 1);
  return r;
}

/* The untouched PDF page, drawn on demand inside the text flow (images, tables, scans). */
function OriginalPage({ doc, num, adapt }: { doc: any; num: number; adapt: 'none' | 'dark' | 'sepia' }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const h = host.current!;
    let cancelled = false;
    let task: any;
    (async () => {
      await renderLimiter.acquire();
      try {
        if (cancelled) return;
        const page = await doc.getPage(num);
        const base = page.getViewport({ scale: 1 });
        const cssW = Math.max(200, h.clientWidth || 320);

        // 1) Cheap low-res pass to find the real content box (no white page margins).
        const probeScale = 360 / base.width;
        const pvp = page.getViewport({ scale: probeScale });
        const pc = document.createElement('canvas');
        pc.width = Math.floor(pvp.width);
        pc.height = Math.floor(pvp.height);
        const pctx = pc.getContext('2d', { alpha: false, willReadFrequently: true })!;
        const ptask = page.render({ canvasContext: pctx, viewport: pvp });
        task = ptask;
        await ptask.promise;
        if (cancelled) return;
        const box = contentBox(pctx, pc.width, pc.height);
        pc.width = 0;

        // Content rectangle in PDF points (the whole page when it is blank / edge to edge).
        const pad = 2 / probeScale;
        const x0 = box ? Math.max(0, box.x0 / probeScale - pad) : 0;
        const y0 = box ? Math.max(0, box.y0 / probeScale - pad) : 0;
        const x1 = box ? Math.min(base.width, box.x1 / probeScale + pad) : base.width;
        const y1 = box ? Math.min(base.height, box.y1 / probeScale + pad) : base.height;
        const bw = Math.max(1, x1 - x0);
        const bh = Math.max(1, y1 - y0);

        // 2) Natural size: fill the column, but never blow a small picture up by more than 1.5x the page-fit scale.
        const pageFit = cssW / base.width;
        const cssScale = Math.min(cssW / bw, pageFit * 1.5);
        let dpr = Math.min(window.devicePixelRatio || 1, 2);
        dpr = Math.min(dpr, 4096 / (bw * cssScale), 4096 / (bh * cssScale));
        const rs = cssScale * dpr;
        const vp = page.getViewport({ scale: rs, offsetX: -x0 * rs, offsetY: -y0 * rs });
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(bw * rs));
        c.height = Math.max(1, Math.ceil(bh * rs));
        c.style.width = Math.round(bw * cssScale) + 'px';
        c.style.aspectRatio = `${c.width} / ${c.height}`;
        task = page.render({ canvasContext: c.getContext('2d', { alpha: false })!, viewport: vp });
        await task.promise;
        if (cancelled) {
          c.width = 0;
          return;
        }
        h.style.minHeight = '0';
        h.replaceChildren(c);
        page.cleanup?.();
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException' && !cancelled) setFailed(true);
      } finally {
        renderLimiter.release();
      }
    })();
    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* ignore */
      }
      h.querySelectorAll('canvas').forEach((c) => {
        c.width = 0;
        c.height = 0;
      });
    };
  }, [doc, num]);
  return (
    <div ref={host} className={'rf-orig' + (adapt === 'dark' ? ' dark-adapt' : adapt === 'sepia' ? ' sepia-adapt' : '')} style={{ minHeight: 160 }}>
      {failed && <div className="ph muted">!</div>}
    </div>
  );
}

interface BlockProps {
  doc: any;
  num: number;
  registry: Registry;
  cache: React.MutableRefObject<Map<number, PageText>>;
  heights: React.MutableRefObject<Map<number, number>>;
  query: string;
  adapt: 'none' | 'dark' | 'sepia';
  onVisible(num: number, px: number): void;
}

const PageBlock = memo(function PageBlock(p: BlockProps) {
  const { t, n } = useT();
  const { doc, num, registry, cache, heights } = p;
  const textDir = useApp((s) => s.settings.textDir);
  const dirOf = (rtl: boolean) => (textDir === 'auto' ? (rtl ? 'rtl' : 'ltr') : textDir);
  const root = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [data, setData] = useState<PageText | null>(() => cache.current.get(num) ?? null);
  const [forceOrig, setForceOrig] = useState(false);

  useEffect(() => {
    const el = root.current!;
    registry.observe(el, setNear, (px) => p.onVisible(num, px));
    return () => registry.unobserve(el);
  }, [registry, num, p.onVisible]);

  useEffect(() => {
    if (!near || data) return;
    let cancelled = false;
    (async () => {
      await extractLimiter.acquire();
      try {
        if (cancelled) return;
        let res = cache.current.get(num);
        if (!res) {
          try {
            res = await extractPage(doc, num);
          } catch {
            res = { paras: [], chars: 0, endsOpen: false };
          }
          cache.current.set(num, res);
        }
        if (!cancelled) setData(res);
      } finally {
        extractLimiter.release();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [near, data, doc, num, cache]);

  const textless = !!data && data.chars < 25;
  const showOrig = near && (forceOrig || textless);

  // remember the real height so far-away pages keep a stable size
  useLayoutEffect(() => {
    const el = root.current;
    if (el && near && data) heights.current.set(num, el.offsetHeight);
  });

  const placeholderH = heights.current.get(num) ?? (heights.current.size ? Math.round([...heights.current.values()].reduce((a, b) => a + b, 0) / heights.current.size) : EST_HEIGHT);

  return (
    <section ref={root} className="rf-page" data-page={num} style={near && data ? undefined : { minHeight: placeholderH }}>
      <div className="rf-marker">
        <span>{t('reader.pageN', { n: n(num) })}</span>
        {data && !textless && near && (
          <button className="rf-orig-btn" onClick={() => setForceOrig((v) => !v)} aria-pressed={forceOrig}>
            {forceOrig ? <EyeOff size={15} aria-hidden="true" /> : <ImageIcon size={15} aria-hidden="true" />}
            {forceOrig ? t('pdf.hideOriginal') : t('pdf.showOriginal')}
          </button>
        )}
      </div>
      {near && !data && <div className="rf-loading"><div className="spinner" /></div>}
      {near && data && !showOrig &&
        data.paras.map((para, i) => {
          const cont = i === 0 && !!cache.current.get(num - 1)?.endsOpen && para.kind === 'p';
          const cls = (para.rtl ? 'ar' : '') + (cont ? ' cont' : '');
          return para.kind === 'h' ? (
            <h3 key={i} dir={dirOf(para.rtl)} lang={para.rtl ? 'ar' : undefined} className={cls}><Highlighted text={para.text} q={p.query} /></h3>
          ) : (
            <p key={i} dir={dirOf(para.rtl)} lang={para.rtl ? 'ar' : undefined} className={cls}><Highlighted text={para.text} q={p.query} /></p>
          );
        })}
      {showOrig && (
        <>
          <OriginalPage doc={doc} num={num} adapt={p.adapt} />
        </>
      )}
    </section>
  );
});

export function ReflowView(props: ReflowViewProps) {
  const selTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { t } = useT();
  const { settings, theme } = props;
  const P = useRef(props);
  P.current = props;

  const scrollerRef = useRef<HTMLDivElement>(null);


  /* ----- bookmarked passages: soft tint in the bookmark's colour (CSS Custom Highlight API: no DOM changes) ----- */
  useEffect(() => {
    const sc = scrollerRef.current;
    const reg = (CSS as any).highlights;
    const HL = (window as any).Highlight;
    if (!sc || !reg || !HL) return;
    const styleEl = document.createElement('style');
    document.head.appendChild(styleEl);
    let names: string[] = [];
    let timer: ReturnType<typeof setTimeout>;
    const apply = () => {
      const groups = new Map<string, { fill: string; ranges: Range[] }>();
      for (const a of P.current.annotations ?? []) {
        if (a.type !== 'bookmark' || !a.text || !a.page) continue;
        const sec = sc.querySelector<HTMLElement>(`section[data-page="${a.page}"]`);
        if (!sec) continue;
        const ratio = Number(/^p:\d+:([\d.]+)/.exec(a.location)?.[1] ?? 0);
        let range: Range | null = null;
        try {
          range = passageRange(sec, a.text, ratio);
        } catch {
          range = null;
        }
        if (!range) continue;
        const hex = resolveMarkColor(a.markColor, P.current.settings.markColor, P.current.theme);
        const name = 'bm-' + hex.slice(1).toLowerCase();
        const g = groups.get(name) ?? { fill: softFill(hex, P.current.theme), ranges: [] };
        g.ranges.push(range);
        groups.set(name, g);
      }
      for (const n of names) if (!groups.has(n)) reg.delete(n);
      names = [...groups.keys()];
      let css = '';
      for (const [name, g] of groups) {
        reg.set(name, new HL(...g.ranges));
        css += `::highlight(${name}){background-color:${g.fill};}`;
      }
      styleEl.textContent = css;
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(apply, 120);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(sc, { childList: true, subtree: true });
    schedule();
    return () => {
      mo.disconnect();
      clearTimeout(timer);
      for (const n of names) reg.delete(n);
      styleEl.remove();
    };
  }, [props.annotations, props.settings.markColor, props.theme]);

  /* ----- text selection → "bookmark this passage" dock ----- */
  useEffect(() => {
    P.current.registerClearSelection?.(() => {
      try {
        window.getSelection()?.removeAllRanges();
      } catch {
        /* ignore */
      }
    });
    const onSel = () => {
      clearTimeout(selTimer.current);
      selTimer.current = setTimeout(() => {
        const sc = scrollerRef.current;
        const sel = window.getSelection();
        const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
        if (!sc || !sel || sel.rangeCount === 0 || sel.isCollapsed || !text || !sc.contains(sel.anchorNode)) {
          P.current.onSelect?.(null);
          return;
        }
        const range = sel.getRangeAt(0);
        const el = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>('section[data-page]');
        if (!el) {
          P.current.onSelect?.(null);
          return;
        }
        const page = Number(el.dataset.page);
        const r = el.getBoundingClientRect();
        const rr = range.getBoundingClientRect();
        const offset = clamp((rr.top - r.top) / Math.max(1, r.height), 0, 0.98);
        P.current.onSelect?.({ cfiRange: '', text, page, offset });
      }, 220);
    };
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      clearTimeout(selTimer.current);
    };
  }, []);
  const [opened, setOpened] = useState<{ doc: any; n: number } | null>(null);
  const [query, setQuery] = useState('');
  const registry = useMemo(() => makeRegistry(() => scrollerRef.current), []);
  const cache = useRef(new Map<number, PageText>());
  const heights = useRef(new Map<number, number>());
  const textCache = useRef(new Map<number, string>());
  const visible = useRef(new Map<number, number>());
  const restoring = useRef(true);
  const nRef = useRef(0);
  nRef.current = opened?.n ?? 0;
  const apiRef = useRef<ReaderApi | null>(null);
  const tocRef = useRef<ReaderReadyInfo['toc']>([]);
  const [, force] = useState(0);

  /* ----- open ----- */
  useEffect(() => {
    let disposed = false;
    let handle: OpenedPdf | null = null;
    (async () => {
      try {
        await loadPdfjs();
        let bytes = new Uint8Array(P.current.data.slice(0));
        if (bytes.byteLength < 80 * 1024 * 1024) {
          // Repair reversed Arabic ligatures (لا / لأ …) before text extraction.
          try {
            const { fixArabicLigatures } = await import('../lib/arabicFix');
            const fixed = await fixArabicLigatures(bytes.slice(0));
            if (fixed) bytes = fixed;
          } catch {
            /* fall back to the untouched file */
          }
        }
        if (disposed) return;
        const h = await openPdf(bytes);
        handle = h;
        if (disposed) {
          await h.dispose();
          return;
        }
        let toc: ReaderReadyInfo['toc'] = [];
        try {
          toc = convertOutline((await h.doc.getOutline()) ?? []);
        } catch {
          /* no outline */
        }
        tocRef.current = toc;
        setOpened({ doc: h.doc, n: h.doc.numPages });
      } catch (e) {
        if (!disposed) P.current.onError(isPasswordError(e) ? 'passwordPdf' : 'corruptPdf');
      }
    })();
    return () => {
      disposed = true;
      registry.disconnect();
      void handle?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bookId, props.data]);

  const blockEl = (num: number) => scrollerRef.current?.querySelector<HTMLElement>(`section[data-page="${num}"]`) ?? null;

  const scrollToPage = useCallback((num: number, offset = 0, smooth = false) => {
    const sc = scrollerRef.current;
    const el = blockEl(num);
    if (!sc || !el) return;
    const top = sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top + offset * el.offsetHeight - 6;
    sc.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const currentPage = () => {
    let best = 0;
    let bestPx = -1;
    visible.current.forEach((px, num) => {
      if (px > bestPx || (px === bestPx && num < best)) {
        best = num;
        bestPx = px;
      }
    });
    return bestPx > 0 ? best : null;
  };

  /* ----- position reporting ----- */
  const report = useMemo(
    () =>
      throttle(() => {
        const sc = scrollerRef.current;
        const total = nRef.current;
        if (!sc || !total || restoring.current) return;
        // the page crossing the top third of the screen is "current"
        const probe = sc.getBoundingClientRect().top + sc.clientHeight * 0.3;
        let page = currentPage() ?? 1;
        for (const [num] of visible.current) {
          const r = blockEl(num)?.getBoundingClientRect();
          if (r && r.top <= probe && r.bottom > probe) {
            page = num;
            break;
          }
        }
        const el = blockEl(page);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const offset = clamp((sc.getBoundingClientRect().top - r.top) / Math.max(1, r.height), 0, 0.98);
        const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 6;
        const pct = atBottom && page === total ? 1 : (page - 1 + offset) / total;
        P.current.onPosition({ location: `p:${page}:${offset.toFixed(4)}`, percentage: clamp(pct, 0, 1), page, total, atEnd: atBottom && page === total });
      }, 50),
    []
  );

  const onVisible = useCallback(
    (num: number, px: number) => {
      if (px > 0) visible.current.set(num, px);
      else visible.current.delete(num);
      report();
    },
    [report]
  );

  useEffect(() => {
    const sc = scrollerRef.current!;
    const on = () => report();
    sc.addEventListener('scroll', on, { passive: true });
    return () => {
      sc.removeEventListener('scroll', on);
      report.cancel();
    };
  }, [report]);

  /* ----- restore ----- */
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !opened) return;
    restored.current = true;
    const m = /^p:(\d+):([\d.]+)$/.exec(P.current.initialLocation ?? '');
    const page = m ? clamp(parseInt(m[1], 10), 1, opened.n) : 1;
    const off = m ? clamp(parseFloat(m[2]), 0, 0.98) : 0;
    scrollToPage(page, off);
    const t1 = setTimeout(() => scrollToPage(page, off), 300);
    const t2 = setTimeout(() => scrollToPage(page, off), 900);
    const t3 = setTimeout(() => {
      restoring.current = false;
      report();
    }, 1300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  /* ----- API ----- */
  const total = opened?.n ?? 0;
  const api: ReaderApi = useMemo(() => {
    const step = (dir: 1 | -1) => {
      const sc = scrollerRef.current;
      sc?.scrollBy({ top: dir * sc.clientHeight * 0.88, behavior: 'smooth' });
    };
    const cur = () => currentPage() ?? 1;
    return {
      next: () => step(1),
      prev: () => step(-1),
      nextSection: () => scrollToPage(Math.min(total, cur() + 1), 0, true),
      prevSection: () => scrollToPage(Math.max(1, cur() - 1), 0, true),
      goToLocation: (loc) => {
        const m = /^p:(\d+):([\d.]+)$/.exec(loc);
        if (m) scrollToPage(clamp(parseInt(m[1], 10), 1, total), parseFloat(m[2]), true);
      },
      goToToc: async (item) => {
        if (!opened) return;
        const pg = await resolveOutlineDest(opened.doc, item.dest);
        if (pg) scrollToPage(clamp(pg, 1, total), 0, true);
      },
      goToPercent: (pc) => scrollToPage(clamp(Math.round(pc * total) || 1, 1, total), 0),
      goToPage: (pg) => scrollToPage(clamp(Math.round(pg), 1, total), 0, false),
      // "zoom" in reflow mode means text size
      zoomBy: (f) => {
        const st = useApp.getState();
        st.setSettings({ fontSize: clamp(Math.round(st.settings.fontSize * f), 13, 34) });
      },
      setFit: () => undefined,
      goToHit: (hit: SearchHit) => {
        const m = /^p:(\d+):/.exec(hit.location);
        if (m) {
          setQuery(hit.label ?? '');
          scrollToPage(clamp(parseInt(m[1], 10), 1, total), 0, true);
        }
      },
      search: async (q, onHit, cancel) => {
        setQuery('');
        if (!opened) return { hasText: true };
        return searchPdf(opened.doc, textCache.current, q, onHit, cancel);
      },
    } as ReaderApi;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, total, scrollToPage]);
  apiRef.current = api;

  useEffect(() => {
    if (opened) P.current.onReady({ toc: tocRef.current, api, pdfDoc: opened.doc, numPages: opened.n });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  /* ----- typography ----- */
  const { stack } = resolveFont(settings.font, false);
  const family = stack ? `${stack}, 'Noto Naskh Arabic', 'IBM Plex Sans Arabic', serif` : `var(--font-read), 'Noto Naskh Arabic', serif`;
  const adapt: 'none' | 'dark' | 'sepia' = settings.pdfAdaptTheme ? (theme === 'dark' ? 'dark' : theme === 'sepia' ? 'sepia' : 'none') : 'none';

  const style = {
    ['--rf-size' as string]: `${settings.fontSize}px`,
    ['--rf-lh' as string]: String(settings.lineHeight),
    ['--rf-gap' as string]: `${settings.paragraphSpacing}em`,
    ['--rf-family' as string]: family,
    ['--rf-align' as string]: settings.textAlign === 'justify' ? 'justify' : 'start',
    ['--rf-weight' as string]: settings.textWeight === 'bold' ? 600 : 400,
    maxWidth: settings.maxWidth,
    paddingInline: `max(${settings.margin}px, var(--safe-l))`,
  } as React.CSSProperties;

  // re-measure blocks when typography changes (heights are cached per page)
  const typoKey = [settings.fontSize, settings.lineHeight, settings.paragraphSpacing, settings.font, settings.maxWidth, settings.margin].join('|');
  useEffect(() => {
    heights.current.clear();
    force((x) => x + 1);
  }, [typoKey]);

  const pages = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);

  return (
    <div
      className="rf-scroller"
      ref={scrollerRef}
      onClick={(e) => {
        if (window.getSelection()?.toString()) return;
        if ((e.target as Element).closest('button, a')) return;
        P.current.onToggleUi();
      }}
    >
      <div className="rf-col" style={style}>
        {opened &&
          pages.map((num) => (
            <PageBlock
              key={num}
              doc={opened.doc}
              num={num}
              registry={registry}
              cache={cache}
              heights={heights}
              query={query}
              adapt={adapt}
              onVisible={onVisible}
            />
          ))}
      </div>
      {!opened && (
        <div className="reader-state">
          <div className="spinner" />
          <p>{t('reader.opening')}</p>
        </div>
      )}
    </div>
  );
}
