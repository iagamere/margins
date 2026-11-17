/** Overlays (sheets, dialogs, selection bar) register here so the Android back button / Esc closes the top-most one first. */
const handlers: Array<() => void> = [];

export function pushBackHandler(fn: () => void): () => void {
  handlers.push(fn);
  return () => {
    const i = handlers.lastIndexOf(fn);
    if (i >= 0) handlers.splice(i, 1);
  };
}

export function runTopBackHandler(): boolean {
  const fn = handlers[handlers.length - 1];
  if (!fn) return false;
  fn();
  return true;
}
