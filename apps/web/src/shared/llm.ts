import { useSyncExternalStore } from 'react';

/**
 * LLM vypínač (ladenie 07/2026): funkcie postavené na lokálnom LLM (Kvízy,
 * Denník s otázkou dňa) sú predvolene VYPNUTÉ — výstupy sa ešte ladia.
 * Voľba žije v localStorage (per zariadenie), prepína sa v časti Viac.
 */

const KEY = 'rs-llm-enabled';
const EVT = 'rs-llm-change';

export function isLlmEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setLlmEnabled(on: boolean): void {
  if (on) localStorage.setItem(KEY, '1');
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Reaktívna verzia pre komponenty (More, CommandPalette…). */
export function useLlmEnabled(): boolean {
  return useSyncExternalStore(subscribe, isLlmEnabled);
}
