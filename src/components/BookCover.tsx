import { useEffect, useState, type ReactNode } from 'react';
import type { BookRecord } from '../lib/types';
import { hashIndex } from '../lib/utils';

export const PALETTE = ['#6f7a62', '#8a6f55', '#5c6b73', '#7d5f66', '#4f6359', '#8c7a4f', '#5f5a73', '#76604a'];

export function useObjectUrl(blob?: Blob): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function BookCover({ book, big = false, showFormat = false, badge }: { book: BookRecord; big?: boolean; showFormat?: boolean; badge?: ReactNode }) {
  const url = useObjectUrl(book.cover);
  const [broken, setBroken] = useState(false);
  const bg = PALETTE[hashIndex(book.id, PALETTE.length)];
  return (
    <div className="cover" style={{ background: url && !broken ? undefined : book.coverColor ?? bg }}>
      {url && !broken ? (
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} draggable={false} />
      ) : (
        <div className={'cover-ph' + (big ? ' big' : '')} dir="auto">
          <div>
            <div className="rule" />
            <div className="t">{book.title}</div>
          </div>
          {book.author && <div className="a clamp1">{book.author}</div>}
        </div>
      )}
      {showFormat && <span className="cover-fmt">{book.format.toUpperCase()}</span>}
      {badge}
    </div>
  );
}
