import { useEffect, useState } from 'react';
import { eventsApi } from '../lib/api';

/**
 * Odber kalendára v Apple/Google Calendar (ladenie 07/2026): presunuté zo
 * spodku obrazovky Kalendár do „Viac" (pri profile) — na obrazovke Kalendár
 * zaberalo miesto, používa sa raz pri nastavení zariadenia.
 */
export function CalendarSubscription() {
  const [icsUrl, setIcsUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void eventsApi.icsUrl().then((r) => setIcsUrl(r.url)).catch(() => {});
  }, []);

  if (!icsUrl) return null;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="mb-1 text-sm font-semibold">📅 Odber v Apple/Google Calendar</h3>
      <p className="mb-2 text-xs text-neutral-500">
        Pridaj túto URL ako odoberaný kalendár — rodinné udalosti, narodeniny aj tvoje súkromné
        a skupinové udalosti sa objavia v tvojej kalendárovej appke (len na čítanie). Odkaz je
        osobný — nezdieľaj ho.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={icsUrl}
          onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
        />
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(icsUrl).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {copied ? '✓' : 'Kopírovať'}
        </button>
      </div>
    </section>
  );
}
