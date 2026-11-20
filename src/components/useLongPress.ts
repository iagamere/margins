import { useRef } from 'react';

/**
 * Long-press (≈0.45 s, finger kept still) vs. normal tap on the same element.
 * Spread the returned props on the button; `onTap` runs for a normal click only.
 */
export function useLongPress(onLong: () => void, onTap: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        try {
          navigator.vibrate?.(15);
        } catch {
          /* not supported */
        }
        onLong();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      onTap();
    },
  };
}
