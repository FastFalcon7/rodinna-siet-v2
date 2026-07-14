import { useRef, useState } from 'react';

const TRIGGER_PX = 56;
const MAX_PX = 72;

/**
 * Swipe-to-reply (WhatsApp): potiahnutie bubliny doprava spustí odpoveď.
 * Len touch pointer; gesto sa chytí až pri jasne horizontálnom pohybe,
 * aby sa nebilo so scrollom (element potrebuje `touch-action: pan-y`).
 */
export function useSwipeReply(onTrigger: () => void) {
  const [dx, setDx] = useState(0);
  const state = useRef<{ x: number; y: number; captured: boolean } | null>(null);

  const finish = () => {
    if (state.current?.captured && dxRef.current >= TRIGGER_PX) {
      navigator.vibrate?.(10);
      onTrigger();
    }
    state.current = null;
    dxRef.current = 0;
    setDx(0);
  };

  // dx aj v ref-e — pointerup handler by inak videl zastaraný state.
  const dxRef = useRef(0);
  const setDrag = (v: number) => {
    dxRef.current = v;
    setDx(v);
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      // Ľavá edge zóna patrí swipe-back gestu (useSwipeBack, edgeOnly).
      if (e.clientX <= 32) return;
      state.current = { x: e.clientX, y: e.clientY, captured: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = state.current;
      if (!s) return;
      const dxRaw = e.clientX - s.x;
      const dyRaw = e.clientY - s.y;
      if (!s.captured) {
        if (dxRaw > 14 && Math.abs(dxRaw) > Math.abs(dyRaw) * 1.4) {
          s.captured = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } else if (Math.abs(dyRaw) > 14 || dxRaw < -14) {
          state.current = null; // vertikálny scroll / swipe doľava — nechaj tak
        }
        return;
      }
      setDrag(Math.min(Math.max(dxRaw, 0), MAX_PX));
    },
    onPointerUp: finish,
    onPointerCancel: finish,
  };

  return { dx, handlers };
}
