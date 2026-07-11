import { useState } from 'react';
import { getThemeMode, setThemeMode, type ThemeMode } from '../shared/theme';

const OPTIONS: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'light', label: 'Svetlý', icon: '☀️' },
  { mode: 'dark', label: 'Tmavý', icon: '🌙' },
  { mode: 'system', label: 'Systém', icon: '⚙️' },
];

/** Nočný režim (ladenie 07/2026) — voľba témy v časti Viac. */
export function ThemeSettings() {
  const [mode, setMode] = useState<ThemeMode>(() => getThemeMode());

  const pick = (next: ThemeMode) => {
    setThemeMode(next);
    setMode(next);
  };

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 font-semibold">Vzhľad</h2>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            onClick={() => pick(o.mode)}
            className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-sm transition ${
              mode === o.mode
                ? 'border-accent bg-accent/10 font-medium text-accent'
                : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
            }`}
          >
            <span className="text-xl">{o.icon}</span>
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        „Systém" sleduje nastavenie svetlého/tmavého režimu tvojho zariadenia.
      </p>
    </section>
  );
}
