import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowDownUp, ArrowLeft, ArrowUp, BookCheck, BookPlus, ClipboardPaste, Copy, FolderInput, FolderPlus, LayoutGrid, Library as ShelfIcon, List, Pencil, Plus, Scissors, Search, Trash2, X } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import type { BookRecord, LibraryFilter, LibrarySort } from '../lib/types';
import { BookCard, BookRow } from '../components/BookCard';
import { FilePicker, type FilePickerHandle } from '../components/FilePicker';
import { LogoMark } from '../components/Logo';
import { Sheet } from '../components/Sheet';
import { ShelfDialog, ShelfImage } from '../components/ShelfDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ShelfSheet } from '../components/ShelfSheet';
import { pushBackHandler } from '../lib/backStack';

const FILTERS: LibraryFilter[] = ['all', 'reading', 'completed', 'recent'];
const SORTS: LibrarySort[] = ['opened', 'added', 'title', 'author', 'progress'];
const THIRTY_DAYS = 30 * 24 * 3600 * 1000;

export function EmptyLibrary({ onAdd }: { onAdd: () => void }) {
  const { t } = useT();
  return (
    <div className="empty">
      <BookPlus className="glyph" size={44} strokeWidth={1.3} aria-hidden="true" />
      <h2 className="h-section">{t('empty.title')}</h2>
      <p>{t('empty.body')}</p>
      <button className="btn btn-primary" onClick={onAdd}>
        <Plus size={20} aria-hidden="true" />
        {t('library.add')}
      </button>
      <p className="dropzone-note">{t('empty.drop')}</p>
      <p style={{ fontSize: 13 }}>{t('storage.localNote')}</p>
    </div>
  );
}

export function LibraryScreen() {
  const { t, n, lang } = useT();
  const books = useApp((s) => s.books);
  const shelves = useApp((s) => s.shelves);
  const openShelf = useApp((s) => s.openShelf);
  const setOpenShelf = useApp((s) => s.setOpenShelf);
  const createShelf = useApp((s) => s.createShelf);
  const updateShelf = useApp((s) => s.updateShelf);
  const deleteShelf = useApp((s) => s.deleteShelf);
  const toast = useApp((s) => s.toast);
  const loaded = useApp((s) => s.booksLoaded);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const navigate = useApp((s) => s.navigate);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const [sortOpen, setSortOpen] = useState(false);
  const [dialog, setDialog] = useState<null | 'new' | 'rename' | 'delete' | 'moveSel' | 'newForSel' | 'deleteSel'>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const clipboard = useApp((s) => s.clipboard);
  const setClipboard = useApp((s) => s.setClipboard);
  const moveBooks = useApp((s) => s.moveBooks);
  const removeBooks = useApp((s) => s.removeBooks);
  const pasteClipboard = useApp((s) => s.pasteClipboard);
  const updateBook = useApp((s) => s.updateBook);
  const selecting = sel.size > 0;
  const picker = useRef<FilePickerHandle>(null);

  const shelf = shelves.find((x) => x.id === openShelf) ?? null;
  // A shelf that no longer exists (deleted) must not leave the library stuck on it.
  useEffect(() => {
    if (openShelf && loaded && !shelf) setOpenShelf(null);
  }, [openShelf, loaded, shelf, setOpenShelf]);
  // Android back / Esc leaves the shelf first.
  useEffect(() => {
    if (!shelf) return;
    return pushBackHandler(() => setOpenShelf(null));
  }, [shelf?.id, setOpenShelf]);

  // Leaving the place the selection was made in (other shelf, filter, search) drops it.
  useEffect(() => setSel(new Set()), [openShelf, filter, query]);
  // Android back / Esc cancels the selection before anything else.
  useEffect(() => {
    if (!selecting) return;
    return pushBackHandler(() => setSel(new Set()));
  }, [selecting]);

  const flat = filter !== 'all' || query.trim() !== '';
  const showTiles = !shelf && !flat && shelves.length > 0;
  const sortedShelves = useMemo(() => {
    const coll = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
    return [...shelves].sort((a, b) => coll.compare(a.name, b.name));
  }, [shelves, lang]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = books.filter((b) => {
      // On the library root, books that sit on a shelf live inside it; searching or filtering looks everywhere.
      if (shelf) {
        if (b.shelfId !== shelf.id) return false;
      } else if (!flat && b.shelfId) return false;
      if (q && !(b.title.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q))) return false;
      if (filter === 'reading') return b.percentage > 0 && !b.finished;
      if (filter === 'completed') return b.finished;
      if (filter === 'recent') return Date.now() - b.addedAt < THIRTY_DAYS;
      return true;
    });
    const coll = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
    const sort = filter === 'recent' ? 'added' : settings.librarySort;
    const sign = settings.libraryReverse ? -1 : 1;
    list = [...list].sort((a: BookRecord, b: BookRecord) => {
      switch (sort) {
        case 'title': return sign * coll.compare(a.title, b.title);
        case 'author': {
          // books without an author always stay at the end, whatever the direction
          if (!a.author || !b.author) return !a.author && !b.author ? 0 : !a.author ? 1 : -1;
          return sign * coll.compare(a.author, b.author);
        }
        case 'progress': return sign * (b.percentage - a.percentage);
        case 'added': return sign * (b.addedAt - a.addedAt);
        default: return sign * ((b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt);
      }
    });
    return list;
  }, [books, filter, query, settings.librarySort, settings.libraryReverse, lang, shelf, flat]);

  const activeSort = filter === 'recent' ? 'added' : settings.librarySort;
  const dirKey = (sort: LibrarySort, rev: boolean) => `dir.${sort}.${rev ? 'rev' : 'def'}`;
  const flipOrder = () => {
    const rev = !settings.libraryReverse;
    setSettings({ libraryReverse: rev });
    toast(dirKey(activeSort, rev), 'info');
  };
  const toggle = (id: string) =>
    setSel((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clear = () => setSel(new Set());
  const ids = [...sel];
  const allSelected = shown.length > 0 && shown.every((b) => sel.has(b.id));
  const selBooks = books.filter((b) => sel.has(b.id));
  const allRead = selBooks.length > 0 && selBooks.every((b) => b.finished);
  const countOf = (id: string) => books.filter((b) => b.shelfId === id).length;

  const open = (b: BookRecord) => navigate({ name: 'details', id: b.id });
  const pressProps = (b: BookRecord) => ({
    selecting,
    selected: sel.has(b.id),
    onLongPress: () => toggle(b.id),
    onOpen: () => (selecting ? toggle(b.id) : open(b)),
  });
  const moveSelTo = (shelfId: string | undefined, name: string) => {
    moveBooks(ids, shelfId);
    toast(shelfId ? 'select.movedTo' : 'select.movedOut', 'info', { count: ids.length, name });
    clear();
  };

  return (
    <div className="screen">
      <div className="screen-pad">
        <FilePicker ref={picker} shelfId={shelf?.id} />
        <header className="page-head">
          {shelf ? (
            <div style={{ marginInline: -10, marginBottom: -6 }}>
              <button className="icon-btn" onClick={() => setOpenShelf(null)} aria-label={t('common.back')}>
                <ArrowLeft className="flip" size={22} />
              </button>
            </div>
          ) : (
            <div className="brand mobile-brand" aria-hidden="true">
              <LogoMark />
              <span>Margins</span>
            </div>
          )}
          <div className="top">
            <h1 className={'h-display' + ((shelf ? shelf.name : t('nav.library')).length > 9 ? ' long' : '')} dir="auto">
              {shelf?.color && <i className="shelf-dot big" style={{ background: shelf.color }} aria-hidden="true" />}
              {shelf ? shelf.name : t('nav.library')}
            </h1>
            <div className="row top-actions">
              {!shelf && (books.length > 0 || shelves.length > 0) && (
                <button className="icon-btn" onClick={() => setDialog('new')} aria-label={t('shelf.new')} title={t('shelf.new')}>
                  <FolderPlus size={21} />
                </button>
              )}
              {(books.length > 0 || shelf) && (
                <button className="btn btn-sm" onClick={() => picker.current?.open()}>
                  <Plus size={18} aria-hidden="true" />
                  {t('library.add')}
                </button>
              )}
            </div>
          </div>
          {shelf && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setDialog('rename')}>
                <Pencil size={16} aria-hidden="true" />
                {t('shelf.edit')}
              </button>
              <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setDialog('delete')}>
                <Trash2 size={16} aria-hidden="true" />
                {t('shelf.delete')}
              </button>
            </div>
          )}
        </header>

        {loaded && books.length === 0 && shelves.length === 0 ? (
          <EmptyLibrary onAdd={() => picker.current?.open()} />
        ) : (
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
                <button className="icon-btn" onClick={() => setSortOpen(true)} aria-label={t('library.sort')}>
                  <ArrowDownUp size={21} />
                </button>
                <button className="icon-btn" onClick={flipOrder} aria-label={t('library.reverse')} title={t(dirKey(activeSort, settings.libraryReverse))}>
                  {settings.libraryReverse ? <ArrowUp size={21} /> : <ArrowDown size={21} />}
                </button>
                <button className="icon-btn" onClick={() => setSettings({ libraryView: settings.libraryView === 'grid' ? 'list' : 'grid' })} aria-label={settings.libraryView === 'grid' ? t('library.listView') : t('library.gridView')}>
                  {settings.libraryView === 'grid' ? <List size={21} /> : <LayoutGrid size={21} />}
                </button>
              </div>
              <div className="chips" role="group" aria-label={t('library.filter')}>
                {FILTERS.map((f) => (
                  <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {t(`filter.${f}`)}
                  </button>
                ))}
              </div>
            </div>

            {showTiles && (
              <>
                <h2 className="eyebrow section-title" style={{ marginBottom: 0 }}>{t('shelf.section')}</h2>
                <div className="shelves">
                  {sortedShelves.map((x) => {
                    const c = countOf(x.id);
                    return (
                      <button
                        key={x.id}
                        className={'shelf-tile' + (x.color ? ' tinted' : '') + (x.image ? ' has-img' : '')}
                        style={{ ...(x.color ? { ['--shelf' as string]: x.color } : null), ...(x.image ? { aspectRatio: x.ratio === '1:1' ? '1 / 1' : '2 / 3' } : null) }}
                        onClick={() => !selecting && setOpenShelf(x.id)}
                        aria-label={x.name}
                      >
                        {x.image ? <ShelfImage blob={x.image} /> : <ShelfIcon size={26} strokeWidth={1.4} aria-hidden="true" />}
                        <div className="name clamp2" dir="auto">{x.name}</div>
                        <div className="count">{c === 1 ? t('shelf.one') : t('shelf.count', { count: n(c) })}</div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {shown.length === 0 ? (
              showTiles ? null : (
                <div className="empty">
                  <p>{query ? t('library.noMatch') : shelf ? t('shelf.empty') : t('library.noneHere')}</p>
                </div>
              )
            ) : settings.libraryView === 'grid' ? (
              <div className="grid" style={{ marginTop: showTiles ? 24 : 16 }}>
                {shown.map((b) => (
                  <BookCard key={b.id} book={b} {...pressProps(b)} />
                ))}
              </div>
            ) : (
              <div className="list" style={{ marginTop: 8 }}>
                {shown.map((b) => (
                  <BookRow key={b.id} book={b} {...pressProps(b)} />
                ))}
              </div>
            )}
            <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 32 }}>{t('storage.localNote')}</p>
          </>
        )}
      </div>

      {selecting && (
        <>
          <div className="sel-bar" role="toolbar">
            <button className="icon-btn" onClick={clear} aria-label={t('select.close')}><X size={22} /></button>
            <span className="count">{t('select.count', { count: n(sel.size) })}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setSel(allSelected ? new Set() : new Set(shown.map((b) => b.id)))}>
              {allSelected ? t('select.none') : t('select.all')}
            </button>
          </div>
          <div className="sel-actions" role="toolbar">
            <button onClick={() => setDialog('moveSel')}><FolderInput size={22} /><span>{t('select.move')}</span></button>
            <button onClick={() => { setClipboard({ mode: 'cut', ids }); clear(); }}><Scissors size={22} /><span>{t('select.cut')}</span></button>
            <button onClick={() => { setClipboard({ mode: 'copy', ids }); clear(); }}><Copy size={22} /><span>{t('select.copy')}</span></button>
            <button onClick={() => { for (const id of ids) updateBook(id, { finished: !allRead }); clear(); }}><BookCheck size={22} /><span>{allRead ? t('select.unread') : t('select.read')}</span></button>
            <button className="danger" onClick={() => setDialog('deleteSel')}><Trash2 size={22} /><span>{t('select.delete')}</span></button>
          </div>
        </>
      )}

      {clipboard && !selecting && (
        <div className="paste-bar" role="status">
          <span>{t(clipboard.mode === 'cut' ? 'clip.cut' : 'clip.copy', { count: n(clipboard.ids.length) })}</span>
          <button className="btn btn-primary btn-sm" onClick={() => void pasteClipboard(shelf?.id)}>
            <ClipboardPaste size={17} aria-hidden="true" />
            {t('clip.paste')}
          </button>
          <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => setClipboard(null)} aria-label={t('clip.discard')}><X size={18} /></button>
        </div>
      )}

      {dialog === 'moveSel' && (
        <ShelfSheet
          current={false}
          onClose={() => setDialog(null)}
          onNew={() => setDialog('newForSel')}
          onPick={(id) => {
            setDialog(null);
            moveSelTo(id, shelves.find((x) => x.id === id)?.name ?? '');
          }}
        />
      )}
      {dialog === 'newForSel' && (
        <ShelfDialog
          title={t('shelf.newTitle')}
          confirmLabel={t('shelf.create')}
          onCancel={() => setDialog(null)}
          onSubmit={({ name, ...style }) => {
            setDialog(null);
            moveSelTo(createShelf(name, style), name);
          }}
        />
      )}
      {dialog === 'deleteSel' && (
        <ConfirmDialog
          title={ids.length === 1 ? t('details.removeTitle') : t('select.deleteTitle', { count: n(ids.length) })}
          body={t('details.removeBody')}
          confirmLabel={t('select.delete')}
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            const del = ids;
            clear();
            void removeBooks(del);
          }}
        />
      )}

      {sortOpen && (
        <Sheet title={t('library.sort')} onClose={() => setSortOpen(false)}>
          <div className="list">
            {SORTS.map((x) => {
              const on = settings.librarySort === x;
              return (
                <button
                  key={x}
                  className="toc-item"
                  style={{ minHeight: 52 }}
                  onClick={() => {
                    // Picking the current sort again reverses it; picking another starts from its natural order.
                    if (on) setSettings({ libraryReverse: !settings.libraryReverse });
                    else {
                      setSettings({ librarySort: x, libraryReverse: false });
                      setSortOpen(false);
                    }
                  }}
                >
                  <span style={{ fontWeight: on ? 600 : 400, color: on ? 'var(--accent-ink)' : undefined }}>{t(`sort.${x}`)}</span>
                  {on && (
                    <span className="sort-dir">
                      {t(dirKey(x, settings.libraryReverse))}
                      {settings.libraryReverse ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}

      {dialog === 'new' && (
        <ShelfDialog
          title={t('shelf.newTitle')}
          confirmLabel={t('shelf.create')}
          onCancel={() => setDialog(null)}
          onSubmit={({ name, ...style }) => {
            setDialog(null);
            setOpenShelf(createShelf(name, style));
          }}
        />
      )}
      {dialog === 'rename' && shelf && (
        <ShelfDialog
          title={t('shelf.editTitle')}
          initial={{ name: shelf.name, color: shelf.color, image: shelf.image, ratio: shelf.ratio, dynamic: shelf.dynamic }}
          confirmLabel={t('common.save')}
          onCancel={() => setDialog(null)}
          onSubmit={({ name, ...style }) => {
            setDialog(null);
            updateShelf(shelf.id, { name, ...style });
          }}
        />
      )}
      {dialog === 'delete' && shelf && (
        <ConfirmDialog
          title={t('shelf.delete')}
          body={t('shelf.deleteBody')}
          confirmLabel={t('common.delete')}
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            deleteShelf(shelf.id);
          }}
        />
      )}
    </div>
  );
}
