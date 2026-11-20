import { Library as ShelfIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { LibraryView, ShelfRecord } from '../lib/types';
import { useT } from '../lib/i18n';
import { ShelfImage } from './ShelfDialog';

/** One shelf, drawn for the library's current view (covers · cards · names). */
export function ShelfItem({ shelf, view, count, onOpen }: { shelf: ShelfRecord; view: LibraryView; count: number; onOpen: () => void }) {
  const { t, n } = useT();
  const countText = count === 1 ? t('shelf.one') : t('shelf.count', { count: n(count) });
  const tint = shelf.color ? ({ ['--shelf' as string]: shelf.color } as CSSProperties) : undefined;

  if (view === 'names') {
    return (
      <button className={'view-name' + (shelf.color ? ' tinted' : '')} style={tint} onClick={onOpen} aria-label={shelf.name}>
        {shelf.color ? <i className="shelf-dot" style={{ background: shelf.color }} aria-hidden="true" /> : <ShelfIcon size={17} strokeWidth={1.6} aria-hidden="true" />}
        <span className="nm clamp1" dir="auto">{shelf.name}</span>
      </button>
    );
  }

  if (view === 'cards') {
    return (
      <button className={'view-card shelf-row' + (shelf.color ? ' tinted' : '')} style={tint} onClick={onOpen} aria-label={shelf.name}>
        {shelf.image ? (
          <div className="shelf-mini" style={{ aspectRatio: shelf.ratio === '1:1' ? '1 / 1' : '2 / 3' }}>
            <ShelfImage blob={shelf.image} />
          </div>
        ) : (
          <div className="shelf-mini none"><ShelfIcon size={24} strokeWidth={1.4} aria-hidden="true" /></div>
        )}
        <div className="meta">
          <div className="title clamp2" dir="auto">{shelf.name}</div>
          <div className="author">{countText}</div>
        </div>
      </button>
    );
  }

  return (
    <button
      className={'shelf-tile' + (shelf.color ? ' tinted' : '') + (shelf.image ? ' has-img' : '')}
      style={{ ...tint, ...(shelf.image ? { aspectRatio: shelf.ratio === '1:1' ? '1 / 1' : '2 / 3' } : null) }}
      onClick={onOpen}
      aria-label={shelf.name}
    >
      {shelf.image ? <ShelfImage blob={shelf.image} /> : <ShelfIcon size={26} strokeWidth={1.4} aria-hidden="true" />}
      <div className="name clamp2" dir="auto">{shelf.name}</div>
      <div className="count">{countText}</div>
    </button>
  );
}
