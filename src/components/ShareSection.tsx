import { useEffect, useState } from 'react';
import { ChevronRight, ClipboardPaste, Copy, KeyRound, RefreshCw, Share2, Stamp, Trash2, X } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { addFriend, changeStamp, loadShare, publishLibrary, removeFriend, restoreShare, stampOf, stopSharing, useShare } from '../lib/share';
import { ConfirmDialog } from './ConfirmDialog';

/** "My stamp" (publish my library) and "Friends' libraries" (enter a stamp, browse, download). */
export function ShareSection({ onReauth, reauthBusy }: { onReauth: () => void; reauthBusy: boolean }) {
  const { t, n } = useT();
  const account = useApp((s) => s.account);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const { mine: stored, friends, busy } = useShare();
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'stop' | 'change'>(null);
  const loaded = useShare((s) => s.loaded);

  useEffect(() => {
    void loadShare();
  }, []);
  // same stamp as before even after a reinstall: the shared files are found again in Drive
  useEffect(() => {
    if (loaded && account?.share) void restoreShare();
  }, [loaded, account?.email, account?.share]);

  const mine = stored && account && stored.email === account.email ? stored : null;

  const copy = async () => {
    if (!mine) return;
    try {
      await navigator.clipboard.writeText(stampOf(mine));
      toast('share.copied', 'success');
    } catch {
      /* the stamp is shown on screen and can be selected by hand */
    }
  };
  const send = async () => {
    if (!mine) return;
    const text = t('share.message', { stamp: stampOf(mine) });
    try {
      if (navigator.share) await navigator.share({ text });
      else await copy();
    } catch {
      /* share sheet dismissed */
    }
  };
  const paste = async () => {
    try {
      setInput((await navigator.clipboard.readText()).trim());
    } catch {
      /* clipboard not readable: type or long-press to paste */
    }
  };
  const add = async () => {
    if (!input.trim() || adding) return;
    setAdding(true);
    setErr(null);
    try {
      const rec = await addFriend(input);
      setInput('');
      toast('friends.added', 'success', { name: rec.name || t('friends.noName') });
      navigate({ name: 'friend', id: rec.id });
    } catch (e) {
      const m = (e as { message?: string })?.message || String(e);
      setErr(m === 'bad-stamp' ? t('friends.bad') : t('friends.fail', { msg: m }));
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      {account && (
        <>
          <h2 className="eyebrow section-title">{t('share.title')}</h2>
          <div className="acc-card" style={{ marginTop: 8 }}>
            {!account.share ? (
              <>
                <p className="hint" style={{ margin: 0 }}>{t('share.reauth')}</p>
                <button className="btn btn-primary" disabled={reauthBusy} onClick={onReauth}>{reauthBusy ? '…' : t('account.signInBtn')}</button>
              </>
            ) : !mine ? (
              <>
                <p className="hint" style={{ margin: 0, lineHeight: 1.6 }}>{t('share.intro')}</p>
                <button className="btn btn-primary" disabled={!!busy} onClick={() => void publishLibrary()}>
                  <Stamp size={18} aria-hidden="true" />
                  {busy ? t('share.publishing', { done: n(busy.done), total: n(busy.total) }) : t('share.create')}
                </button>
              </>
            ) : (
              <>
                <div>
                  <div className="hint">{t('share.stamp')}</div>
                  <div className="stamp" dir="ltr">{stampOf(mine)}</div>
                </div>
                <div className="acc-actions">
                  <button className="btn btn-sm" onClick={() => void copy()}><Copy size={16} aria-hidden="true" />{t('share.copy')}</button>
                  <button className="btn btn-sm" onClick={() => void send()}><Share2 size={16} aria-hidden="true" />{t('share.send')}</button>
                  <button className="btn btn-sm" disabled={!!busy} onClick={() => void publishLibrary()}>
                    <RefreshCw size={16} aria-hidden="true" className={busy ? 'spin' : undefined} />
                    {busy ? t('share.publishing', { done: n(busy.done), total: n(busy.total) }) : t('share.update')}
                  </button>
                </div>
                <p className="hint" style={{ margin: 0, lineHeight: 1.6 }}>
                  {t('share.count', { count: n(Object.keys(mine.files).length) })} · {t('share.note')}
                </p>
                <p className="hint" style={{ margin: 0, lineHeight: 1.6 }}>{t('share.fixed')}</p>
                <div className="acc-actions">
                  <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => setConfirm('change')}>
                    <KeyRound size={16} aria-hidden="true" />
                    {t('share.change')}
                  </button>
                  <button className="btn btn-sm btn-ghost btn-danger" disabled={!!busy} onClick={() => setConfirm('stop')}>
                    <Trash2 size={16} aria-hidden="true" />
                    {t('share.stop')}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <h2 className="eyebrow section-title">{t('friends.title')}</h2>
      <div className="acc-card" style={{ marginTop: 8 }}>
        <div className="row" style={{ gap: 6 }}>
          <label className="field" style={{ flex: 1, minWidth: 0 }}>
            <Stamp size={18} aria-hidden="true" />
            <input dir="ltr" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder={t('friends.placeholder')} aria-label={t('friends.placeholder')} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </label>
          <button className="icon-btn" onClick={() => void paste()} aria-label={t('friends.paste')} title={t('friends.paste')}><ClipboardPaste size={21} /></button>
        </div>
        <button className="btn btn-primary" disabled={adding || !input.trim()} onClick={() => void add()}>{adding ? '…' : t('friends.add')}</button>
        {err && <p className="acc-error" dir="auto">{err}</p>}
        {friends.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>{t('friends.empty')}</p>
        ) : (
          <div className="friend-list">
            {friends.map((f) => (
              <div className="friend-item" key={f.id}>
                <button className="friend-open" onClick={() => navigate({ name: 'friend', id: f.id })}>
                  <span className="friend-name" dir="auto">{f.name || t('friends.noName')}</span>
                  <span className="hint">{t('friends.books', { count: n(f.count) })}</span>
                  <ChevronRight className="flip" size={18} aria-hidden="true" />
                </button>
                <button className="icon-btn" style={{ width: 40, height: 40 }} onClick={() => void removeFriend(f.id)} aria-label={t('friends.remove')} title={t('friends.remove')}><X size={18} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={t(confirm === 'stop' ? 'share.stopTitle' : 'share.changeTitle')}
          body={t(confirm === 'stop' ? 'share.stopBody' : 'share.changeBody')}
          confirmLabel={t(confirm === 'stop' ? 'share.stop' : 'share.change')}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const c = confirm;
            setConfirm(null);
            void (c === 'stop' ? stopSharing() : changeStamp());
          }}
        />
      )}
    </>
  );
}
