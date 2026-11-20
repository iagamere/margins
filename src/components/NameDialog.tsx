import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { useT } from '../lib/i18n';

/** Small "type a name" dialog (new / rename shelf). */
export function NameDialog({ title, initial = '', confirmLabel, onSubmit, onCancel }: {
  title: string;
  initial?: string;
  confirmLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(initial);
  const submit = () => {
    if (name.trim()) onSubmit(name.trim());
  };
  return (
    <ConfirmDialog title={title} confirmLabel={confirmLabel} onConfirm={submit} onCancel={onCancel}>
      <input
        className="name-input"
        autoFocus
        value={name}
        maxLength={60}
        dir="auto"
        placeholder={t('shelf.namePlaceholder')}
        aria-label={t('shelf.namePlaceholder')}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
    </ConfirmDialog>
  );
}
