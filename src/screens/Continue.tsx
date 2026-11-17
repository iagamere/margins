import { useMemo } from 'react';
import { BookOpen } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { BookCover } from '../components/BookCover';
import { BookCard } from '../components/BookCard';
import { formatDate, percentLabel } from '../lib/utils';

export function ContinueScreen() {
  const { t, lang, n } = useT();
  const books = useApp((s) => s.books);
  const navigate = useApp((s) => s.navigate);

  const recent = useMemo(() => books.filter((b) => b.lastOpenedAt).sort((a, b) => b.lastOpenedAt! - a.lastOpenedAt!), [books]);
  const [hero, ...rest] = recent;
  const inProgress = recent.filter((b) => !b.finished);
  const heroBook = inProgress[0] ?? hero;
  const others = recent.filter((b) => b.id !== heroBook?.id);
  void rest;

  return (
    <div className="screen">
      <div className="screen-pad">
        <header className="page-head">
          <div className="top">
            <h1 className="h-display">{t('nav.continue')}</h1>
          </div>
        </header>
        {!heroBook ? (
          <div className="empty">
            <BookOpen className="glyph" size={44} strokeWidth={1.3} aria-hidden="true" />
            <h2 className="h-section">{t('continue.emptyTitle')}</h2>
            <p>{t('continue.emptyBody')}</p>
            <button className="btn btn-primary" onClick={() => navigate({ name: 'library' }, { replace: true })}>
              {t('nav.library')}
            </button>
          </div>
        ) : (
          <>
            <button className="continue-hero" onClick={() => navigate({ name: 'reader', id: heroBook.id })}>
              <BookCover book={heroBook} big />
              <div className="info">
                <span className="eyebrow">{t('continue.last')}</span>
                <div className="h-section clamp2" dir="auto">{heroBook.title}</div>
                {heroBook.author && <div className="muted clamp1" dir="auto">{heroBook.author}</div>}
                <div className="row" style={{ marginTop: 6 }}>
                  <div className="bar" style={{ flex: 1 }}><i style={{ width: percentLabel(heroBook.percentage) }} /></div>
                  <span className="muted" style={{ fontSize: 13 }}>{n(Math.round(heroBook.percentage * 100))}%</span>
                </div>
                {heroBook.lastOpenedAt && <span className="muted" style={{ fontSize: 12.5 }}>{formatDate(heroBook.lastOpenedAt, lang)}</span>}
                <span className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start', marginTop: 6 }}>{t('book.continue')}</span>
              </div>
            </button>
            {others.length > 0 && (
              <>
                <h2 className="h-section section-title" style={{ marginTop: 32 }}>{t('continue.recent')}</h2>
                <div className="grid">
                  {others.map((b) => (
                    <BookCard key={b.id} book={b} onOpen={() => navigate({ name: 'details', id: b.id })} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
