import { AlignJustify, AlignLeft, BookOpen, ScrollText } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { DEFAULT_READING } from '../lib/settings';
import { THEME_COLORS, resolveFont } from '../lib/readerCss';
import type { ReadFont, ReaderTheme, ThemeName } from '../lib/types';

const FONTS: ReadFont[] = ['auto', 'literata', 'sourceSerif', 'naskh', 'amiri', 'plexArabic', 'cairo', 'inter', 'original'];

function Stepper({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <div className="setting">
      <div className="row-between"><span className="label">{label}</span><span className="muted" style={{ fontSize: 14 }}>{format(value)}</span></div>
      <input className="range" type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/** Shared by the Settings screen and the in-reader panel. `scope: 'reader'` hides the app-level default-mode wording. */
export function TypographyControls({ showMode = true, format = 'epub', preview = true, reflow = false }: { showMode?: boolean; format?: 'epub' | 'pdf'; preview?: boolean; reflow?: boolean }) {
  const { t, n } = useT();
  const s = useApp((st) => st.settings);
  const set = useApp((st) => st.setSettings);
  const reset = useApp((st) => st.resetReading);
  const resolved = useApp((st) => st.resolvedTheme);
  const rtheme: ThemeName = s.readerTheme === 'auto' ? resolved : s.readerTheme;
  const rc = THEME_COLORS[rtheme];
  const { stack } = resolveFont(s.font, s.font === 'naskh' || s.font === 'plexArabic');
  const themes: ReaderTheme[] = ['auto', 'light', 'sepia', 'dark'];
  const isDefault = (Object.keys(DEFAULT_READING) as Array<keyof typeof DEFAULT_READING>).every((k) => s[k] === DEFAULT_READING[k]);

  if (format === 'pdf') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="notice"><span>{t('pdf.noTypography')}</span></div>
        <div className="group">
          <div className="setting">
            <span className="label">{t('typo.theme')}</span>
            <ThemePicker value={s.readerTheme} onChange={(v) => set({ readerTheme: v })} themes={themes} />
          </div>
          <div className="setting-row">
            <div><div className="label">{t('pdf.adapt')}</div><div className="hint">{t('pdf.adaptHint')}</div></div>
            <button role="switch" aria-checked={s.pdfAdaptTheme} aria-label={t('pdf.adapt')} className="switch" onClick={() => set({ pdfAdaptTheme: !s.pdfAdaptTheme })} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {preview && (
        <div className="typo-preview" style={{ background: rc.bg, color: rc.fg, fontFamily: stack ?? 'var(--font-read)', fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: reflow && s.textWeight === 'bold' ? 600 : 400, textAlign: s.textAlign === 'justify' ? 'justify' : 'start', paddingInline: Math.min(s.margin, 28) }} dir={reflow && s.textDir !== 'auto' ? s.textDir : 'auto'}>
          {t('typo.sample')}
        </div>
      )}
      <div className="group">
        <div className="setting">
          <span className="label">{t('typo.theme')}</span>
          <ThemePicker value={s.readerTheme} onChange={(v) => set({ readerTheme: v })} themes={themes} />
        </div>
        {showMode && (
          <div className="setting">
            <span className="label">{t('typo.mode')}</span>
            <div className="seg" role="group" aria-label={t('typo.mode')}>
              <button aria-pressed={s.readingMode === 'paged'} onClick={() => set({ readingMode: 'paged' })}><BookOpen size={17} aria-hidden="true" />{t('typo.paged')}</button>
              <button aria-pressed={s.readingMode === 'scroll'} onClick={() => set({ readingMode: 'scroll' })}><ScrollText size={17} aria-hidden="true" />{t('typo.scroll')}</button>
            </div>
          </div>
        )}
        <div className="setting">
          <span className="label">{t('typo.font')}</span>
          <div className="chips" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('typo.font')}>
            {FONTS.map((f) => (
              <button key={f} className="chip" aria-pressed={s.font === f} onClick={() => set({ font: f })}>{t(`font.${f}`)}</button>
            ))}
          </div>
        </div>
        <div className="setting">
          <div className="row-between"><span className="label">{t('typo.size')}</span><span className="muted" style={{ fontSize: 14 }}>{n(s.fontSize)}</span></div>
          <div className="stepper">
            <button className="btn btn-sm" style={{ minWidth: 46, padding: 0 }} onClick={() => set({ fontSize: Math.max(13, s.fontSize - 1) })} aria-label={t('typo.smaller')}><span style={{ fontFamily: 'var(--font-read)', fontSize: 15 }}>A</span></button>
            <input className="range" type="range" min={13} max={34} step={1} value={s.fontSize} aria-label={t('typo.size')} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
            <button className="btn btn-sm" style={{ minWidth: 46, padding: 0 }} onClick={() => set({ fontSize: Math.min(34, s.fontSize + 1) })} aria-label={t('typo.larger')}><span style={{ fontFamily: 'var(--font-read)', fontSize: 22 }}>A</span></button>
          </div>
        </div>
        <Stepper label={t('typo.lineHeight')} value={s.lineHeight} min={1.2} max={2.3} step={0.05} onChange={(v) => set({ lineHeight: Math.round(v * 100) / 100 })} format={(v) => v.toFixed(2)} />
        <Stepper label={t('typo.paragraph')} value={s.paragraphSpacing} min={0} max={2} step={0.1} onChange={(v) => set({ paragraphSpacing: Math.round(v * 10) / 10 })} format={(v) => `${v.toFixed(1)}em`} />
        <Stepper label={t('typo.margin')} value={s.margin} min={0} max={64} step={2} onChange={(v) => set({ margin: v })} format={(v) => `${n(v)}`} />
        <Stepper label={t('typo.width')} value={s.maxWidth} min={420} max={1100} step={20} onChange={(v) => set({ maxWidth: v })} format={(v) => `${n(v)}`} />
        {reflow && (
          <>
            <div className="setting">
              <span className="label">{t('typo.dir')}</span>
              <div className="seg" role="group" aria-label={t('typo.dir')}>
                <button aria-pressed={s.textDir === 'auto'} onClick={() => set({ textDir: 'auto' })}>{t('typo.dirAuto')}</button>
                <button aria-pressed={s.textDir === 'rtl'} onClick={() => set({ textDir: 'rtl' })}>{t('typo.dirRtl')}</button>
                <button aria-pressed={s.textDir === 'ltr'} onClick={() => set({ textDir: 'ltr' })}>{t('typo.dirLtr')}</button>
              </div>
            </div>
            <div className="setting">
              <span className="label">{t('typo.weight')}</span>
              <div className="seg" role="group" aria-label={t('typo.weight')}>
                <button aria-pressed={s.textWeight === 'regular'} onClick={() => set({ textWeight: 'regular' })}>{t('typo.weightRegular')}</button>
                <button aria-pressed={s.textWeight === 'bold'} onClick={() => set({ textWeight: 'bold' })} style={{ fontWeight: 700 }}>{t('typo.weightBold')}</button>
              </div>
            </div>
          </>
        )}
        <div className="setting">
          <span className="label">{t('typo.align')}</span>
          <div className="seg" role="group" aria-label={t('typo.align')}>
            <button aria-pressed={s.textAlign === 'original'} onClick={() => set({ textAlign: 'original' })}>{t(reflow ? 'align.auto' : 'align.original')}</button>
            <button aria-pressed={s.textAlign === 'start'} onClick={() => set({ textAlign: 'start' })}><AlignLeft className="flip" size={17} aria-hidden="true" />{t('align.start')}</button>
            <button aria-pressed={s.textAlign === 'justify'} onClick={() => set({ textAlign: 'justify' })}><AlignJustify size={17} aria-hidden="true" />{t('align.justify')}</button>
          </div>
        </div>
      </div>
      <button className="btn btn-block" onClick={reset} disabled={isDefault} style={isDefault ? { opacity: 0.5 } : undefined}>{t('typo.reset')}</button>
    </div>
  );
}

function ThemePicker({ value, onChange, themes }: { value: ReaderTheme; onChange: (v: ReaderTheme) => void; themes: ReaderTheme[] }) {
  const { t } = useT();
  const resolved = useApp((st) => st.resolvedTheme);
  return (
    <div className="theme-row" role="group" aria-label={t('typo.theme')}>
      {themes.map((th) => {
        const c = THEME_COLORS[th === 'auto' ? resolved : th];
        return (
          <button key={th} className="theme-card" aria-pressed={value === th} onClick={() => onChange(th)} style={{ ['--c-bg' as string]: c.bg, ['--c-fg' as string]: c.fg }}>
            <b>Aa</b>
            <span>{t(`theme.${th}`)}</span>
          </button>
        );
      })}
    </div>
  );
}
