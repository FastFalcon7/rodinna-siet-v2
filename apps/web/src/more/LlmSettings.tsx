import { setLlmEnabled, useLlmEnabled } from '../shared/llm';

/**
 * Vypínač AI funkcií (ladenie 07/2026): Kvízy a Denník (otázka dňa) bežia
 * na lokálnom LLM, ktorého výstupy sa ešte ladia — predvolene vypnuté.
 */
export function LlmSettings() {
  const enabled = useLlmEnabled();

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-semibold">AI funkcie</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Kvízy a Denník (otázka dňa) — zatiaľ v ladení, predvolene vypnuté.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setLlmEnabled(!enabled)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${
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
    </section>
  );
}
