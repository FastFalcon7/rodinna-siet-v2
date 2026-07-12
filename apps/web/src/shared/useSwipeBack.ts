import { useRef } from 'react';

/**
 * Swipe doprava = späť (ladenie 07/2026): v nainštalovanej PWA na iOS
 * chýba systémové back gesto, tak si ho appka rieši sama. Hook vracia touch
 * handlery — pripni ich na koreňový element detail obrazovky (album,
 * konverzácia, modul z Viac…). Gesto sa spúšťa až pri jasne horizontálnom
 * ťahu doprava, aby sa nebilo s vertikálnym scrollom ani so swipe-to-reply
 * (to štartuje z bubliny a chytí pointer skôr).
 */
/** Šírka ľavej „edge" zóny (px) pre edgeOnly režim — zladené s useSwipeReply. */
export const SWIPE_BACK_EDGE_PX = 32;

export function useSwipeBack(onBack: () => void, opts: { edgeOnly?: boolean } = {}) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]!;
      // edgeOnly: gesto štartuje len od ľavého okraja (chat — bubliny majú
      // vlastný swipe-to-reply, ktorý edge zónu naopak ignoruje).
      if (opts.edgeOnly && t.clientX > SWIPE_BACK_EDGE_PX) return;
      start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches[0]!;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      // Rýchly, výrazne horizontálny ťah doprava (do 800 ms).
      if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - s.t < 800) {
        onBack();
      }
    },
  };
}
