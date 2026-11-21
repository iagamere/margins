import { useState } from 'react';
import { ArrowLeft, Cloud, CloudUpload, LogOut, RefreshCw } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { signIn, signOut } from '../lib/auth';
import { uploadAllLocal } from '../lib/cloud';
import { formatBytes } from '../lib/utils';

export function AccountScreen() {
  const { t, n } = useT();
  const account = useApp((s) => s.account);
  const setAccount = useApp((s) => s.setAccount);
  const books = useApp((s) => s.books);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const syncing = useApp((s) => s.syncing);
  const syncNow = useApp((s) => s.syncNow);
  const transfers = useApp((s) => s.transfers);
  const back = useApp((s) => s.back);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = () => {
    if (!back()) navigate({ name: 'library' }, { replace: true });
  };

  const doSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      setAccount(await signIn());
      void useApp.getState().syncNow();
    } catch (e) {
      setError((e as { message?: string })?.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  const doSignOut = async () => {
    await signOut();
    setAccount(null);
    setError(null);
  };

  const inDrive = books.filter((b) => b.cloudId);
  const driveBytes = inDrive.reduce((a, b) => a + b.size, 0);
  const onDevice = books.filter((b) => !b.remoteOnly);
  const notUploaded = books.filter((b) => !b.remoteOnly && !b.cloudId);
  const moving = Object.keys(transfers).length;

  return (
    <div className="screen">
      <div className="screen-pad" style={{ maxWidth: 720 }}>
        <header className="page-head">
          <div style={{ marginInline: -10, marginBottom: -6 }}>
            <button className="icon-btn" onClick={goBack} aria-label={t('common.back')}>
              <ArrowLeft className="flip" size={22} />
            </button>
          </div>
          <div className="top"><h1 className="h-display">{t('account.title')}</h1></div>
        </header>

        {!account ? (
          <div className="acc-card">
            <div className="acc-avatar big off" aria-hidden="true"><Cloud size={26} strokeWidth={1.6} /></div>
            <div className="acc-text">
              <div className="label">{t('account.signIn')}</div>
              <p className="hint">{t('account.hint')}</p>
            </div>
            <button className="btn btn-primary" disabled={busy} onClick={() => void doSignIn()}>{busy ? '…' : t('account.signInBtn')}</button>
            {error && <p className="acc-error" dir="auto">{t('account.failed')}: {error}</p>}
          </div>
        ) : (
          <>
            <div className="acc-card">
              <div className="acc-profile">
                <div className="acc-avatar big" aria-hidden="true">{(account.name || account.email || '?').trim().charAt(0).toUpperCase()}</div>
                <div className="acc-text">
                  <div className="label" dir="auto">{account.name || account.email}</div>
                  {account.name && account.email && <div className="hint" dir="ltr">{account.email}</div>}
                </div>
              </div>
              <div className="acc-actions">
                <button className="btn btn-sm" disabled={syncing} onClick={() => void syncNow()}>
                  <RefreshCw size={16} aria-hidden="true" className={syncing ? 'spin' : undefined} />
                  {t('account.syncNow')}
                </button>
                <button className="btn btn-sm btn-ghost btn-danger" onClick={() => void doSignOut()}>
                  <LogOut size={16} aria-hidden="true" />
                  {t('account.signOut')}
                </button>
              </div>
            </div>

            <h2 className="eyebrow section-title">{t('account.library')}</h2>
            <div className="group">
              <div className="setting-row"><span className="label">{t('account.inDrive')}</span><span className="muted">{n(inDrive.length)} · {formatBytes(driveBytes)}</span></div>
              <div className="setting-row"><span className="label">{t('account.onDevice')}</span><span className="muted">{n(onDevice.length)}</span></div>
              {moving > 0 && <div className="setting-row"><span className="label">{t('account.moving')}</span><span className="muted">{n(moving)}</span></div>}
              {notUploaded.length > 0 && (
                <div className="setting-row">
                  <div><div className="label">{t('account.notUploaded', { count: n(notUploaded.length) })}</div><div className="hint">{t('account.notUploadedHint')}</div></div>
                  <button className="btn btn-sm" onClick={() => void uploadAllLocal().then((c) => toast('cloud.uploadStarted', 'info', { count: c }))}>
                    <CloudUpload size={16} aria-hidden="true" />
                    {t('account.uploadAll')}
                  </button>
                </div>
              )}
              <div className="setting-row">
                <div><div className="label">{t('account.auto')}</div><div className="hint">{t('account.autoHint')}</div></div>
                <button role="switch" aria-checked={settings.cloudAutoUpload} aria-label={t('account.auto')} className="switch" onClick={() => setSettings({ cloudAutoUpload: !settings.cloudAutoUpload })} />
              </div>
              <div className="setting"><div className="hint muted" style={{ fontSize: 13, lineHeight: 1.55 }}>{t('account.privacy')}</div></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
