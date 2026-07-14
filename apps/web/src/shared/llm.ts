import { useSyncExternalStore } from 'react';
import { ApiError } from '../lib/api';

/**
 * AI funkcie (ladenie 07/2026): Kvízy, Denník a otázka dňa/týždňa. Zapína ich
 * VÝHRADNE admin — je to GLOBÁLNE serverové nastavenie (app_settings), nie
 * per zariadenie. Predvolene VYPNUTÉ (výstupy sa ešte ladia). Klient si drží
 * poslednú načítanú hodnotu; admin ju mení cez PUT /api/settings/ai.
 */

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

let enabled = false;
const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}

/** Načíta stav zo servera (volá sa po prihlásení). */
export async function loadAiSettings(): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/settings`, { credentials: 'include' });
    if (!res.ok) return;
    const data = (await res.json()) as { aiEnabled?: boolean };
    enabled = data.aiEnabled === true;
    emit();
  } catch {
    /* offline → ponechaj predchádzajúci stav */
  }
}

/** Admin: zapne/vypne AI funkcie pre celú rodinu. */
export async function setLlmEnabled(on: boolean): Promise<void> {
  const res = await fetch(`${API_URL}/settings/ai`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: on }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, data.error ?? `Chyba ${res.status}`);
  }
  enabled = on;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reaktívna verzia pre komponenty (More, CommandPalette…). */
export function useLlmEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}
