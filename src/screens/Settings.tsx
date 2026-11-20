import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT, LANG_NAMES } from '../lib/i18n';
import { TypographyControls } from '../components/TypographyControls';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { requestPersistence, storageEstimate } from '../lib/db';
import { formatBytes } from '../lib/utils';
import { isNative } from '../lib/platform';
import { CURRENT_BUILD } from '../lib/updater';
import { ACCENTS, ACCENT_NAMES } from '../lib/accents';
import type { AppTheme, Lang } from '../lib/types';

const THEMES: Array<{ id: AppTheme; bg: string }> = [
  { id: 'system', bg: 'linear-gradient(90deg,#F6F4EF 50%,#191B19 50%)' },
  { id: 'light', bg: '#F6F4EF' },
  { id: 'dark', bg: '#191B19' },
  { id: 'sepia', bg: '#F0E5D0' },
];

export function SettingsScreen() {
  const { t, n } = useT();
  const s = useApp((st) => st.settings);
  const set = useApp((st) => st.setSettings);
  const books = useApp((st) => st.books);
  const resetEverything = useApp((st) => st.resetEverything);
  const [est, setEst] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    void storageEstimate().then(setEst);
  }, [books.length]);

  const total = books.reduce((a, b) => a + b.size, 0);

  return (
    <div className="screen">
      <div className="screen-pad" style={{ maxWidth: 720 }}>
        <header className="page-head"><div className="top"><h1 className="h-display">{t('nav.settings')}</h1></div></header>

        <h2 className="eyebrow section-title">{t('settings.appearance')}</h2>
        <div className="group"><div className="setting">
          <div className="theme-swatches" role="group" aria-label={t('settings.appearance')}>
            {THEMES.map((th) => (
              <button key={th.id} className="swatch" aria-pressed={s.theme === th.id} onClick={() => set({ theme: th.id })}>
                <i style={{ background: th.bg }} /><span>{t(`theme.${th.id}`)}</span>
              </button>
            ))}
          </div>
        </div></div>
        <h2 className="eyebrow section-title">{t('settings.accent')}</h2>
        <div className="group"><div className="setting">
          <div className="accent-dots" role="group" aria-label={t('settings.accent')}>
            {ACCENT_NAMES.map((a) => (
              <button key={a} className="accent-dot" style={{ background: ACCENTS[a].swatch }} aria-pressed={s.accent === a} aria-label={t(`accent.${a}`)} title={t(`accent.${a}`)} onClick={() => set({ accent: a })}>
                {s.accent === a && <Check size={18} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div></div>


        <h2 className="eyebrow section-title">{t('settings.language')}</h2>
        <div className="group"><div className="setting">
          <div className="seg" role="group" aria-label={t('settings.language')}>
            {(['ar', 'fr', 'en'] as Lang[]).map((l) => (
              <button key={l} lang={l} aria-pressed={s.lang === l} onClick={() => set({ lang: l })}>{LANG_NAMES[l]}</button>
            ))}
          </div>
          <div className="hint muted" style={{ fontSize: 13 }}>{t('settings.languageHint')}</div>
        </div></div>

        <h2 className="eyebrow section-title">{t('settings.reading')}</h2>
        <TypographyControls />
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>{t('settings.readingHint')}</p>

        <h2 className="eyebrow section-title">{t('settings.storage')}</h2>
        <div className="group">
          <div className="setting-row"><span className="label">{t('settings.books')}</span><span className="muted">{n(books.length)} · {formatBytes(total)}</span></div>
          {est.usage != null && <div className="setting-row"><span className="label">{t('settings.used')}</span><span className="muted">{formatBytes(est.usage)}{est.quota ? ` / ${formatBytes(est.quota)}` : ''}</span></div>}
          {!isNative && est.persisted === false && (
            <div className="setting-row">
              <div><div className="label">{t('settings.persist')}</div><div className="hint">{t('settings.persistHint')}</div></div>
              <button className="btn btn-sm" onClick={() => requestPersistence().then(() => storageEstimate().then(setEst))}>{t('settings.persistBtn')}</button>
            </div>
          )}
          <div className="setting"><div className="hint muted" style={{ fontSize: 13, lineHeight: 1.55 }}>{t(isNative ? 'storage.nativeNote' : 'storage.browserNote')}</div></div>
          <div className="setting-row">
            <div><div className="label">{t('settings.clear')}</div><div className="hint">{t('settings.clearHint')}</div></div>
            <button className="btn btn-sm btn-danger" onClick={() => setConfirm(true)}>{t('settings.clearBtn')}</button>
          </div>
        </div>

        <h2 className="eyebrow section-title">{t('settings.about')}</h2>
        <div className="group">
          <div className="setting-row"><span className="label">Margins</span><span className="muted">1.0.{CURRENT_BUILD || 0}</span></div>
          <div className="setting"><div className="hint muted" style={{ fontSize: 13 }}>{t('app.tagline')} · {t('settings.privacy')}</div></div>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog title={t('settings.clearTitle')} body={t('settings.clearBody')} confirmLabel={t('settings.clearBtn')} danger onCancel={() => setConfirm(false)}
          onConfirm={async () => { setConfirm(false); await resetEverything(); }} />
      )}
    </div>
  );
}
