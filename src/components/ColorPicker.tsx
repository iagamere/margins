import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, Check, Ban, Plus } from 'lucide-react';
import { pushBackHandler } from '../lib/backStack';
import { useT } from '../lib/i18n';
import { useApp } from '../store/useApp';
import { hexToHsv, hsvToHex, isHex, normalizeHex, type Hsv } from '../lib/color';

const MAX_SAVED = 18;
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** One tap-and-drag surface that reports a position 0..1 × 0..1. */
function useSurface(onMove: (x: number, y: number) => void) {
  const dragging = useRef(false);
  const apply = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  return {
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragging.current = true;
      apply(e);
    },
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => dragging.current && apply(e),
    onPointerUp: () => { dragging.current = false; },
    onPointerCancel: () => { dragging.current = false; },
  };
}

/** The app's own colour picker: a shade square, a hue strip, a hex field and "my colours". */
export function ColorPickerDialog({ value, onApply, onCancel }: { value?: string; onApply: (hex: string) => void; onCancel: () => void }) {
  const { t } = useT();
  const saved = useApp((s) => s.settings.savedColors);
  const setSettings = useApp((s) => s.setSettings);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(isHex(value) ? value : '#b0503f'));
  const hex = hsvToHex(hsv);
  const [text, setText] = useState(hex);
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setText(hex);
  }, [hex]);

  useEffect(() => {
    const off = pushBackHandler(onCancel);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { off(); window.removeEventListener('keydown', onKey, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sv = useSurface((x, y) => setHsv((c) => ({ ...c, s: x, v: 1 - y })));
  const hue = useSurface((x) => setHsv((c) => ({ ...c, h: Math.min(359.9, x * 360) })));
  const isSaved = saved.some((c) => same(c, hex));
  const toggleSave = () =>
    setSettings({ savedColors: isSaved ? saved.filter((c) => !same(c, hex)) : [hex, ...saved].slice(0, MAX_SAVED) });
  const load = (c: string) => { typing.current = false; setHsv(hexToHsv(c)); };

  return createPortal(
    <>
      <div className="scrim top cp-layer" onClick={onCancel} />
      <div className="dialog cp-layer" role="dialog" aria-modal="true" aria-label={t('color.pick')}>
        <h2>{t('color.pick')}</h2>
        <div className="cp-sv" style={{ ['--hue' as string]: `hsl(${hsv.h} 100% 50%)` }} {...sv}>
          <i className="cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
        </div>
        <div className="cp-hue" {...hue}>
          <i className="cp-knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
        </div>
        <div className="cp-row">
          <span className="cp-preview" style={{ background: hex }} aria-hidden="true" />
          <input
            className="name-input cp-hex"
            value={text}
            maxLength={7}
            spellCheck={false}
            autoCapitalize="off"
            aria-label={t('color.hex')}
            onFocus={() => { typing.current = true; }}
            onBlur={() => { typing.current = false; setText(hex); }}
            onChange={(e) => {
              setText(e.target.value);
              const n = normalizeHex(e.target.value);
              if (n) setHsv(hexToHsv(n));
            }}
          />
          <button type="button" className={'btn btn-sm' + (isSaved ? ' btn-primary' : '')} onClick={toggleSave} aria-pressed={isSaved}>
            <Bookmark size={16} fill={isSaved ? 'currentColor' : 'none'} aria-hidden="true" />
            {isSaved ? t('color.saved') : t('color.save')}
          </button>
        </div>
        {saved.length > 0 && (
          <div>
            <div className="shelf-field"><div className="lbl">{t('color.mine')}</div></div>
            <div className="mark-swatches">
              {saved.map((c) => (
                <button key={c} type="button" className="mkc" style={{ background: c }} aria-pressed={same(c, hex)} aria-label={c} onClick={() => load(c)} />
              ))}
            </div>
          </div>
        )}
        <div className="actions">
          <button className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={() => onApply(hex)}>{t('color.use')}</button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * The one colour row used everywhere: [none/auto] · presets · my saved colours · [+ custom].
 * `value` undefined (or 'auto') means "no colour".
 */
export function ColorChoice({ value, presets, onChange, noneLabel, noneText, disabled, label }: {
  value?: string;
  presets: string[];
  onChange: (c: string | undefined) => void;
  /** accessible name of the "no colour / automatic" dot; when omitted there is no such dot */
  noneLabel?: string;
  /** short text drawn in the none dot instead of the slashed circle (e.g. "A") */
  noneText?: string;
  disabled?: boolean;
  label?: string;
}) {
  const { t } = useT();
  const saved = useApp((s) => s.settings.savedColors);
  const [open, setOpen] = useState(false);
  const cur = value && value !== 'auto' ? value : undefined;
  const extra = [...saved.filter((c) => !presets.some((p) => same(p, c)))];
  const unknown = cur && !presets.some((p) => same(p, cur)) && !extra.some((c) => same(c, cur)) ? cur : undefined;
  const dots = [...presets, ...extra, ...(unknown ? [unknown] : [])];
  return (
    <>
      <div className={'mark-swatches' + (disabled ? ' cp-disabled' : '')} role="group" aria-label={label}>
        {noneLabel && (
          <button type="button" className="mkc auto" aria-pressed={!cur} aria-label={noneLabel} title={noneLabel} onClick={() => onChange(undefined)}>
            {noneText ?? <Ban size={15} aria-hidden="true" />}
          </button>
        )}
        {dots.map((c) => (
          <button key={c} type="button" className="mkc" style={{ background: c }} aria-pressed={same(c, cur)} aria-label={c} onClick={() => onChange(c)}>
            {same(c, cur) && <Check size={15} strokeWidth={3} color="#fff" aria-hidden="true" />}
          </button>
        ))}
        <button type="button" className="mkc custom" aria-label={t('color.custom')} title={t('color.custom')} onClick={() => setOpen(true)}>
          <Plus size={16} strokeWidth={2.4} color="#fff" aria-hidden="true" />
        </button>
      </div>
      {open && (
        <ColorPickerDialog
          value={cur}
          onCancel={() => setOpen(false)}
          onApply={(c) => { setOpen(false); onChange(c); }}
        />
      )}
    </>
  );
}
