import { useState } from 'react';
import { ApiError } from '../lib/api';
import { setLlmEnabled, useLlmEnabled } from '../shared/llm';

/**
 * Vypínač AI funkcií (ladenie 07/2026): Kvízy, Denník (otázka dňa) a otázka
 * dňa/týždňa vo Feede. Je to GLOBÁLNE nastavenie pre celú rodinu — mení ho
 * len admin (túto kartu vidí iba admin). Predvolene vypnuté (výstupy sa ladia).
 */
export function LlmSettings() {
  const enabled = useLlmEnabled();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setLlmEnabled(!enabled);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Zmena zlyhala');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-semibold">AI funkcie</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Kvízy, Denník a otázka dňa/týždňa — platí pre celú rodinu, zatiaľ v ladení.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={busy}
          onClick={() => void toggle()}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${
            enabled ? 'bg-accent' : 'bg-neutral-300 dark:bg-neutral-700'
          }`}
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
              enabled ? 'left-[calc(100%-1.625rem)]' : 'left-0.5'
            }`}
          />
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
