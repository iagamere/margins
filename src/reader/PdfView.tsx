import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { isPasswordError, loadPdfjs, openPdf, resolveOutlineDest, type OpenedPdf } from '../lib/pdf';
import type { ErrorCode, ReaderApi, ReaderPosition, ReaderReadyInfo, SearchHit, Settings, ThemeName, TocItem } from '../lib/types';
import { clamp, debounce, sleep, throttle } from '../lib/utils';

export interface PdfViewProps {
  bookId: string;
  data: ArrayBuffer;
  settings: Settings;
  theme: ThemeName;
  initialLocation?: string;
  onReady(info: ReaderReadyInfo): void;
  onPosition(p: ReaderPosition): void;
  onToggleUi(): void;
  onExternalLink(url: string): void;
  onError(code: ErrorCode): void;
}

type Size = { w: number; h: number };

/* ---------- tiny render-concurrency limiter ---------- */
export function makeLimiter(max: number) {
  let active = 0;
  const q: Array<() => void> = [];
  return {
    acquire: () =>
      new Promise<void>((res) => {
        const go = () => {
          active++;
          res();
        };
        active < max ? go() : q.push(go);
      }),
    release: () => {
      active--;
      q.shift()?.();
    },
  };
}

/* ---------- viewport observers shared by every page slot ---------- */
export function makeRegistry(getRoot: () => Element | null) {
  const near = new Map<Element, (v: boolean) => void>();
  const vis = new Map<Element, (px: number) => void>();
  let nearIO: IntersectionObserver | undefined;
  let visIO: IntersectionObserver | undefined;
  return {
    observe(el: Element, onNear: (v: boolean) => void, onVis: (px: number) => void) {
      nearIO ??= new IntersectionObserver((es) => es.forEach((e) => near.get(e.target)?.(e.isIntersecting)), { root: getRoot(), rootMargin: '140% 0px 140% 0px' });
      visIO ??= new IntersectionObserver((es) => es.forEach((e) => vis.get(e.target)?.(e.isIntersecting ? e.intersectionRect.height : 0)), { root: getRoot(), threshold: [0, 0.05, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1] });
      near.set(el, onNear);
      vis.set(el, onVis);
      nearIO.observe(el);
      visIO.observe(el);
    },
    unobserve(el: Element) {
      near.delete(el);
      vis.delete(el);
      nearIO?.unobserve(el);
      visIO?.unobserve(el);
    },
    disconnect() {
      nearIO?.disconnect();
      visIO?.disconnect();
      near.clear();
      vis.clear();
    },
  };
}

export type Registry = ReturnType<typeof makeRegistry>;
const limiter = makeLimiter(2);

/* ---------- a single page ---------- */
interface SlotProps {
  doc: any;
  lib: any;
  num: number;
  size: Size;
  cssScale: number;
  registry: Registry;
  adapt: 'none' | 'dark' | 'sepia';
  query: string;
  onVisible(num: number, px: number): void;
  onGoToDest(dest: unknown): void;
  onExternal(url: string): void;
  failedLabel: string;
}

const PageSlot = memo(function PageSlot(p: SlotProps) {
  const { doc, lib, num, size, cssScale, registry, onVisible } = p;
  const slot = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const linkHost = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
  const cb = useRef({ goto: p.onGoToDest, ext: p.onExternal });
  cb.current = { goto: p.onGoToDest, ext: p.onExternal };

  useEffect(() => {
    const el = slot.current!;
    registry.observe(el, setNear, (px) => onVisible(num, px));
    return () => registry.unobserve(el);
  }, [registry, num, onVisible]);

  useEffect(() => {
    const ch = canvasHost.current!;
    const th = textHost.current!;
    const lh = linkHost.current!;
    if (!near) {
      ch.querySelectorAll('canvas').forEach((c) => {
        c.width = 0;
        c.height = 0;
      });
      ch.replaceChildren();
      th.replaceChildren();
      lh.replaceChildren();
      return;
    }
    let cancelled = false;
    let task: any;
    let textLayer: any;
    (async () => {
      await limiter.acquire();
      try {
        if (cancelled) return;
        const page = await doc.getPage(num);
        if (cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        let out = dpr;
        const base = page.getViewport({ scale: cssScale });
        // cap very large canvases (memory on phones)
        const maxPx = 14_000_000;
        if (base.width * base.height * out * out > maxPx) out = Math.sqrt(maxPx / (base.width * base.height));
        const viewport = page.getViewport({ scale: cssScale * out });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('no 2d context');
        task = page.render({ canvasContext: ctx, viewport });
        await task.promise;
        if (cancelled) {
          canvas.width = 0;
          return;
        }
        const old = ch.querySelectorAll('canvas');
        ch.replaceChildren(canvas);
        old.forEach((c) => {
          c.width = 0;
          c.height = 0;
        });
        setFailed(false);

        // selectable text
        th.replaceChildren();
        slot.current?.style.setProperty('--scale-factor', String(cssScale));
        slot.current?.style.setProperty('--user-unit', '1');
        slot.current?.style.setProperty('--total-scale-factor', String(cssScale));
        try {
          textLayer = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: th, viewport: base });
          await textLayer.render();
          markFound(th, p.query);
        } catch {
          /* text layer is optional */
        }

        // internal / external links
        lh.replaceChildren();
        try {
          const annots = await page.getAnnotations({ intent: 'display' });
          if (cancelled) return;
          for (const a of annots) {
            if (a.subtype !== 'Link' || (!a.dest && !a.url && !a.unsafeUrl)) continue;
            const r = base.convertToViewportRectangle(a.rect);
            const d = document.createElement('div');
            d.className = 'pdf-link';
            d.style.cssText = `position:absolute;left:${Math.min(r[0], r[2])}px;top:${Math.min(r[1], r[3])}px;width:${Math.abs(r[2] - r[0])}px;height:${Math.abs(r[3] - r[1])}px;cursor:pointer;z-index:3`;
            d.addEventListener('click', (e) => {
              e.stopPropagation();
              if (a.dest) cb.current.goto(a.dest);
              else cb.current.ext(a.url || a.unsafeUrl);
            });
            lh.appendChild(d);
          }
        } catch {
          /* links are optional */
        }
        page.cleanup?.();
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException' && !cancelled) setFailed(true);
      } finally {
        limiter.release();
      }
    })();
    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* ignore */
      }
      try {
        textLayer?.cancel();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, cssScale, doc, num]);

  // re-mark search hits when the query changes without a re-render of the page
  useEffect(() => {
    if (textHost.current) markFound(textHost.current, p.query);
  }, [p.query]);

  return (
    <div
      ref={slot}
      className={'pdf-page' + (p.adapt === 'dark' ? ' dark-adapt' : p.adapt === 'sepia' ? ' sepia-adapt' : '')}
      data-page={num}
      style={{ width: size.w * cssScale, height: size.h * cssScale }}
    >
      <div ref={canvasHost} style={{ position: 'absolute', inset: 0 }} />
      <div ref={textHost} className="textLayer" />
      <div ref={linkHost} style={{ position: 'absolute', inset: 0 }} />
      {failed && <div className="ph">{p.failedLabel}</div>}
    </div>
  );
});

function markFound(host: HTMLElement, q: string) {
  const needle = q.trim().toLowerCase();
  host.querySelectorAll('span.found').forEach((s) => s.classList.remove('found'));
  if (!needle) return;
  host.querySelectorAll('span').forEach((s) => {
    if ((s.textContent ?? '').toLowerCase().includes(needle)) s.classList.add('found');
  });
}

/* ---------- the viewer ---------- */
export function PdfView(props: PdfViewProps) {
  const { t } = useT();
  const { settings, theme } = props;
  const P = useRef(props);
  P.current = props;

  const scrollerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<{ doc: any; lib: any; n: number } | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [fit, setFit] = useState<'width' | 'page'>(settings.readingMode === 'paged' ? 'page' : 'width');
  const [zoom, setZoom] = useState(1);
  const [query, setQuery] = useState('');

  const paged = settings.readingMode === 'paged';
  const registry = useMemo(() => makeRegistry(() => scrollerRef.current), []);
  const visible = useRef(new Map<number, number>());
  const restoring = useRef(true);
  const pending = useRef<null | { type: 'page'; page: number; offset: number } | { type: 'ratio'; ratio: number; fx: number; fy: number }>(null);
  const textCache = useRef(new Map<number, string>());
  const apiRef = useRef<ReaderApi | null>(null);
  const tocRef = useRef<TocItem[]>([]);
  const failedLabel = t('reader.pageFailed');

  /* ----- open ----- */
  useEffect(() => {
    let disposed = false;
    let handle: OpenedPdf | null = null;
    (async () => {
      try {
        const [{ lib }, h] = await Promise.all([loadPdfjs(), openPdf(new Uint8Array(P.current.data.slice(0)))]);
        handle = h;
        if (disposed) {
          await h.dispose();
          return;
        }
        const doc = h.doc;
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        first.cleanup?.();
        const n: number = doc.numPages;
        setSizes(Array.from({ length: n }, () => ({ w: vp.width, h: vp.height })));
        setOpened({ doc, lib, n });

        // outline
        let toc: TocItem[] = [];
        try {
          const outline = await doc.getOutline();
          const conv = (items: any[], prefix = ''): TocItem[] =>
            (items ?? []).map((it, i) => ({ id: `${prefix}${i}`, label: String(it.title ?? '').replace(/\s+/g, ' ').trim() || '—', dest: it.dest ?? it.url, children: conv(it.items ?? [], `${prefix}${i}-`) }));
          toc = conv(outline ?? []);
        } catch {
          /* no outline */
        }
        tocRef.current = toc;
        P.current.onReady({ toc, api: apiRef.current!, pdfDoc: doc, numPages: n });

        // true page sizes in the background, so mixed-size documents lay out correctly
        if (n > 1 && n <= 3000) {
          let acc: Size[] | null = null;
          for (let i = 2; i <= n; i++) {
            if (disposed) return;
            try {
              const pg = await doc.getPage(i);
              const v = pg.getViewport({ scale: 1 });
              pg.cleanup?.();
              if (Math.abs(v.width - vp.width) > 0.5 || Math.abs(v.height - vp.height) > 0.5) {
                acc ??= Array.from({ length: n }, () => ({ w: vp.width, h: vp.height }));
                acc[i - 1] = { w: v.width, h: v.height };
              }
            } catch {
              /* keep default */
            }
            if (i % 40 === 0) {
              if (acc) {
                const snap = acc.slice();
                setSizes(snap);
              }
              await sleep(0);
            }
          }
          if (acc && !disposed) setSizes(acc.slice());
        }
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

  /* ----- container size ----- */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(debounce(measure, 100));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ----- scale ----- */
  const sidePad = box.w > 700 ? 24 : 8;
  const topPad = 12;
  const cssScale = useMemo(() => {
    const s0 = sizes[0];
    if (!s0 || !box.w) return 0;
    const byWidth = (box.w - sidePad * 2) / s0.w;
    const insetsV = 24 + 28; // safe areas + page gaps (approx.)
    const byPage = Math.min(byWidth, (box.h - insetsV - topPad) / s0.h);
    return Math.max(0.1, (fit === 'width' ? byWidth : byPage) * zoom);
  }, [sizes, box.w, box.h, fit, zoom, sidePad]);

  const prevScale = useRef(0);
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    if (!sc || !cssScale) return;
    const pend = pending.current;
    if (prevScale.current && pend?.type === 'ratio') {
      sc.scrollLeft = (sc.scrollLeft + pend.fx) * pend.ratio - pend.fx;
      sc.scrollTop = (sc.scrollTop + pend.fy) * pend.ratio - pend.fy;
      pending.current = null;
    }
    prevScale.current = cssScale;
  }, [cssScale]);

  /* ----- navigation helpers ----- */
  const slotEl = (n: number) => pagesRef.current?.children[n - 1] as HTMLElement | undefined;

  const scrollToPage = useCallback((n: number, offset = 0, smooth = false) => {
    const sc = scrollerRef.current;
    const el = slotEl(n);
    if (!sc || !el) return false;
    const isPaged = P.current.settings.readingMode === 'paged';
    const top = isPaged && offset === 0 ? el.offsetTop + el.offsetHeight / 2 - sc.clientHeight / 2 : el.offsetTop - topPad + offset * el.offsetHeight;
    sc.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
    return true;
  }, []);

  const currentPage = () => {
    let best = 1;
    let bestPx = -1;
    visible.current.forEach((px, n) => {
      if (px > bestPx || (px === bestPx && n < best)) {
        best = n;
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
        const n = P.current ? tocCount.current : 0;
        if (!sc || !n || restoring.current) return;
        const page = currentPage();
        if (!page) return;
        const el = slotEl(page);
        if (!el) return;
        const paged = P.current.settings.readingMode === 'paged';
        const offset = paged ? 0 : clamp((sc.scrollTop - (el.offsetTop - topPad)) / Math.max(1, el.offsetHeight), 0, 0.98);
        const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 6;
        const pct = atBottom && page === n ? 1 : (page - 1 + offset) / n;
        P.current.onPosition({ location: `p:${page}:${offset.toFixed(4)}`, percentage: clamp(pct, 0, 1), page, total: n, atEnd: atBottom && page === n });
      }, 50),
    []
  );
  const tocCount = useRef(0);
  tocCount.current = opened?.n ?? 0;

  const onVisible = useCallback(
    (num: number, px: number) => {
      if (px > 0) visible.current.set(num, px);
      else visible.current.delete(num);
      report();
    },
    [report]
  );

  /* ----- restore saved position (once the first layout exists) ----- */
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !opened || !cssScale) return;
    restored.current = true;
    const m = /^p:(\d+):([\d.]+)$/.exec(P.current.initialLocation ?? '');
    const page = m ? clamp(parseInt(m[1], 10), 1, opened.n) : 1;
    const off = m ? clamp(parseFloat(m[2]), 0, 0.98) : 0;
    scrollToPage(page, off);
    // layout can still shift while real page sizes stream in; re-assert once, then release.
    const t1 = setTimeout(() => scrollToPage(page, off), 350);
    const t2 = setTimeout(() => {
      restoring.current = false;
      report();
    }, 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, cssScale]);

  /* ----- scroll listener ----- */
  useEffect(() => {
    const sc = scrollerRef.current!;
    const on = () => report();
    sc.addEventListener('scroll', on, { passive: true });
    return () => {
      sc.removeEventListener('scroll', on);
      report.cancel();
    };
  }, [report]);

  /* ----- mode switch → fit mode ----- */
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    const page = currentPage() ?? 1;
    setFit(paged ? 'page' : 'width');
    setZoom(1);
    setTimeout(() => scrollToPage(page, 0), 60);
  }, [paged, scrollToPage]);

  /* ----- zoom (buttons, ctrl+wheel, pinch) ----- */
  const applyZoom = useCallback((factor: number, fx?: number, fy?: number) => {
    const sc = scrollerRef.current;
    if (!sc) return;
    setZoom((z) => {
      const nz = clamp(z * factor, 0.5, 5);
      const ratio = nz / z;
      if (ratio !== 1) pending.current = { type: 'ratio', ratio, fx: fx ?? sc.clientWidth / 2, fy: fy ?? sc.clientHeight / 2 };
      return nz;
    });
  }, []);

  useEffect(() => {
    const sc = scrollerRef.current!;
    const pages = pagesRef.current!;
    let startDist = 0;
    let ratio = 1;
    let mid = { x: 0, y: 0 };
    let pinching = false;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinching = true;
        startDist = dist(e);
        ratio = 1;
        const r = sc.getBoundingClientRect();
        mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top };
        pages.style.transformOrigin = `${mid.x + sc.scrollLeft}px ${mid.y + sc.scrollTop}px`;
      }
    };
    const tm = (e: TouchEvent) => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault();
      ratio = clamp(dist(e) / startDist, 0.4, 3);
      pages.style.transform = `scale(${ratio})`;
    };
    const te = (e: TouchEvent) => {
      if (!pinching || e.touches.length >= 2) return;
      pinching = false;
      pages.style.transform = '';
      pages.style.transformOrigin = '';
      if (Math.abs(ratio - 1) > 0.03) applyZoom(ratio, mid.x, mid.y);
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = sc.getBoundingClientRect();
      applyZoom(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    sc.addEventListener('touchstart', ts, { passive: true });
    sc.addEventListener('touchmove', tm, { passive: false });
    sc.addEventListener('touchend', te, { passive: true });
    sc.addEventListener('touchcancel', te, { passive: true });
    sc.addEventListener('wheel', wheel, { passive: false });
    return () => {
      sc.removeEventListener('touchstart', ts);
      sc.removeEventListener('touchmove', tm);
      sc.removeEventListener('touchend', te);
      sc.removeEventListener('touchcancel', te);
      sc.removeEventListener('wheel', wheel);
    };
  }, [applyZoom]);

  /* ----- page resolution for links / outline ----- */
  const goToDest = useCallback(
    async (dest: unknown) => {
      if (!opened) return;
      if (typeof dest === 'string' && /^https?:|^mailto:/i.test(dest)) return P.current.onExternalLink(dest);
      const page = await resolveOutlineDest(opened.doc, dest);
      if (page) scrollToPage(clamp(page, 1, opened.n), 0, true);
    },
    [opened, scrollToPage]
  );

  /* ----- public API ----- */
  const n = opened?.n ?? 0;
  const api: ReaderApi = useMemo(() => {
    const pageNow = () => currentPage() ?? 1;
    const isPaged = () => P.current.settings.readingMode === 'paged';
    const scrollBy = (dir: 1 | -1) => {
      const sc = scrollerRef.current;
      sc?.scrollBy({ top: dir * sc.clientHeight * 0.88, behavior: 'smooth' });
    };
    return {
      next: () => (isPaged() && zoomIsOne.current ? scrollToPage(Math.min(n, pageNow() + 1), 0, true) : scrollBy(1)),
      prev: () => (isPaged() && zoomIsOne.current ? scrollToPage(Math.max(1, pageNow() - 1), 0, true) : scrollBy(-1)),
      nextSection: () => scrollToPage(Math.min(n, pageNow() + 1), 0, true),
      prevSection: () => scrollToPage(Math.max(1, pageNow() - 1), 0, true),
      goToLocation: (loc) => {
        const m = /^p:(\d+):([\d.]+)$/.exec(loc);
        if (m) scrollToPage(clamp(parseInt(m[1], 10), 1, n), parseFloat(m[2]), true);
      },
      goToToc: (item) => void goToDest(item.dest),
      goToPercent: (p) => scrollToPage(clamp(Math.round(p * n) || 1, 1, n), 0, false),
      goToPage: (pg) => scrollToPage(clamp(Math.round(pg), 1, n), 0, false),
      zoomBy: (f) => applyZoom(f),
      setFit: (m) => {
        setFit(m);
        setZoom(1);
        const page = pageNow();
        setTimeout(() => scrollToPage(page, 0), 60);
      },
      goToHit: (hit: SearchHit) => {
        const m = /^p:(\d+):/.exec(hit.location);
        if (m) {
          setQuery(hit.label ?? '');
          scrollToPage(clamp(parseInt(m[1], 10), 1, n), 0, true);
        }
      },
      async search(q, onHit, cancel) {
        const doc = opened?.doc;
        const needle = q.trim().toLowerCase();
        setQuery('');
        if (!doc || !needle) return { hasText: true };
        let anyText = false;
        let count = 0;
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancel.cancelled) break;
          let text = textCache.current.get(i);
          if (text === undefined) {
            try {
              const pg = await doc.getPage(i);
              const tc = await pg.getTextContent();
              text = tc.items.map((it: any) => it.str + (it.hasEOL ? '\n' : '')).join(' ').replace(/\s+/g, ' ');
              pg.cleanup?.();
            } catch {
              text = '';
            }
            textCache.current.set(i, text);
          }
          if (text.trim()) anyText = true;
          const low = text.toLowerCase();
          let from = 0;
          let idx: number;
          while ((idx = low.indexOf(needle, from)) !== -1 && count < 300) {
            const s = Math.max(0, idx - 36);
            onHit({ id: `${i}:${idx}`, location: `p:${i}:0`, label: q.trim(), excerpt: (s > 0 ? '…' : '') + text.slice(s, idx + needle.length + 60) + '…' });
            count++;
            from = idx + needle.length;
          }
          if (count >= 300) break;
          if (i % 4 === 0) await sleep(0);
        }
        return { hasText: anyText || count > 0 };
      },
    } as ReaderApi;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, opened, goToDest, scrollToPage, applyZoom]);
  apiRef.current = api;
  const zoomIsOne = useRef(true);
  zoomIsOne.current = Math.abs(zoom - 1) < 0.02;

  // keep the parent's api reference fresh once the document is ready
  useEffect(() => {
    if (opened) P.current.onReady({ toc: tocRef.current, api, pdfDoc: opened.doc, numPages: opened.n });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const adapt: 'none' | 'dark' | 'sepia' = settings.pdfAdaptTheme ? (theme === 'dark' ? 'dark' : theme === 'sepia' ? 'sepia' : 'none') : 'none';

  // Tap handling (paged: edges turn pages; otherwise toggle toolbar). Ignored while selecting text / pinching.
  const tapStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    tapStart.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = tapStart.current;
    tapStart.current = null;
    if (!s) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8 || Date.now() - s.t > 450) return;
    if (window.getSelection()?.toString()) return;
    if ((e.target as Element).closest('.pdf-link')) return;
    const r = e.clientX / window.innerWidth;
    if (P.current.settings.readingMode === 'paged' && zoomIsOne.current) {
      if (r < 0.22) return api.prev();
      if (r > 0.78) return api.next();
    }
    P.current.onToggleUi();
  };

  return (
    <div className={'pdf-scroller' + (paged && zoomIsOne.current ? ' snap' : '')} ref={scrollerRef} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="pdf-pages" ref={pagesRef} style={{ paddingInline: sidePad }}>
        {opened && cssScale > 0
          ? sizes.map((s, i) => (
              <PageSlot
                key={i}
                doc={opened.doc}
                lib={opened.lib}
                num={i + 1}
                size={s}
                cssScale={cssScale}
                registry={registry}
                adapt={adapt}
                query={query}
                onVisible={onVisible}
                onGoToDest={goToDest}
                onExternal={(u) => P.current.onExternalLink(u)}
                failedLabel={failedLabel}
              />
            ))
          : null}
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
