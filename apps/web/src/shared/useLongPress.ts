import { useRef } from 'react';

/**
 * Long-press (touch aj myš) — na mobile nahrádza hover akcie (WhatsApp
 * pattern: podrž bublinu → reakcie/akcie). Pohyb > 10 px gesto zruší,
 * aby sa nebilo so scrollovaním.
 */
export function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (dx * dx + dy * dy > 100) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    /** Po odpálenom long-presse potlač context menu (iOS callout / desktop RMB). */
    onContextMenu: (e: React.MouseEvent) => {
      if (fired.current) e.preventDefault();
    },
  };
}
