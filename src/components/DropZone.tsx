import { useEffect, useState } from 'react';
import { FileUp } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';

/** Desktop drag & drop import, active anywhere outside the reader. */
export function DropZone() {
  const [over, setOver] = useState(false);
  const importFiles = useApp((s) => s.importFiles);
  const { t } = useT();
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!has(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const overFn = (e: DragEvent) => has(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      void importFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, [importFiles]);
  if (!over) return null;
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="row">
        <FileUp size={28} />
        <span>{t('import.drop')}</span>
      </div>
    </div>
  );
}
