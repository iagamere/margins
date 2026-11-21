import { useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';
import { useT } from '../lib/i18n';
import { buildEpubCss, collectFontFaceCss, HIGHLIGHT_COLORS } from '../lib/readerCss';
import { resolveMarkColor } from '../lib/markColor';
import type { AnnotationRecord, ErrorCode, ReaderApi, ReaderReadyInfo, ReaderPosition, SearchHit, Settings, ThemeName, TocItem } from '../lib/types';
import { debounce, sleep } from '../lib/utils';
import { kvGet, kvSet } from '../lib/db';

export interface EpubSelection {
  cfiRange: string;
  text: string;
  /** PDF reflow only: page and vertical position (0‑1) of the selection */
  page?: number;
  offset?: number;
}

export interface EpubViewProps {
  bookId: string;
  data: ArrayBuffer;
  rtl: boolean;
  settings: Settings;
  theme: ThemeName;
  initialLocation?: string;
  annotations: AnnotationRecord[];
  onReady(info: ReaderReadyInfo): void;
  onPosition(p: ReaderPosition): void;
  onToggleUi(): void;
  onSelect(sel: EpubSelection | null): void;
  onHighlightClick(id: string): void;
  onExternalLink(url: string): void;
  onError(code: ErrorCode): void;
  /** Called with the DOM element so the parent can clear a selection programmatically. */
  registerClearSelection(fn: () => void): void;
}

function convertToc(items: any[], prefix = ''): TocItem[] {
  return (items ?? []).map((it, i) => ({
    id: `${prefix}${i}`,
    label: String(it.label ?? '').replace(/\s+/g, ' ').trim() || '—',
    href: it.href,
    children: convertToc(it.subitems ?? [], `${prefix}${i}-`),
  }));
}

function flatten(items: TocItem[]): TocItem[] {
  return items.flatMap((i) => [i, ...flatten(i.children)]);
}

const stripHash = (h?: string) => (h ?? '').split('#')[0];

export function EpubView(props: EpubViewProps) {
  const { t } = useT();
  const { settings, theme, rtl } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  // Always-fresh props for long-lived callbacks created inside the mount effect.
  const P = useRef(props);
  P.current = props;

  const renditionRef = useRef<any>(null);
  const bookRef = useRef<any>(null);
  const cssRef = useRef('');
  const lastCfi = useRef<string | undefined>(props.initialLocation);
  const appliedHl = useRef(new Map<string, { cfiRange: string; color: string }>());
  const appliedBm = useRef(new Map<string, { cfiRange: string; color: string; fill: boolean }>());
  const selContents = useRef<any>(null);
  const syncRef = useRef<null | (() => void)>(null);

  const scroll = settings.readingMode === 'scroll';

  const buildCss = () => buildEpubCss(P.current.settings, P.current.theme, P.current.rtl);

  /* ---------- mount / re-mount when the flow changes ---------- */
  useEffect(() => {
    let disposed = false;
    const host = hostRef.current!;
    setLoading(true);
    appliedHl.current = new Map();
    appliedBm.current = new Map();
    let book: any;
    let rendition: any;
    let ro: ResizeObserver | undefined;
    let locationsReady = false;
    let spineLen = 1;
    let tocFlat: Array<{ item: TocItem; index: number }> = [];
    let searchMark: string | null = null;
    const CFI = new (ePub as any).CFI();

    const chapterAt = (spineIndex: number): string | undefined => {
      let best: TocItem | undefined;
      for (const e of tocFlat) {
        if (e.index <= spineIndex) best = e.item;
        else break;
      }
      return best?.label;
    };

    const fail = (code: ErrorCode) => {
      if (!disposed) P.current.onError(code);
    };

    (async () => {
      try {
        book = (ePub as any)(P.current.data);
        bookRef.current = book;
        await book.ready;
        if (disposed) return;
        spineLen = Math.max(1, book.spine?.length ?? book.spine?.spineItems?.length ?? 1);

        const nav = await book.loaded.navigation.catch(() => ({ toc: [] }));
        const toc = convertToc(nav?.toc ?? []);
        tocFlat = flatten(toc)
          .map((item) => ({ item, index: book.spine.get(stripHash(item.href))?.index ?? -1 }))
          .filter((e) => e.index >= 0)
          .sort((a, b) => a.index - b.index);

        const isScroll = P.current.settings.readingMode === 'scroll';
        rendition = book.renderTo(host, {
          width: host.clientWidth || '100%',
          height: host.clientHeight || '100%',
          flow: isScroll ? 'scrolled' : 'paginated',
          manager: isScroll ? 'continuous' : 'default',
          spread: 'none',
          minSpreadWidth: 100000,
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;
        if (P.current.rtl) {
          try {
            rendition.direction('rtl');
          } catch {
            /* older builds */
          }
        }

        /* ----- per-chapter document hooks ----- */
        rendition.hooks.content.register((contents: any) => {
          try {
            contents.addStylesheetCss(collectFontFaceCss(), 'margins-fonts');
            contents.addStylesheetCss(cssRef.current || buildCss(), 'margins-user');
          } catch {
            /* styling is best effort */
          }
          const doc: Document = contents.document;
          const win = contents.window as Window;
          const frame = win.frameElement as HTMLElement | null;

          // Links: let epub.js handle internal ones, route external ones to the system browser.
          doc.addEventListener(
            'click',
            (e) => {
              const a = (e.target as Element | null)?.closest?.('a');
              const href = a?.getAttribute('href') ?? '';
              if (a && /^(https?:|mailto:|tel:)/i.test(href)) {
                e.preventDefault();
                e.stopPropagation();
                P.current.onExternalLink(href);
              }
            },
            true
          );

          // Taps: left/right thirds turn the page (paged mode), centre toggles the toolbar.
          doc.addEventListener('click', (e) => {
            const target = e.target as Element | null;
            if (target?.closest?.('a')) return;
            if (win.getSelection()?.toString()) return;
            const rect = frame?.getBoundingClientRect();
            const x = (rect?.left ?? 0) + e.clientX;
            const w = window.innerWidth;
            const paged = P.current.settings.readingMode === 'paged';
            if (!paged) return P.current.onToggleUi();
            const r = x / w;
            if (r < 0.28) (P.current.rtl ? api.next : api.prev)();
            else if (r > 0.72) (P.current.rtl ? api.prev : api.next)();
            else P.current.onToggleUi();
          });

          // Swipe to turn pages (paged mode only).
          let sx = 0;
          let sy = 0;
          let multi = false;
          doc.addEventListener(
            'touchstart',
            (e) => {
              multi = e.touches.length > 1;
              sx = e.changedTouches[0].clientX;
              sy = e.changedTouches[0].clientY;
            },
            { passive: true }
          );
          doc.addEventListener(
            'touchend',
            (e) => {
              if (multi || P.current.settings.readingMode !== 'paged') return;
              if (win.getSelection()?.toString()) return;
              const dx = e.changedTouches[0].clientX - sx;
              const dy = e.changedTouches[0].clientY - sy;
              if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.6) {
                const forward = P.current.rtl ? dx > 0 : dx < 0;
                forward ? api.next() : api.prev();
              }
            },
            { passive: true }
          );

          doc.addEventListener('selectionchange', () => {
            if (!win.getSelection()?.toString()) P.current.onSelect(null);
          });

          // Keyboard inside the book iframe is forwarded to the host window.
          doc.addEventListener('keydown', (e) => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, bubbles: true }));
          });
        });

        /* ----- selection ----- */
        rendition.on('selected', (cfiRange: string, contents: any) => {
          const text = contents.window.getSelection()?.toString().trim() ?? '';
          if (!text) return;
          selContents.current = contents;
          P.current.onSelect({ cfiRange, text });
        });
        rendition.on('markClicked', () => undefined);

        /* ----- position tracking ----- */
        const emit = debounce((loc: any) => {
          if (disposed || !loc?.start) return;
          const start = loc.start;
          const end = loc.end;
          let pct: number;
          if (locationsReady) {
            pct = book.locations.percentageFromCfi(start.cfi);
          } else {
            const total = start.displayed?.total || 1;
            const page = start.displayed?.page || 1;
            pct = (start.index + (page - 1) / total) / spineLen;
          }
          if (!Number.isFinite(pct)) pct = 0;
          if (loc.atEnd) pct = Math.max(pct, 0.995);
          lastCfi.current = start.cfi;
          P.current.onPosition({
            location: start.cfi,
            start: start.cfi,
            end: end?.cfi ?? start.cfi,
            percentage: Math.min(1, Math.max(0, pct)),
            chapter: chapterAt(start.index),
            atEnd: !!loc.atEnd,
          });
        }, 120);
        rendition.on('relocated', (loc: any) => emit(loc));

        /* ----- annotations: tapping a highlight ----- */
        syncHighlights();

        /* ----- first display ----- */
        try {
          await rendition.display(lastCfi.current ?? undefined);
        } catch {
          await rendition.display();
        }
        if (disposed) return;
        setLoading(false);

        ro = new ResizeObserver(
          debounce(() => {
            if (!renditionRef.current || !host.clientWidth) return;
            try {
              renditionRef.current.resize(host.clientWidth, host.clientHeight);
            } catch {
              /* ignore */
            }
          }, 140)
        );
        ro.observe(host);

        P.current.onReady({ toc, api });

        /* ----- background: reading-progress locations ----- */
        (async () => {
          try {
            const cached = await kvGet<string>(`loc:${P.current.bookId}`);
            if (cached) book.locations.load(cached);
            else {
              await book.locations.generate(1600);
              void kvSet(`loc:${P.current.bookId}`, book.locations.save()).catch(() => undefined);
            }
            if (disposed) return;
            locationsReady = true;
            if (rendition.location) emit(rendition.location);
          } catch {
            /* the spine-based estimate keeps working */
          }
        })();
      } catch (e) {
        fail('corruptEpub');
      }
    })();

    /* ---------- API ---------- */
    const api: ReaderApi = {
      next: () => void rendition?.next?.(),
      prev: () => void rendition?.prev?.(),
      nextSection: () => {
        const idx = rendition?.location?.start?.index ?? 0;
        const sec = book?.spine?.get(Math.min(spineLen - 1, idx + 1));
        if (sec) void rendition.display(sec.href);
      },
      prevSection: () => {
        const idx = rendition?.location?.start?.index ?? 0;
        const sec = book?.spine?.get(Math.max(0, idx - 1));
        if (sec) void rendition.display(sec.href);
      },
      goToLocation: (loc, focus) => {
        const r = rendition;
        if (!r?.display) return;
        void r
          .display(loc)
          .then(() => {
            if (!focus?.cfiRange) return;
            const cfi = focus.cfiRange;
            // scrolled reading: bring the passage to the middle of the screen (paginated pages show it as it is)
            setTimeout(() => {
              try {
                if (P.current.settings.readingMode !== 'scroll') return;
                const range = r.getRange?.(cfi);
                const frame = range?.startContainer?.ownerDocument?.defaultView?.frameElement as HTMLElement | null;
                const box = r.manager?.container as HTMLElement | undefined;
                if (!range || !frame || !box) return;
                const q = range.getBoundingClientRect();
                const f = frame.getBoundingClientRect();
                const b = box.getBoundingClientRect();
                box.scrollBy({ top: f.top + q.top + q.height / 2 - (b.top + b.height / 2), behavior: 'smooth' });
              } catch {
                /* the passage simply stays where epub.js put it */
              }
            }, 250);
            // two soft pulses over the passage
            const on = () => {
              try {
                r.annotations.highlight(cfi, {}, undefined, 'margins-flash', { fill: focus.color, 'fill-opacity': '0.5', 'mix-blend-mode': 'normal' });
              } catch {
                /* ignore */
              }
            };
            const off = () => {
              try {
                r.annotations.remove(cfi, 'highlight');
              } catch {
                /* ignore */
              }
              syncHighlights();
            };
            setTimeout(on, 500);
            setTimeout(off, 950);
            setTimeout(on, 1150);
            setTimeout(off, 1800);
          })
          .catch(() => undefined);
      },
      goToToc: (item) => item.href && void rendition?.display?.(item.href).catch(() => undefined),
      goToPercent: (p) => {
        if (!rendition || !book) return;
        if (locationsReady) {
          const cfi = book.locations.cfiFromPercentage(Math.min(0.9999, Math.max(0, p)));
          if (cfi) void rendition.display(cfi).catch(() => undefined);
        } else {
          const idx = Math.min(spineLen - 1, Math.floor(p * spineLen));
          const sec = book.spine.get(idx);
          if (sec) void rendition.display(sec.href).catch(() => undefined);
        }
      },
      goToHit: (hit) => {
        if (!rendition) return;
        void rendition.display(hit.location).catch(() => undefined);
        try {
          if (searchMark) rendition.annotations.remove(searchMark, 'highlight');
          searchMark = hit.location;
          rendition.annotations.highlight(hit.location, {}, undefined, 'margins-hit', { fill: '#d2a95f', 'fill-opacity': '0.45', 'mix-blend-mode': 'normal' });
          const mark = searchMark;
          setTimeout(() => {
            if (searchMark === mark && !disposed) {
              try {
                rendition.annotations.remove(mark, 'highlight');
              } catch {
                /* ignore */
              }
              searchMark = null;
            }
          }, 5000);
        } catch {
          /* highlight is a nicety */
        }
      },
      async search(query, onHit, cancel) {
        const q = query.trim();
        if (!q || !book) return { hasText: true };
        let n = 0;
        for (const item of [...(book.spine.spineItems as any[])]) {
          if (cancel.cancelled || disposed) break;
          try {
            await item.load(book.load.bind(book));
            const found: Array<{ cfi: string; excerpt: string }> = item.find(q) ?? [];
            const label = chapterAt(item.index);
            for (const r of found) {
              if (n >= 300) break;
              onHit({ id: `${item.index}:${n++}`, location: r.cfi, excerpt: r.excerpt, label } as SearchHit);
            }
          } catch {
            /* skip unreadable section */
          } finally {
            try {
              item.unload();
            } catch {
              /* ignore */
            }
          }
          if (n >= 300) break;
          await sleep(0);
        }
        return { hasText: true };
      },
    };

    /* ---------- highlights ---------- */
    function syncHighlights() {
      const r = renditionRef.current;
      if (!r) return;
      const want = new Map<string, AnnotationRecord>();
      for (const a of P.current.annotations) if (a.type === 'highlight' && a.cfiRange) want.set(a.id, a);
      for (const [id, cur] of appliedHl.current) {
        const w = want.get(id);
        if (!w || w.cfiRange !== cur.cfiRange || (w.color ?? 'gold') !== cur.color) {
          try {
            r.annotations.remove(cur.cfiRange, 'highlight');
          } catch {
            /* ignore */
          }
          appliedHl.current.delete(id);
        }
      }
      for (const [id, a] of want) {
        if (appliedHl.current.has(id)) continue;
        const color = a.color ?? 'gold';
        const fill = HIGHLIGHT_COLORS[color]?.fill ?? '#D2A95F';
        try {
          r.annotations.highlight(a.cfiRange!, { id }, () => P.current.onHighlightClick(id), 'margins-hl', {
            fill,
            'fill-opacity': P.current.theme === 'dark' ? '0.42' : '0.38',
            'mix-blend-mode': P.current.theme === 'dark' ? 'normal' : 'multiply',
          });
          appliedHl.current.set(id, { cfiRange: a.cfiRange!, color });
        } catch {
          /* invalid range — skip */
        }
      }
    }
    /* word bookmarks: small dotted underline + a soft tint of the passage, both in the bookmark's own colour */
    function syncBookmarks() {
      const r = renditionRef.current;
      if (!r) return;
      const theme = P.current.theme;
      const colorOf = (a: AnnotationRecord) => resolveMarkColor(a.markColor, P.current.settings.markColor, theme);
      const hlRanges = new Set<string>();
      for (const a of P.current.annotations) if (a.type === 'highlight' && a.cfiRange) hlRanges.add(a.cfiRange);
      const want = new Map<string, AnnotationRecord>();
      for (const a of P.current.annotations) if (a.type === 'bookmark' && a.cfiRange) want.set(a.id, a);
      const drop = (cur: { cfiRange: string; fill: boolean }) => {
        try {
          r.annotations.remove(cur.cfiRange, 'underline');
          if (cur.fill) r.annotations.remove(cur.cfiRange, 'highlight');
        } catch {
          /* ignore */
        }
      };
      for (const [id, cur] of appliedBm.current) {
        const w = want.get(id);
        if (!w || w.cfiRange !== cur.cfiRange || cur.color !== colorOf(w) + theme) {
          drop(cur);
          appliedBm.current.delete(id);
        }
      }
      for (const [id, a] of want) {
        if (appliedBm.current.has(id)) continue;
        const color = colorOf(a);
        let fill = false;
        try {
          r.annotations.underline(a.cfiRange!, { id }, undefined, 'margins-bm', {
            stroke: color,
            'stroke-opacity': '0.95',
            'stroke-width': '2.2',
            'stroke-dasharray': '0.5 4',
            'stroke-linecap': 'round',
            'mix-blend-mode': 'normal',
          });
          // a highlight the reader drew on the very same words keeps priority (epub.js keys marks by range + type)
          if (!hlRanges.has(a.cfiRange!)) {
            r.annotations.highlight(a.cfiRange!, { id }, undefined, 'margins-bm-fill', {
              fill: color,
              'fill-opacity': theme === 'dark' ? '0.3' : '0.22',
              'mix-blend-mode': theme === 'dark' ? 'normal' : 'multiply',
            });
            fill = true;
          }
          appliedBm.current.set(id, { cfiRange: a.cfiRange!, color: color + theme, fill });
        } catch {
          /* invalid range — skip */
        }
      }
    }
    const syncAll = () => {
      syncHighlights();
      syncBookmarks();
    };
    syncRef.current = syncAll;

    P.current.registerClearSelection(() => {
      try {
        selContents.current?.window?.getSelection()?.removeAllRanges();
      } catch {
        /* ignore */
      }
      selContents.current = null;
    });

    return () => {
      disposed = true;
      try {
        ro?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        rendition?.destroy();
      } catch {
        /* ignore */
      }
      try {
        book?.destroy();
      } catch {
        /* ignore */
      }
      renditionRef.current = null;
      bookRef.current = null;
      syncRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bookId, props.data, scroll]);

  /* ---------- live typography / theme updates ---------- */
  const applyKey = [settings.font, settings.fontSize, settings.lineHeight, settings.paragraphSpacing, settings.textAlign, theme, rtl].join('|');
  useEffect(() => {
    const r = renditionRef.current;
    if (!r) return;
    const apply = () => {
      const css = buildCss();
      cssRef.current = css;
      try {
        r.getContents().forEach((c: any) => c.addStylesheetCss(css, 'margins-user'));
        const host = hostRef.current;
        if (host) r.resize(host.clientWidth, host.clientHeight);
      } catch {
        /* ignore */
      }
    };
    const id = setTimeout(apply, 90);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyKey]);

  // Margins / max width change the host box → the ResizeObserver handles the reflow.

  /* ---------- annotations ---------- */
  useEffect(() => {
    syncRef.current?.();
  }, [props.annotations, theme, settings.markColor]);

  const wrapStyle = {
    paddingInline: `max(${settings.margin}px, var(--safe-l))`,
    paddingTop: 'calc(var(--safe-t) + 18px)',
    paddingBottom: 'calc(var(--safe-b) + 36px)',
  } as const;

  return (
    <div className="epub-wrap" style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', ...wrapStyle }}>
      <div ref={hostRef} className="epub-host" style={{ position: 'relative', inset: 'auto', width: '100%', maxWidth: scroll ? settings.maxWidth : Math.max(settings.maxWidth, 560), height: '100%' }} dir="ltr" />
      {loading && (
        <div className="reader-state" style={{ zIndex: 6 }}>
          <div className="spinner" />
          <p>{t('reader.opening')}</p>
        </div>
      )}
    </div>
  );
}
