/**
 * Nočný režim (ladenie 07/2026): Svetlý / Tmavý / Systém. Voľba žije v
 * localStorage, aplikuje sa ako data-theme="light|dark" na <html> (na to sú
 * naviazané design tokeny aj Tailwind dark: variant). „Systém" = bez kľúča
 * v localStorage, sleduje prefers-color-scheme aj za behu. Prvotné
 * nastavenie pred paint-om rieši inline skript v index.html (žiadny flash).
 */

export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'rs-theme';
const mq = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemeMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

function resolve(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode;
}

function apply(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolve(mode);
}

export function setThemeMode(mode: ThemeMode): void {
  if (mode === 'system') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, mode);
  apply(mode);
}

/** Volá sa raz pri štarte appky (main.tsx). */
export function initTheme(): void {
  apply(getThemeMode());
  mq.addEventListener('change', () => {
    if (getThemeMode() === 'system') apply('system');
  });
}
