import { Check } from 'lucide-react';
import type { BookRecord } from '../lib/types';
import { useT } from '../lib/i18n';
import { BookCover } from './BookCover';
import { useLongPress } from './useLongPress';
import { CloudBadge } from './CloudBadge';

interface Props {
  book: BookRecord;
  onOpen: () => void;
  /** long-press: start / extend a selection */
  onLongPress?: () => void;
  /** a selection is in progress: show tick circles */
  selecting?: boolean;
  selected?: boolean;
  /** extra class (a friend's book you already own is dimmed) */
  extra?: string;
  /** replaces the "not started" line (cards view) */
  sub?: string;
}

function Mark({ selected }: { selected: boolean }) {
  return <span className={'sel-mark' + (selected ? ' on' : '')} aria-hidden="true">{selected && <Check size={15} strokeWidth={3} />}</span>;
}

export function BookCard({ book, onOpen, onLongPress, selecting, selected, extra }: Props) {
  const { t, n } = useT();
  const pct = Math.round(book.percentage * 100);
  const started = book.percentage > 0 || book.lastOpenedAt;
  const press = useLongPress(() => onLongPress?.(), onOpen);
  return (
    <button className={'card' + (selected ? ' sel' : '') + (extra ? ' ' + extra : '')} {...press} aria-label={book.title} aria-pressed={selecting ? !!selected : undefined}>
      <BookCover book={book} showFormat badge={<CloudBadge book={book} />} />
      {selecting && <Mark selected={!!selected} />}
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

/** "Cards" view: the cover on the left, the book's details inside the card. */
export function BookRow({ book, onOpen, onLongPress, selecting, selected, extra, sub }: Props) {
  const { t, n } = useT();
  const pct = Math.round(book.percentage * 100);
  const press = useLongPress(() => onLongPress?.(), onOpen);
  return (
    <button className={'view-card' + (selected ? ' sel' : '') + (extra ? ' ' + extra : '')} {...press} aria-label={book.title} aria-pressed={selecting ? !!selected : undefined}>
      <div className="thumb"><BookCover book={book} showFormat badge={<CloudBadge book={book} />} /></div>
      <div className="meta">
        <div className="title clamp2" dir="auto">{book.title}</div>
        {book.author && <div className="author clamp1" dir="auto">{book.author}</div>}
        {book.finished ? (
          <div className="prog">{t('book.finished')}</div>
        ) : book.percentage > 0 ? (
          <div className="prog"><div className="bar"><i style={{ width: `${pct}%` }} /></div><span>{n(pct)}%</span></div>
        ) : (
          <div className="prog">{sub ?? t('book.notStarted')}</div>
        )}
      </div>
      {selecting && <Mark selected={!!selected} />}
    </button>
  );
}

/** "Names" view: just the title, in a long compact list. */
export function BookName({ book, onOpen, onLongPress, selecting, selected, extra }: Props) {
  const press = useLongPress(() => onLongPress?.(), onOpen);
  return (
    <button className={'view-name' + (selected ? ' sel' : '') + (extra ? ' ' + extra : '')} {...press} aria-label={book.title} aria-pressed={selecting ? !!selected : undefined}>
      <span className="nm clamp1" dir="auto">{book.title}</span>
      {!selecting && <CloudBadge book={book} variant="inline" />}
      {selecting && <Mark selected={!!selected} />}
    </button>
  );
}
