import { useEffect, type ReactNode } from 'react';
import { pushBackHandler } from '../lib/backStack';
import { useT } from '../lib/i18n';

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const { t } = useT();
  useEffect(() => {
    const off = pushBackHandler(onCancel);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      off();
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <div className="scrim top" onClick={onCancel} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {body && <p>{body}</p>}
        {children}
        <div className="actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className={'btn ' + (danger ? 'btn-danger' : 'btn-primary')} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
