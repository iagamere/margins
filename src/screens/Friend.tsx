import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Check, Download, RefreshCw } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { downloadShared, friendCover, loadManifest, loadShare, refreshFriend, useShare, type ShareEntry, type ShareManifest } from '../lib/share';
import { formatBytes } from '../lib/utils';

function Thumb({ id }: { id?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (id) void friendCover(id).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id]);
  return <span className="fr-thumb" aria-hidden="true">{url ? <img src={url} alt="" /> : <BookOpen size={20} strokeWidth={1.5} />}</span>;
}

/** A friend's shared library: pick books (or all) and download them together. */
export function FriendScreen({ id }: { id: string }) {
  const { t, n } = useT();
  const books = useApp((s) => s.books);
  const back = useApp((s) => s.back);
  const navigate = useApp((s) => s.navigate);
  const friend = useShare((s) => s.friends.find((f) => f.id === id));
  const [m, setM] = useState<ShareManifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [prog, setProg] = useState<Record<string, number>>({});
  const [working, setWorking] = useState(false);

  const load = async (fresh: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      await loadShare();
      setM(fresh ? await refreshFriend(id) : await loadManifest(id));
    } catch (e) {
      setErr((e as { message?: string })?.message || String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(false);
  }, [id]);

  const goBack = () => {
    if (!back()) navigate({ name: 'account' }, { replace: true });
  };
  const owned = useMemo(() => new Set(books.map((b) => b.hash)), [books]);
  const list = m?.books ?? [];
  const free = list.filter((e) => !owned.has(e.h));
  const toggle = (h: string) =>
    setSel((cur) => {
      const next = new Set(cur);
      if (next.has(h)) next.delete(h);
      else next.add(h);
      return next;
    });
  const allSel = free.length > 0 && free.every((e) => sel.has(e.h));

  const run = async (entries: ShareEntry[]) => {
    if (!entries.length || working) return;
    setWorking(true);
    setSel(new Set());
    try {
      await downloadShared(entries, (h, p) =>
        setProg((cur) => {
          const next = { ...cur };
          if (p === null) delete next[h];
          else next[h] = p;
          return next;
        }),
      );
    } finally {
      setWorking(false);
    }
  };
  const picked = free.filter((e) => sel.has(e.h));

  return (
    <div className="screen">
      <div className="screen-pad" style={{ maxWidth: 720, paddingBottom: 120 }}>
        <header className="page-head">
          <div style={{ marginInline: -10, marginBottom: -6 }}>
            <button className="icon-btn" onClick={goBack} aria-label={t('common.back')}>
              <ArrowLeft className="flip" size={22} />
            </button>
          </div>
          <div className="top">
            <h1 className="h-display long" dir="auto">{t('friends.of', { name: m?.name || friend?.name || t('friends.noName') })}</h1>
            <div className="row top-actions">
              <button className="icon-btn" disabled={loading || working} onClick={() => void load(true)} aria-label={t('friends.refresh')} title={t('friends.refresh')}>
                <RefreshCw size={21} className={loading ? 'spin' : undefined} />
              </button>
            </div>
          </div>
        </header>

        {err && <p className="acc-error" dir="auto">{t('friends.fail', { msg: err })}</p>}
        {!err && m && list.length === 0 && <p className="hint muted">{t('friends.emptyLib')}</p>}

        {free.length > 0 && (
          <div className="row" style={{ gap: 8, margin: '4px 0 12px', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" disabled={working} onClick={() => void run(free)}>
              <Download size={17} aria-hidden="true" />
              {t('friends.downloadAll', { count: n(free.length) })}
            </button>
            <button className="btn btn-sm btn-ghost" disabled={working} onClick={() => setSel(allSel ? new Set() : new Set(free.map((e) => e.h)))}>
              {allSel ? t('select.none') : t('select.all')}
            </button>
          </div>
        )}

        <div className="fr-list">
          {list.map((e) => {
            const have = owned.has(e.h);
            const on = sel.has(e.h);
            const p = prog[e.h];
            return (
              <button key={e.h} className={'fr-row' + (on ? ' sel' : '')} disabled={have || working} aria-pressed={have ? undefined : on} onClick={() => toggle(e.h)}>
                <Thumb id={e.cover} />
                <span className="fr-meta">
                  <span className="fr-title clamp2" dir="auto">{e.t}</span>
                  {e.a && <span className="hint clamp1" dir="auto">{e.a}</span>}
                  <span className="hint">{e.f.toUpperCase()} · {formatBytes(e.s)}</span>
                  {p !== undefined && <span className="fr-bar"><i style={{ width: `${Math.round(p * 100)}%` }} /></span>}
                </span>
                {have ? (
                  <span className="hint fr-have"><Check size={15} aria-hidden="true" /> {t('friends.owned')}</span>
                ) : (
                  <span className={'sel-mark' + (on ? ' on' : '')} aria-hidden="true">{on && <Check size={15} strokeWidth={3} />}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {picked.length > 0 && (
        <div className="paste-bar" role="status" style={{ bottom: 'calc(var(--safe-b) + 16px)' }}>
          <span>{t('select.count', { count: n(picked.length) })}</span>
          <button className="btn btn-primary btn-sm" disabled={working} onClick={() => void run(picked)}>
            <Download size={17} aria-hidden="true" />
            {t('friends.downloadSel')}
          </button>
        </div>
      )}
    </div>
  );
}
