import { useState } from 'react';
import { ArrowLeft, BookOpen, Check, Trash2 } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { BookCover } from '../components/BookCover';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatBytes, formatDate } from '../lib/utils';

export function DetailsScreen({ id }: { id: string }) {
  const { t, lang, n } = useT();
  const book = useApp((s) => s.books.find((b) => b.id === id));
  const navigate = useApp((s) => s.navigate);
  const back = useApp((s) => s.back);
  const removeBook = useApp((s) => s.removeBook);
  const updateBook = useApp((s) => s.updateBook);
  const [confirm, setConfirm] = useState(false);

  if (!book) {
    return (
      <div className="screen"><div className="screen-pad"><div className="empty"><p>{t('details.missing')}</p>
        <button className="btn" onClick={() => navigate({ name: 'library' }, { replace: true })}>{t('nav.library')}</button></div></div></div>
    );
  }
  const started = book.percentage > 0 || !!book.lastOpenedAt;
  const facts: Array<[string, string]> = [
    [t('details.format'), book.format.toUpperCase()],
    [t('details.progress'), book.finished ? t('book.finished') : `${n(Math.round(book.percentage * 100))}%`],
    [t('details.size'), formatBytes(book.size)],
    [t('details.added'), formatDate(book.addedAt, lang)],
  ];
  if (book.pages) facts.splice(2, 0, [t('details.pages'), n(book.pages)]);
  if (book.lastOpenedAt) facts.push([t('details.lastOpened'), formatDate(book.lastOpenedAt, lang)]);

  return (
    <div className="screen">
      <div className="screen-pad">
        <div style={{ paddingTop: 8, marginInline: -10 }}>
          <button className="icon-btn" onClick={() => (back() ? undefined : navigate({ name: 'library' }, { replace: true }))} aria-label={t('common.back')}>
            <ArrowLeft className="flip" size={22} />
          </button>
        </div>
        <div className="details">
          <BookCover book={book} big showFormat />
          <div className="col" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
            <div className="text">
              <h1 className="h-display" dir="auto">{book.title}</h1>
              {book.author && <p className="muted" style={{ fontSize: 17 }} dir="auto">{book.author}</p>}
            </div>
            <div className="actions">
              <button className="btn btn-primary" onClick={() => navigate({ name: 'reader', id: book.id })}>
                <BookOpen size={20} aria-hidden="true" />
                {started ? t('book.continue') : t('book.start')}
              </button>
              <button className="btn" onClick={() => updateBook(book.id, { finished: !book.finished })}>
                <Check size={19} aria-hidden="true" />
                {book.finished ? t('details.markUnread') : t('details.markRead')}
              </button>
              <button className="btn btn-ghost btn-danger" onClick={() => setConfirm(true)}>
                <Trash2 size={19} aria-hidden="true" />
                {t('details.remove')}
              </button>
            </div>
            <div className="group facts">
              {facts.map(([k, v]) => (
                <div className="fact" key={k}><span>{k}</span><span>{v}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog
          title={t('details.removeTitle')}
          body={t('details.removeBody')}
          confirmLabel={t('details.remove')}
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false);
            await removeBook(book.id);
            navigate({ name: 'library' }, { replace: true });
          }}
        />
      )}
    </div>
  );
}
