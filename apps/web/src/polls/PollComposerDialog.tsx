import { useState } from 'react';
import {
  MAX_POLL_OPTION,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION,
  type PollPublic,
} from '@rodinna/shared-types';
import { ApiError, pollsApi } from '../lib/api';

/**
 * Dialóg tvorby ankety (M1) — spoločný pre Feed composer (toFeed=true)
 * aj chat [+] sheet (volajúci pošle app://polls/<id> správu).
 */

const DEADLINES: { label: string; hours: number | null }[] = [
  { label: 'Bez konca', hours: null },
  { label: '1 hodina', hours: 1 },
  { label: '4 hodiny', hours: 4 },
  { label: '24 hodín', hours: 24 },
  { label: '3 dni', hours: 72 },
];

export function PollComposerDialog({
  toFeed,
  onCreated,
  onClose,
}: {
  /** true = karta ide rovno do Feedu; false = volajúci ju zdieľa sám (chat). */
  toFeed: boolean;
  onCreated: (poll: PollPublic) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setOption = (i: number, v: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  const removeOption = (i: number) => setOptions((prev) => prev.filter((_, idx) => idx !== i));

  const validOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSubmit = question.trim().length > 0 && validOptions.length >= 2 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const poll = await pollsApi.create({
        question: question.trim(),
        kind: multi ? 'multi' : 'single',
        anonymous,
        closesAt: deadline ? new Date(Date.now() + deadline * 3_600_000).toISOString() : null,
        options: validOptions,
        toFeed,
      });
      onCreated(poll);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Anketu sa nepodarilo vytvoriť');
      setBusy(false);
    }
  };

  return (
    // Zámerne div, nie <form> — dialóg sa renderuje aj vnútri composer formu
    // (PostComposer) a vnorené formy sú nevalidné HTML (submit by šiel von).
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <h2 className="font-semibold">📊 Nová anketa</h2>

        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={MAX_POLL_QUESTION}
          autoFocus
          placeholder="Otázka (napr. Kde bude nedeľný obed?)"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
        />

        <div className="space-y-1.5">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={o}
                onChange={(e) => setOption(i, e.target.value)}
                maxLength={MAX_POLL_OPTION}
                placeholder={`Možnosť ${i + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  aria-label="Odstrániť možnosť"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < MAX_POLL_OPTIONS && (
            <button
              type="button"
              onClick={() => setOptions((prev) => [...prev, ''])}
              className="text-sm text-accent hover:underline"
            >
              + Pridať možnosť
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="accent-accent" />
            Viac možností
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="accent-accent" />
            Anonymná
          </label>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-neutral-500">Koniec hlasovania</p>
          <div className="flex flex-wrap gap-1.5">
            {DEADLINES.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => setDeadline(d.hours)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  deadline === d.hours
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Zrušiť
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Vytváram…' : 'Vytvoriť anketu'}
          </button>
        </div>
      </div>
    </div>
  );
}
