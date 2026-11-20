import { Check } from 'lucide-react';
import type { BookRecord } from '../lib/types';
import { useT } from '../lib/i18n';
import { BookCover } from './BookCover';
import { useLongPress } from './useLongPress';

interface Props {
  book: BookRecord;
  onOpen: () => void;
  /** long-press: start / extend a selection */
  onLongPress?: () => void;
  /** a selection is in progress: show tick circles */
  selecting?: boolean;
  selected?: boolean;
}

function Mark({ selected }: { selected: boolean }) {
  return <span className={'sel-mark' + (selected ? ' on' : '')} aria-hidden="true">{selected && <Check size={15} strokeWidth={3} />}</span>;
}

export function BookCard({ book, onOpen, onLongPress, selecting, selected }: Props) {
  const { t, n } = useT();
  const pct = Math.round(book.percentage * 100);
  const started = book.percentage > 0 || book.lastOpenedAt;
  const press = useLongPress(() => onLongPress?.(), onOpen);
  return (
    <button className={'card' + (selected ? ' sel' : '')} {...press} aria-label={book.title} aria-pressed={selecting ? !!selected : undefined}>
      <BookCover book={book} showFormat />
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

export function BookRow({ book, onOpen, onLongPress, selecting, selected }: Props) {
  const { t, n } = useT();
  const pct = Math.round(book.percentage * 100);
  const press = useLongPress(() => onLongPress?.(), onOpen);
  return (
    <button className={'list-item' + (selected ? ' sel' : '')} {...press} aria-label={book.title} aria-pressed={selecting ? !!selected : undefined}>
      <BookCover book={book} />
      <div className="meta">
        <div className="title clamp2" dir="auto">{book.title}</div>
        {book.author && <div className="author clamp1" dir="auto">{book.author}</div>}
        <div className="prog">
          <span>{book.format.toUpperCase()}</span>
          {book.finished ? <span>· {t('book.finished')}</span> : book.percentage > 0 ? (<><div className="bar"><i style={{ width: `${pct}%` }} /></div><span>{n(pct)}%</span></>) : <span>· {t('book.notStarted')}</span>}
        </div>
      </div>
      {selecting && <Mark selected={!!selected} />}
    </button>
  );
}
