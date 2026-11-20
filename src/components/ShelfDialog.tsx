import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, BookImage } from 'lucide-react';
import { ColorChoice } from './ColorPicker';
import { ConfirmDialog } from './ConfirmDialog';
import { useObjectUrl } from './BookCover';
import { useT } from '../lib/i18n';
import { useApp } from '../store/useApp';
import { cropToRatio, dominantColor, suggestRatio } from '../lib/shelfImage';
import type { ShelfRatio, ShelfStyle } from '../lib/types';

export const SHELF_COLORS = ['#78816c', '#a27061', '#c08a3e', '#947d4f', '#5c8885', '#677f95', '#8d7396', '#9c707b', '#a05252', '#4f7a5a'];

export interface ShelfDraft extends ShelfStyle {
  name: string;
}

/** A shelf's picture, as a cover-fitted <img>. */
export function ShelfImage({ blob, className = 'shelf-img' }: { blob?: Blob; className?: string }) {
  const url = useObjectUrl(blob);
  if (!url) return null;
  return <img className={className} src={url} alt="" draggable={false} decoding="async" />;
}

function CoverThumb({ blob, title, onPick }: { blob: Blob; title: string; onPick: () => void }) {
  const url = useObjectUrl(blob);
  return (
    <button type="button" className="cover-pick" onClick={onPick} aria-label={title} title={title}>
      {url && <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />}
    </button>
  );
}

/** New / edit shelf: name, colour, picture (2:3 or 1:1) and the "dynamic colour" taken from that picture. */
export function ShelfDialog({ title, confirmLabel, initial, preferBookIds, onSubmit, onCancel }: {
  title: string;
  /** books whose covers are offered first (the shelf's own books, or the ones being put on it) */
  preferBookIds?: string[];
  confirmLabel: string;
  initial?: ShelfDraft;
  onSubmit: (draft: ShelfDraft) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState<string | undefined>(initial?.color);
  const [image, setImage] = useState<Blob | undefined>(initial?.image);
  const [ratio, setRatio] = useState<ShelfRatio>(initial?.ratio ?? '2:3');
  const [dynamic, setDynamic] = useState(!!initial?.dynamic && !!initial?.image);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const preview = useObjectUrl(image);
  const books = useApp((s) => s.books);
  const [picking, setPicking] = useState(false);
  const withCover = books.filter((b) => b.cover);
  const first = new Set(preferBookIds ?? []);
  const near = withCover.filter((b) => first.has(b.id));
  const rest = withCover.filter((b) => !first.has(b.id));

  // dynamic colour follows whatever picture is current
  const syncDynamic = async (blob: Blob) => {
    const c = await dominantColor(blob);
    if (c) setColor(c);
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await suggestRatio(f);
      const cropped = await cropToRatio(f, r);
      setRatio(r);
      setImage(cropped);
      if (dynamic) await syncDynamic(cropped);
    } catch {
      toast('err.shelfImage', 'error');
    } finally {
      setBusy(false);
    }
  };

  const pickCover = async (blob: Blob) => {
    setBusy(true);
    try {
      const r = await suggestRatio(blob);
      const cropped = await cropToRatio(blob, r);
      setRatio(r);
      setImage(cropped);
      setPicking(false);
      if (dynamic) await syncDynamic(cropped);
    } catch {
      toast('err.shelfImage', 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeRatio = async (r: ShelfRatio) => {
    if (!image || r === ratio) return;
    setBusy(true);
    try {
      const cropped = await cropToRatio(image, r);
      setRatio(r);
      setImage(cropped);
      if (dynamic) await syncDynamic(cropped);
    } catch {
      toast('err.shelfImage', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleDynamic = async () => {
    const next = !dynamic;
    setDynamic(next);
    if (next && image) await syncDynamic(image);
  };

  useEffect(() => {
    if (!image && dynamic) setDynamic(false);
  }, [image, dynamic]);

  const submit = () => {
    if (!name.trim() || busy) return;
    onSubmit({ name: name.trim(), color, image, ratio: image ? ratio : undefined, dynamic: image ? dynamic : false });
  };

  return (
    <ConfirmDialog title={title} confirmLabel={confirmLabel} onConfirm={submit} onCancel={onCancel}>
      <input
        className="name-input"
        autoFocus
        value={name}
        maxLength={60}
        dir="auto"
        placeholder={t('shelf.namePlaceholder')}
        aria-label={t('shelf.namePlaceholder')}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />

      <div className="shelf-field">
        <div className="lbl">{t('shelf.color')}</div>
        <ColorChoice
          label={t('shelf.color')}
          value={color}
          presets={SHELF_COLORS}
          noneLabel={t('shelf.colorNone')}
          disabled={dynamic}
          onChange={setColor}
        />
      </div>

      <div className="shelf-field">
        <div className="lbl">{t('shelf.image')}</div>
        <input ref={file} type="file" hidden accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f); }} />
        {!image ? (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => file.current?.click()}>
              <ImagePlus size={18} aria-hidden="true" />
              {t('shelf.imageAdd')}
            </button>
            {withCover.length > 0 && (
              <button type="button" className="btn btn-sm" disabled={busy} aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
                <BookImage size={18} aria-hidden="true" />
                {t('shelf.fromBook')}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="shelf-img-row">
              <div className="shelf-thumb" style={{ aspectRatio: ratio === '1:1' ? '1 / 1' : '2 / 3' }}>
                {preview && <img src={preview} alt="" draggable={false} />}
              </div>
              <div className="col" style={{ flex: 1, minWidth: 0, gap: 8, display: 'flex', flexDirection: 'column' }}>
                <div className="seg" role="radiogroup" aria-label={t('shelf.ratio')}>
                  {(['2:3', '1:1'] as ShelfRatio[]).map((r) => (
                    <button key={r} type="button" role="radio" aria-checked={ratio === r} disabled={busy} onClick={() => void changeRatio(r)}>{r}</button>
                  ))}
                </div>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => file.current?.click()}>
                  <ImagePlus size={16} aria-hidden="true" />
                  {t('shelf.imageChange')}
                </button>
                {withCover.length > 0 && (
                  <button type="button" className="btn btn-sm" disabled={busy} aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
                    <BookImage size={16} aria-hidden="true" />
                    {t('shelf.fromBook')}
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => { setImage(undefined); setDynamic(false); }}>
                  <Trash2 size={16} aria-hidden="true" />
                  {t('shelf.imageRemove')}
                </button>
              </div>
            </div>
            <div className="row-between dynamic-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{t('shelf.dynamic')}</div>
                <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{t('shelf.dynamicHint')}</div>
              </div>
              <button type="button" role="switch" aria-checked={dynamic} aria-label={t('shelf.dynamic')} className="switch" onClick={() => void toggleDynamic()} />
            </div>
          </>
        )}
        {picking && (
          <div className="cover-picker">
            {near.length > 0 && (
              <>
                <div className="lbl">{t('shelf.coversHere')}</div>
                <div className="cover-grid">
                  {near.map((b) => <CoverThumb key={b.id} blob={b.cover!} title={b.title} onPick={() => void pickCover(b.cover!)} />)}
                </div>
              </>
            )}
            {rest.length > 0 && (
              <>
                <div className="lbl">{near.length > 0 ? t('shelf.coversAll') : t('shelf.fromBook')}</div>
                <div className="cover-grid">
                  {rest.map((b) => <CoverThumb key={b.id} blob={b.cover!} title={b.title} onPick={() => void pickCover(b.cover!)} />)}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}
