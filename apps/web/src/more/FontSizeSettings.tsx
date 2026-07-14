import { useState } from 'react';
import { getFontSizeMode, setFontSizeMode, type FontSizeMode } from '../shared/fontSize';

const OPTIONS: { mode: FontSizeMode; label: string; sample: string }[] = [
  { mode: 'normal', label: 'Normálne', sample: 'Aa' },
  { mode: 'large', label: 'Väčšie', sample: 'Aa' },
  { mode: 'xlarge', label: 'Najväčšie', sample: 'Aa' },
];

/** Veľkosť písma (ladenie 07/2026) — voľba v časti Viac, škáluje celú appku. */
export function FontSizeSettings() {
  const [mode, setMode] = useState<FontSizeMode>(() => getFontSizeMode());

  const pick = (next: FontSizeMode) => {
    setFontSizeMode(next);
    setMode(next);
  };

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 font-semibold">Veľkosť písma</h2>
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
            <span
              className="leading-none"
              style={{ fontSize: o.mode === 'normal' ? '1rem' : o.mode === 'large' ? '1.2rem' : '1.4rem' }}
            >
              {o.sample}
            </span>
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
