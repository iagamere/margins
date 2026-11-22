import { useEffect, useRef, useState } from 'react';
import { Bell, Camera, ChevronRight, ClipboardPaste, Copy, KeyRound, RefreshCw, Share2, Stamp, Trash2, X } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { addFriend, changeStamp, loadShare, publishLibrary, removeFriend, restoreShare, saveProfile, squareJpeg, stampOf, stopSharing, useShare } from '../lib/share';
import { useObjectUrl } from './BookCover';
import { ConfirmDialog } from './ConfirmDialog';

/** "My stamp" (publish my library) and "Friends' libraries" (enter a stamp, browse, download). */
export function ShareSection({ onReauth, reauthBusy }: { onReauth: () => void; reauthBusy: boolean }) {
  const { t, n } = useT();
  const account = useApp((s) => s.account);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const { mine: stored, friends, busy, profile } = useShare();
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [photo, setPhoto] = useState<Blob | undefined>();
  const [dirty, setDirty] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const photoUrl = useObjectUrl(photo);
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

  // the editor starts from what is saved
  useEffect(() => {
    setName(profile.name || account?.name || '');
    setBio(profile.bio);
    setPhoto(profile.avatar);
    setDirty(false);
  }, [profile, account?.name]);

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
    const text = t('share.message', { id: mine.manifestId, stamp: stampOf(mine) });
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
          {account.share && (
            <>
              <h2 className="eyebrow section-title">{t('profile.title')}</h2>
              <div className="acc-card" style={{ marginTop: 8 }}>
                <div className="acc-profile">
                  <button className="avatar-pick" onClick={() => fileIn.current?.click()} aria-label={t('profile.photo')} title={t('profile.photo')}>
                    {photoUrl ? <img src={photoUrl} alt="" /> : <span aria-hidden="true">{(name || account.name || '?').trim().charAt(0).toUpperCase()}</span>}
                    <i><Camera size={14} aria-hidden="true" /></i>
                  </button>
                  <input
                    ref={fileIn}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      const sq = await squareJpeg(f);
                      if (sq) {
                        setPhoto(sq);
                        setDirty(true);
                      }
                    }}
                  />
                  <label className="field" style={{ flex: 1, minWidth: 0 }}>
                    <input value={name} maxLength={40} dir="auto" onChange={(e) => { setName(e.target.value); setDirty(true); }} placeholder={t('profile.name')} aria-label={t('profile.name')} />
                  </label>
                </div>
                <textarea className="bio-input" value={bio} maxLength={160} dir="auto" rows={3} onChange={(e) => { setBio(e.target.value); setDirty(true); }} placeholder={t('profile.bio')} aria-label={t('profile.bio')} />
                <div className="acc-actions">
                  <button className="btn btn-sm btn-primary" disabled={!dirty || !!busy} onClick={() => void saveProfile({ name: name.trim(), bio: bio.trim(), avatar: photo })}>{t('common.save')}</button>
                  {photo && <button className="btn btn-sm btn-ghost" onClick={() => { setPhoto(undefined); setDirty(true); }}>{t('profile.removePhoto')}</button>}
                </div>
              </div>
            </>
          )}
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
                  {f.following && <span className="fr-following"><Bell size={13} aria-hidden="true" />{t('follow.on')}</span>}
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
