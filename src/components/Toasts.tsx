import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';

export function Toasts({ inReader = false }: { inReader?: boolean }) {
  const toasts = useApp((s) => s.toasts);
  const { t } = useT();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite" style={inReader ? { bottom: 'calc(var(--safe-b) + 90px)', zIndex: 120 } : undefined}>
      {toasts.map((x) => (
        <div key={x.id} className={'toast ' + x.kind} dir="auto">
          {t(x.key, x.params)}
        </div>
      ))}
    </div>
  );
}

export function ImportBanner() {
  const importing = useApp((s) => s.importing);
  const { t, n } = useT();
  if (!importing) return null;
  return (
    <div className="import-banner" role="status" aria-live="polite">
      <div className="spinner" />
      <span>{t('import.importing', { done: n(Math.min(importing.done + 1, importing.total)), total: n(importing.total) })}</span>
    </div>
  );
}
