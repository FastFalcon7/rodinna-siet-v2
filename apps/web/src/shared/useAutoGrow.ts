import { useLayoutEffect, type RefObject } from 'react';

/**
 * Autogrow textarea (ladenie 07/2026): výška sleduje obsah až po strop
 * (podiel výšky okna) — dlhší text sa nestráca, no pole neprerastie
 * obrazovku (potom skroluje vnútri).
 */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxVh = 45,
): void {
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = Math.round((window.innerHeight * maxVh) / 100);
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
  }, [ref, value, maxVh]);
}
