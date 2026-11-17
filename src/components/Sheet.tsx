import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { pushBackHandler } from '../lib/backStack';
import { useT } from '../lib/i18n';

export function Sheet({ title, onClose, children, tabs }: { title: string; onClose: () => void; children: ReactNode; tabs?: ReactNode }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = pushBackHandler(onClose);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    ref.current?.focus();
    return () => {
      off();
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={22} />
          </button>
        </div>
        {tabs && <div className="sheet-tabs">{tabs}</div>}
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}
