import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useApp } from '../store/useApp';

export interface FilePickerHandle {
  open(): void;
}

/** Hidden multi-file input shared by every "Add book" entry point. */
export const FilePicker = forwardRef<FilePickerHandle, { onImported?: (id: string | null) => void; shelfId?: string }>(function FilePicker({ onImported, shelfId }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const importFiles = useApp((s) => s.importFiles);
  useImperativeHandle(ref, () => ({ open: () => input.current?.click() }));
  return (
    <input
      ref={input}
      type="file"
      multiple
      hidden
      accept=".epub,.pdf,application/epub+zip,application/pdf"
      onChange={async (e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        const last = await importFiles(files, shelfId);
        onImported?.(last?.id ?? null);
      }}
    />
  );
});
