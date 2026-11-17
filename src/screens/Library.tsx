import { useMemo, useRef, useState } from 'react';
import { ArrowDownUp, BookPlus, LayoutGrid, List, Plus, Search, X } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import type { BookRecord, LibraryFilter, LibrarySort } from '../lib/types';
import { BookCard, BookRow } from '../components/BookCard';
import { FilePicker, type FilePickerHandle } from '../components/FilePicker';
import { LogoMark } from '../components/Logo';
import { Sheet } from '../components/Sheet';

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
  const { t, lang } = useT();
  const books = useApp((s) => s.books);
  const loaded = useApp((s) => s.booksLoaded);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const navigate = useApp((s) => s.navigate);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [query, setQuery] = useState('');
  const [sortOpen, setSortOpen] = useState(false);
  const picker = useRef<FilePickerHandle>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = books.filter((b) => {
      if (q && !(b.title.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q))) return false;
      if (filter === 'reading') return b.percentage > 0 && !b.finished;
      if (filter === 'completed') return b.finished;
      if (filter === 'recent') return Date.now() - b.addedAt < THIRTY_DAYS;
      return true;
    });
    const coll = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
    const sort = filter === 'recent' ? 'added' : settings.librarySort;
    list = [...list].sort((a: BookRecord, b: BookRecord) => {
      switch (sort) {
        case 'title': return coll.compare(a.title, b.title);
        case 'author': return coll.compare(a.author ?? '￿', b.author ?? '￿');
        case 'progress': return b.percentage - a.percentage;
        case 'added': return b.addedAt - a.addedAt;
        default: return (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt;
      }
    });
    return list;
  }, [books, filter, query, settings.librarySort, lang]);

  const open = (b: BookRecord) => navigate({ name: 'details', id: b.id });

  return (
    <div className="screen">
      <div className="screen-pad">
        <FilePicker ref={picker} />
        <header className="page-head">
          <div className="brand mobile-brand" aria-hidden="true">
            <LogoMark />
            <span>Margins</span>
          </div>
          <div className="top">
            <h1 className="h-display">{t('nav.library')}</h1>
            {books.length > 0 && (
              <button className="btn btn-sm" onClick={() => picker.current?.open()}>
                <Plus size={18} aria-hidden="true" />
                {t('library.add')}
              </button>
            )}
          </div>
        </header>

        {loaded && books.length === 0 ? (
          <EmptyLibrary onAdd={() => picker.current?.open()} />
        ) : (
          <>
            <div className="sticky-tools">
              <div className="row" style={{ marginBottom: 10 }}>
                <label className="field" style={{ flex: 1 }}>
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

            {shown.length === 0 ? (
              <div className="empty">
                <p>{query ? t('library.noMatch') : t('library.noneHere')}</p>
              </div>
            ) : settings.libraryView === 'grid' ? (
              <div className="grid" style={{ marginTop: 16 }}>
                {shown.map((b) => (
                  <BookCard key={b.id} book={b} onOpen={() => open(b)} />
                ))}
              </div>
            ) : (
              <div className="list" style={{ marginTop: 8 }}>
                {shown.map((b) => (
                  <BookRow key={b.id} book={b} onOpen={() => open(b)} />
                ))}
              </div>
            )}
            <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', marginTop: 32 }}>{t('storage.localNote')}</p>
          </>
        )}
      </div>

      {sortOpen && (
        <Sheet title={t('library.sort')} onClose={() => setSortOpen(false)}>
          <div className="list">
            {SORTS.map((s) => (
              <button
                key={s}
                className="toc-item"
                style={{ minHeight: 52 }}
                onClick={() => {
                  setSettings({ librarySort: s });
                  setSortOpen(false);
                }}
              >
                <span style={{ flex: 1, fontWeight: settings.librarySort === s ? 600 : 400, color: settings.librarySort === s ? 'var(--accent-ink)' : undefined }}>{t(`sort.${s}`)}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
