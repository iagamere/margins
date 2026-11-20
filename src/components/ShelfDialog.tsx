import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Palette, Trash2, Check, Ban } from 'lucide-react';
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

/** New / edit shelf: name, colour, picture (2:3 or 1:1) and the "dynamic colour" taken from that picture. */
export function ShelfDialog({ title, confirmLabel, initial, onSubmit, onCancel }: {
  title: string;
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

  const custom = color && !SHELF_COLORS.includes(color) ? color : undefined;
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
        <div className={'swatches' + (dynamic ? ' disabled' : '')} role="group" aria-label={t('shelf.color')}>
          <button type="button" className="swatch none" aria-pressed={!color} aria-label={t('shelf.colorNone')} title={t('shelf.colorNone')} onClick={() => setColor(undefined)}>
            <Ban size={16} aria-hidden="true" />
          </button>
          {SHELF_COLORS.map((c) => (
            <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={color === c} aria-label={c} onClick={() => setColor(c)}>
              {color === c && <Check size={16} strokeWidth={3} aria-hidden="true" />}
            </button>
          ))}
          <label className="swatch custom" style={custom ? { background: custom } : undefined} title={t('shelf.colorCustom')} aria-label={t('shelf.colorCustom')}>
            {custom ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : <Palette size={16} aria-hidden="true" />}
            <input type="color" value={color ?? '#78816c'} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="shelf-field">
        <div className="lbl">{t('shelf.image')}</div>
        <input ref={file} type="file" hidden accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f); }} />
        {!image ? (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => file.current?.click()}>
            <ImagePlus size={18} aria-hidden="true" />
            {t('shelf.imageAdd')}
          </button>
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
      </div>
    </ConfirmDialog>
  );
}
