import { useRef, useState } from 'react';
import {
  MAX_POLL_OPTION,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION,
  type PollPublic,
} from '@rodinna/shared-types';
import { ApiError, mediaApi, pollsApi } from '../lib/api';

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
  interface OptionDraft {
    label: string;
    /** Lokálny náhľad + nahraté id fotky možnosti (ladenie 07/2026). */
    mediaId: string | null;
    previewUrl: string | null;
    uploading: boolean;
  }
  const emptyOption = (): OptionDraft => ({ label: '', mediaId: null, previewUrl: null, uploading: false });

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<OptionDraft[]>([emptyOption(), emptyOption()]);
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  const patchOption = (i: number, p: Partial<OptionDraft>) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...p } : o)));
  const removeOption = (i: number) => setOptions((prev) => prev.filter((_, idx) => idx !== i));

  const attachPhoto = (i: number, file: File) => {
    patchOption(i, { previewUrl: URL.createObjectURL(file), uploading: true, mediaId: null });
    void mediaApi
      .upload(file)
      .then((m) => patchOption(i, { mediaId: m.id, uploading: false }))
      .catch(() => {
        patchOption(i, { previewUrl: null, uploading: false });
        setError('Fotku sa nepodarilo nahrať');
      });
  };

  const validOptions = options
    .map((o) => ({ label: o.label.trim(), mediaId: o.mediaId }))
    .filter((o) => o.label.length > 0);
  const uploading = options.some((o) => o.uploading);
  const canSubmit = question.trim().length > 0 && validOptions.length >= 2 && !busy && !uploading;

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
              {/* Fotka možnosti: náhľad alebo tlačidlo na výber. */}
              {o.previewUrl ? (
                <button
                  type="button"
                  onClick={() => patchOption(i, { previewUrl: null, mediaId: null })}
                  title="Odstrániť fotku"
                  className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg"
                >
                  <img src={o.previewUrl} alt="" className="h-full w-full object-cover" />
                  {o.uploading && (
                    <span className="absolute inset-0 grid place-items-center bg-black/45 text-[9px] font-semibold text-white">
                      …
                    </span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRefs.current[i]?.click()}
                  title="Pridať fotku k možnosti"
                  aria-label="Pridať fotku k možnosti"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-dashed border-neutral-300 text-neutral-400 hover:border-accent hover:text-accent dark:border-neutral-700"
                >
                  📷
                </button>
              )}
              <input
                ref={(el) => {
                  fileRefs.current[i] = el;
                }}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) attachPhoto(i, f);
                }}
              />
              <input
                value={o.label}
                onChange={(e) => patchOption(i, { label: e.target.value })}
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
              onClick={() => setOptions((prev) => [...prev, emptyOption()])}
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
