import { Check, Plus } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { Sheet } from './Sheet';

/** "Move to shelf" list: no shelf, every shelf, or a brand-new one. `current` = false hides the check mark. */
export function ShelfSheet({ current, onPick, onNew, onClose }: {
  current: string | undefined | false;
  onPick: (shelfId: string | undefined) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const shelves = useApp((s) => s.shelves);
  const rows = [{ id: undefined as string | undefined, name: t('shelf.none') }, ...shelves];
  return (
    <Sheet title={t('shelf.moveTo')} onClose={onClose}>
      <div className="list">
        {rows.map((x) => {
          const on = current !== false && current === x.id;
          return (
            <button key={x.id ?? 'none'} className="toc-item" style={{ minHeight: 52 }} onClick={() => onPick(x.id)}>
              <span dir="auto" style={{ flex: 1, fontWeight: on ? 600 : 400, color: on ? 'var(--accent-ink)' : undefined }}>{x.name}</span>
              {on && <Check size={18} aria-hidden="true" />}
            </button>
          );
        })}
        <button className="toc-item" style={{ minHeight: 52, color: 'var(--accent-ink)' }} onClick={onNew}>
          <Plus size={18} aria-hidden="true" />
          <span>{t('shelf.new')}</span>
        </button>
      </div>
    </Sheet>
  );
}
