import { useState } from 'react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { fetchBook, LinkError, parseBookLink } from '../lib/links';
import { openExternal } from '../lib/platform';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Shown when Margins is opened from a book link (Drive / direct) or a link is shared to it.
 * Optional by design: the person can add the book here, or send the link on to Google Drive.
 */
export function LinkImportDialog() {
  const { t, n } = useT();
  const url = useApp((s) => s.incomingLink);
  const setIncomingLink = useApp((s) => s.setIncomingLink);
  const importFiles = useApp((s) => s.importFiles);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!url) return null;
  const link = parseBookLink(url);
  if (!link) return null;

  const close = () => {
    if (busy) return;
    setError(null);
    setPct(null);
    setIncomingLink(null);
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    setPct(0);
    try {
      const file = await fetchBook(link, setPct);
      await importFiles([file]);
      setBusy(false);
      setPct(null);
      setIncomingLink(null);
    } catch (e) {
      setBusy(false);
      setPct(null);
      const code = e instanceof LinkError ? e.code : 'failed';
      setError(code === 'notPublic' ? t('link.notPublic') : code === 'notBook' ? t('link.notBook') : t('link.failed', { msg: (e as Error).message }));
    }
  };

  return (
    <ConfirmDialog
      title={t('link.title')}
      body={busy ? t('link.downloading') : t('link.body')}
      confirmLabel={busy ? '…' : error ? t('link.retry') : t('link.import')}
      onConfirm={() => void (busy ? undefined : add())}
      onCancel={close}
    >
      {busy && (
        <div style={{ margin: '4px 0 12px' }} role="progressbar" aria-valuenow={pct === null ? undefined : Math.round(pct * 100)}>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ height: 6, width: pct === null ? '35%' : `${Math.max(4, Math.round(pct * 100))}%`, background: 'var(--accent)', transition: 'width 200ms' }} />
          </div>
          {pct !== null && <div className="hint muted" style={{ marginTop: 6, fontSize: 13 }}>{n(Math.round(pct * 100))}%</div>}
        </div>
      )}
      {error && <p style={{ color: 'var(--danger, #c0463a)', fontSize: 14, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{error}</p>}
      {!busy && (
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start', marginBottom: 10 }} onClick={() => void openExternal(link.url).then(close)}>
          {t('link.openDrive')}
        </button>
      )}
    </ConfirmDialog>
  );
}
