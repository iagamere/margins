import { useEffect, useRef, useState } from 'react';
import { Bookmark, Trash2, X } from 'lucide-react';
import { useT } from '../lib/i18n';
import { pushBackHandler } from '../lib/backStack';
import { MARK_COLORS } from '../components/TypographyControls';
import type { AnnotationRecord } from '../lib/types';

/** Small anchored card to name, colour and annotate a bookmark. */
export function BookmarkPopover({
  ann,
  where,
  onSave,
  onDelete,
  onClose,
}: {
  ann: AnnotationRecord;
  where: string;
  onSave(patch: Partial<AnnotationRecord>): void;
  onDelete(): void;
  onClose(): void;
}) {
  const { t } = useT();
  const [title, setTitle] = useState(ann.title ?? '');
  const [note, setNote] = useState(ann.note ?? '');
  const [color, setColor] = useState(ann.markColor ?? 'auto');
  const latest = useRef({ title, note });
  latest.current = { title, note };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = useRef(onSave);
  save.current = onSave;

  const flush = () => {
    clearTimeout(timer.current);
    save.current({ title: latest.current.title.trim() || undefined, note: latest.current.note.trim() || undefined });
  };
  const schedule = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 450);
  };
  const close = () => {
    flush();
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => pushBackHandler(() => closeRef.current()), []);

  const pick = (c: string) => {
    setColor(c);
    save.current({ markColor: c === 'auto' ? undefined : c });
  };
  const custom = color !== 'auto' && !MARK_COLORS.includes(color);

  return (
    <>
      <div className="bm-scrim" onClick={close} />
      <div className="bm-pop" role="dialog" aria-label={t('bm.title')} style={{ ['--c' as string]: color === 'auto' ? 'var(--mark)' : color }}>
        <div className="bm-head">
          <Bookmark size={18} aria-hidden="true" style={{ color: 'var(--c)' }} fill="currentColor" />
          <b>{t('bm.title')}</b>
          <span className="muted clamp1" dir="auto">{where}</span>
          <button className="icon-btn" onClick={close} aria-label={t('common.close')}><X size={19} /></button>
        </div>
        {ann.text && <div className="bm-quote" dir="auto">{ann.text}</div>}
        <input
          className="bm-input"
          value={title}
          maxLength={80}
          dir="auto"
          placeholder={t('bm.namePh')}
          aria-label={t('bm.name')}
          onChange={(e) => {
            setTitle(e.target.value);
            schedule();
          }}
          onKeyDown={(e) => e.key === 'Enter' && close()}
        />
        <div className="mark-swatches" role="group" aria-label={t('bm.color')}>
          <button className="mkc auto" aria-pressed={color === 'auto'} onClick={() => pick('auto')} aria-label={t('theme.auto')}>A</button>
          {MARK_COLORS.map((c) => (
            <button key={c} className="mkc" style={{ background: c }} aria-pressed={color === c} onClick={() => pick(c)} aria-label={c} />
          ))}
          <label className={'mkc custom' + (custom ? ' on' : '')} aria-label={t('typo.markCustom')} style={custom ? { background: color } : undefined}>
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#b0503f'} onChange={(e) => pick(e.target.value)} />
          </label>
        </div>
        <textarea
          className="bm-input"
          rows={3}
          value={note}
          dir="auto"
          placeholder={t('bm.notePh')}
          aria-label={t('bm.note')}
          onChange={(e) => {
            setNote(e.target.value);
            schedule();
          }}
        />
        <div className="bm-foot">
          <button className="btn danger-ghost" onClick={onDelete}><Trash2 size={17} aria-hidden="true" />{t('bm.delete')}</button>
          <button className="btn btn-primary" onClick={close}>{t('bm.done')}</button>
        </div>
      </div>
    </>
  );
}
