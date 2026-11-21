import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Download, LayoutGrid, LayoutList, List, RefreshCw, Search, WifiOff, X } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { cachedManifest, downloadShared, friendBlob, loadManifest, loadShare, refreshFriend, useShare, type ShareEntry, type ShareManifest } from '../lib/share';
import type { BookRecord, LibraryView, ShelfRecord } from '../lib/types';
import { BookCard, BookName, BookRow } from '../components/BookCard';
import { ShelfItem } from '../components/ShelfViews';
import { pushBackHandler } from '../lib/backStack';
import { formatBytes } from '../lib/utils';

const VIEWS: LibraryView[] = ['covers', 'cards', 'names'];
const VIEW_ICON = { covers: LayoutGrid, cards: LayoutList, names: List } as const;

/** A friend's shared library, drawn like mine: shelves, covers, search. Pick what you want and download it together. */
export function FriendScreen({ id }: { id: string }) {
  const { t, n, lang } = useT();
  const books = useApp((s) => s.books);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const toast = useApp((s) => s.toast);
  const back = useApp((s) => s.back);
  const navigate = useApp((s) => s.navigate);
  const friend = useShare((s) => s.friends.find((f) => f.id === id));
  const [m, setM] = useState<ShareManifest | null>(null);
  const [offline, setOffline] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [openShelf, setOpenShelf] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [prog, setProg] = useState<Record<string, number>>({});
  const [working, setWorking] = useState(false);
  const [covers, setCovers] = useState<Record<string, Blob>>({});
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  // 1) what this device already knows opens at once (also without internet); 2) the live copy replaces it
  const load = async (fresh: boolean) => {
    setLoading(true);
    setErr(null);
    await loadShare();
    const cached = await cachedManifest(id);
    if (cached && alive.current) setM(cached);
    try {
      const live = fresh ? await refreshFriend(id) : await loadManifest(id, true);
      if (alive.current) {
        setM(live);
        setOffline(false);
      }
    } catch (e) {
      if (!alive.current) return;
      if (cached) setOffline(true);
      else setErr((e as { message?: string })?.message || String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load(false);
  }, [id]);

  // covers and shelf pictures arrive a few at a time and are kept on the device
  useEffect(() => {
    if (!m) return;
    const ids = [...(m.shelves ?? []).map((s) => s.i), ...m.books.map((b) => b.cover)].filter((x): x is string => !!x);
    for (const fid of ids) {
      void friendBlob(fid).then((b) => {
        if (b && alive.current) setCovers((cur) => (cur[fid] ? cur : { ...cur, [fid]: b }));
      });
    }
  }, [m]);

  useEffect(() => setSel(new Set()), [openShelf, query]);
  useEffect(() => {
    if (!openShelf) return;
    return pushBackHandler(() => setOpenShelf(null));
  }, [openShelf]);
  const selecting = sel.size > 0;
  useEffect(() => {
    if (!selecting) return;
    return pushBackHandler(() => setSel(new Set()));
  }, [selecting]);

  const goBack = () => {
    if (openShelf) return setOpenShelf(null);
    if (!back()) navigate({ name: 'account' }, { replace: true });
  };

  const owned = useMemo(() => new Set(books.map((b) => b.hash)), [books]);
  const shelfRecs = useMemo(
    () =>
      (m?.shelves ?? []).map((s): ShelfRecord => ({ id: s.id, name: s.n, createdAt: 0, color: s.c, ratio: s.ratio, image: s.i ? covers[s.i] : undefined })),
    [m, covers],
  );
  const shelf = shelfRecs.find((s) => s.id === openShelf) ?? null;
  useEffect(() => {
    if (openShelf && m && !shelf) setOpenShelf(null);
  }, [openShelf, m, shelf]);

  const flat = query.trim() !== '';
  const showTiles = !shelf && !flat && shelfRecs.length > 0;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const coll = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
    return (m?.books ?? [])
      .filter((e) => {
        if (shelf) {
          if (e.sh !== shelf.id) return false;
        } else if (!flat && e.sh && shelfRecs.some((s) => s.id === e.sh)) return false;
        return !q || e.t.toLowerCase().includes(q) || (e.a ?? '').toLowerCase().includes(q);
      })
      .sort((a, b) => coll.compare(a.t, b.t));
  }, [m, shelf, flat, query, lang, shelfRecs]);
  const free = shown.filter((e) => !owned.has(e.h));
  const countOf = (sid: string) => (m?.books ?? []).filter((e) => e.sh === sid).length;

  const view = settings.libraryView;
  const nextOf = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length];
  const NextIcon = VIEW_ICON[nextOf];

  const toggle = (h: string) =>
    setSel((cur) => {
      const next = new Set(cur);
      if (next.has(h)) next.delete(h);
      else next.add(h);
      return next;
    });
  const picked = free.filter((e) => sel.has(e.h));
  const allSel = free.length > 0 && free.every((e) => sel.has(e.h));

  const run = async (entries: ShareEntry[]) => {
    if (!entries.length || working) return;
    setWorking(true);
    setSel(new Set());
    try {
      await downloadShared(entries, (h, p) =>
        setProg((cur) => {
          const next = { ...cur };
          if (p === null) delete next[h];
          else next[h] = p;
          return next;
        }),
      );
    } finally {
      setWorking(false);
    }
  };

  const toBook = (e: ShareEntry): BookRecord => ({
    id: 'friend:' + e.h,
    hash: e.h,
    format: e.f,
    title: e.t,
    author: e.a,
    fileName: e.fn || e.t,
    size: e.s,
    addedAt: 0,
    percentage: prog[e.h] ?? 0,
    finished: false,
    cover: e.cover ? covers[e.cover] : undefined,
    coverTrimmed: true,
    language: e.l,
    rtl: e.r,
    pages: e.p,
    shelfId: e.sh,
  });
  const pressProps = (e: ShareEntry) => {
    const have = owned.has(e.h);
    return {
      selecting: !have && !working,
      selected: sel.has(e.h),
      extra: have ? 'owned' : undefined,
      sub: have ? t('friends.owned') : `${e.f.toUpperCase()} · ${formatBytes(e.s)}`,
      onLongPress: () => !have && toggle(e.h),
      onOpen: () => (have ? toast('friends.owned', 'info') : toggle(e.h)),
    };
  };
  const title = shelf ? shelf.name : t('friends.of', { name: m?.name || friend?.name || t('friends.noName') });

  return (
    <div className="screen">
      <div className="screen-pad" style={{ paddingBottom: selecting ? 120 : 28 }}>
        <header className="page-head">
          <div style={{ marginInline: -10, marginBottom: -6 }}>
            <button className="icon-btn" onClick={goBack} aria-label={t('common.back')}>
              <ArrowLeft className="flip" size={22} />
            </button>
          </div>
          <div className="top">
            <h1 className={'h-display' + (title.length > 9 ? ' long' : '')} dir="auto">
              {shelf?.color && <i className="shelf-dot big" style={{ background: shelf.color }} aria-hidden="true" />}
              {title}
            </h1>
            <div className="row top-actions">
              <button className="icon-btn" disabled={loading || working} onClick={() => void load(true)} aria-label={t('friends.refresh')} title={t('friends.refresh')}>
                <RefreshCw size={21} className={loading ? 'spin' : undefined} />
              </button>
            </div>
          </div>
          {m && (
            <div className="hint muted" style={{ fontSize: 13 }}>
              {t('friends.books', { count: n(m.books.length) })} · {t('friends.updated', { date: new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(m.updated) })}
            </div>
          )}
        </header>

        {offline && (
          <div className="fr-note"><WifiOff size={16} aria-hidden="true" /> {t('friends.offline')}</div>
        )}
        {err && <p className="acc-error" dir="auto">{t('friends.fail', { msg: err })}</p>}

        {m && (
          <>
            <div className="sticky-tools">
              <div className="row tools-row" style={{ marginBottom: 10, gap: 6 }}>
                <label className="field">
                  <Search size={18} aria-hidden="true" />
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('library.search')} aria-label={t('library.search')} enterKeyHint="search" />
                  {query && (
                    <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => setQuery('')} aria-label={t('common.clear')}>
                      <X size={18} />
                    </button>
                  )}
                </label>
                <button className="icon-btn" onClick={() => { setSettings({ libraryView: nextOf }); toast(`view.${nextOf}.on`, 'info'); }} aria-label={t(`view.${nextOf}`)} title={t(`view.${nextOf}`)}>
                  <NextIcon size={21} />
                </button>
              </div>
              {free.length > 0 && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm btn-primary" disabled={working} onClick={() => void run(free)}>
                    <Download size={17} aria-hidden="true" />
                    {working ? t('friends.working', { count: n(Object.keys(prog).length) }) : t('friends.downloadAll', { count: n(free.length) })}
                  </button>
                </div>
              )}
            </div>

            {showTiles && (
              <>
                <h2 className="eyebrow section-title" style={{ marginBottom: 0 }}>{t('shelf.section')}</h2>
                <div className={view === 'covers' ? 'shelves' : view === 'cards' ? 'stack' : 'list'} style={view === 'covers' ? undefined : { marginTop: 12 }}>
                  {shelfRecs.map((x) => (
                    <ShelfItem key={x.id} shelf={x} view={view} count={countOf(x.id)} onOpen={() => setOpenShelf(x.id)} />
                  ))}
                </div>
              </>
            )}
            {shown.length === 0 ? (
              showTiles ? null : <div className="empty"><p>{query ? t('library.noMatch') : shelf ? t('shelf.empty') : t('friends.emptyLib')}</p></div>
            ) : view === 'covers' ? (
              <div className="grid" style={{ marginTop: showTiles ? 24 : 16 }}>
                {shown.map((e) => <BookCard key={e.h} book={toBook(e)} {...pressProps(e)} />)}
              </div>
            ) : view === 'cards' ? (
              <div className="stack" style={{ marginTop: showTiles ? 24 : 16 }}>
                {shown.map((e) => <BookRow key={e.h} book={toBook(e)} {...pressProps(e)} />)}
              </div>
            ) : (
              <div className="list" style={{ marginTop: showTiles ? 20 : 8 }}>
                {shown.map((e) => <BookName key={e.h} book={toBook(e)} {...pressProps(e)} />)}
              </div>
            )}
          </>
        )}
        {!m && loading && !err && <p className="hint muted" style={{ textAlign: 'center', marginTop: 40 }}>…</p>}
      </div>

      {selecting && (
        <>
          <div className="lib-sel-bar" role="toolbar">
            <button className="icon-btn" onClick={() => setSel(new Set())} aria-label={t('select.close')}><X size={22} /></button>
            <span className="count">{t('select.count', { count: n(picked.length) })}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setSel(allSel ? new Set() : new Set(free.map((e) => e.h)))}>
              {allSel ? t('select.none') : t('select.all')}
            </button>
          </div>
          <div className="sel-actions" role="toolbar">
            <button onClick={() => void run(picked)}><ArrowDown size={22} /><span>{t('friends.downloadSel', { count: n(picked.length) })}</span></button>
          </div>
        </>
      )}
    </div>
  );
}
