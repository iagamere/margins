import type { BookRecord } from '../lib/types';
import { useT } from '../lib/i18n';
import { BookCover } from './BookCover';

export function BookCard({ book, onOpen }: { book: BookRecord; onOpen: () => void }) {
  const { t, n } = useT();
  const pct = Math.round(book.percentage * 100);
  const started = book.percentage > 0 || book.lastOpenedAt;
  return (
    <button className="card" onClick={onOpen} aria-label={book.title}>
      <BookCover book={book} showFormat />
      <div className="meta">
        <div className="title clamp2" dir="auto">{book.title}</div>
        {book.author && <div className="author clamp1" dir="auto">{book.author}</div>}
        {book.finished ? (
          <div className="prog">{t('book.finished')}</div>
        ) : started ? (
          <div className="prog">
            <div className="bar"><i style={{ width: `${pct}%` }} /></div>
            <span>{n(pct)}%</span>
          </div>
        ) : null}
      </div>
    </button>
  );
}

export function BookRow({ book, onOpen }: { book: BookRecord; onOpen: () => void }) {
  const { t, n } = useT();
  const pct = Math.round(book.percentage * 100);
  return (
    <button className="list-item" onClick={onOpen} aria-label={book.title}>
      <BookCover book={book} />
      <div className="meta">
        <div className="title clamp2" dir="auto">{book.title}</div>
        {book.author && <div className="author clamp1" dir="auto">{book.author}</div>}
        <div className="prog">
          <span>{book.format.toUpperCase()}</span>
          {book.finished ? <span>· {t('book.finished')}</span> : book.percentage > 0 ? (<><div className="bar"><i style={{ width: `${pct}%` }} /></div><span>{n(pct)}%</span></>) : <span>· {t('book.notStarted')}</span>}
        </div>
      </div>
    </button>
  );
}
