import { Cloud, CloudUpload, Download } from 'lucide-react';
import type { BookRecord } from '../lib/types';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { downloadBookFromDrive, queueUpload } from '../lib/cloud';

/** Stops the card behind (tap / long-press) from reacting to the badge. */
const quiet = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onPointerUp: (e: React.PointerEvent) => e.stopPropagation(),
  onContextMenu: (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  },
};

function Ring({ pct }: { pct: number }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r={r} fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.4" />
      <circle cx="13" cy="13" r={r} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.04, pct))} transform="rotate(-90 13 13)" />
    </svg>
  );
}

/**
 * The cloud icon of a book. `corner` sits on the top-start corner of the cover (covers and cards views),
 * `inline` sits at the end of a row (names view). Nothing is drawn for a book that is only on this device
 * while signed out, nor for a book that is both here and in Drive.
 */
export function CloudBadge({ book, variant = 'corner' }: { book: BookRecord; variant?: 'corner' | 'inline' }) {
  const { t, n } = useT();
  const account = useApp((s) => s.account);
  const tr = useApp((s) => s.transfers[book.id]);
  if (!account && !book.remoteOnly) return null;

  let icon: React.ReactNode = null;
  let label = '';
  let act: (() => void) | undefined;
  if (tr) {
    icon = <Ring pct={tr.pct} />;
    label = `${t(tr.kind === 'up' ? 'cloud.uploading' : 'cloud.downloading')} ${n(Math.round(tr.pct * 100))}%`;
  } else if (book.remoteOnly) {
    icon = <Download size={17} strokeWidth={2.2} />;
    label = t('cloud.download');
    act = () => void downloadBookFromDrive(book.id);
  } else if (!book.cloudId) {
    icon = <CloudUpload size={17} strokeWidth={2} />;
    label = t('cloud.upload');
    act = () => queueUpload(book.id);
  } else {
    return variant === 'inline' ? <Cloud className="cloud-ok" size={15} aria-label={t('cloud.inDrive')} /> : null;
  }

  return (
    <span
      className={'cloud-badge ' + variant + (tr ? ' busy' : '')}
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      {...quiet}
      onClick={(e) => {
        e.stopPropagation();
        act?.();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && act) {
          e.preventDefault();
          e.stopPropagation();
          act();
        }
      }}
    >
      {icon}
    </span>
  );
}
