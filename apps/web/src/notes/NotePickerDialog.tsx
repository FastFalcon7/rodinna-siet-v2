import { useEffect, useState } from 'react';
import type { NoteSummary } from '@rodinna/shared-types';
import { ApiError, notesApi } from '../lib/api';

interface NotePickerDialogProps {
  /** Fotky, ktoré sa majú pridať do poznámky/zoznamu. */
  mediaIds: string[];
  onClose: () => void;
}

/**
 * „Do poznámky" (ladenie 07/2026): výber existujúcej poznámky/zoznamu
 * alebo vytvorenie novej poznámky s vybranými fotkami.
 */
export function NotePickerDialog({ mediaIds, onClose }: NotePickerDialogProps) {
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    notesApi
      .list()
      .then((r) => setNotes(r.notes))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Načítanie poznámok zlyhalo'));
  }, []);

  const finish = (title: string) => {
    setSavedTo(title);
    setTimeout(onClose, 1200);
  };

  const saveTo = async (note: NoteSummary) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await notesApi.addMedia(note.id, mediaIds);
      finish(note.title);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uloženie zlyhalo');
      setBusy(false);
    }
  };

  const createAndSave = async () => {
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      await notesApi.create({ kind: 'note', visibility: 'private', title, bodyMd: '', items: [], mediaIds, roomIds: [] });
      finish(title);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Poznámku sa nepodarilo vytvoriť');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <h3 className="mb-3 font-semibold">Pridať do poznámky</h3>

        {savedTo ? (
          <p className="py-6 text-center text-sm">
            ✓ Pridané do <strong>{savedTo}</strong>
          </p>
        ) : (
          <>
            {!notes && !error && <p className="py-4 text-sm text-neutral-500">Načítavam…</p>}

            {notes && notes.length > 0 && (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {notes.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void saveTo(n)}
                      disabled={busy}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
                    >
                      <span className="text-lg">{n.kind === 'list' ? '✅' : '📝'}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {notes?.length === 0 && (
              <p className="py-2 text-sm text-neutral-500">Zatiaľ žiadne poznámky — vytvor prvú nižšie.</p>
            )}

            {creating ? (
              <div className="mt-3 flex gap-2">
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void createAndSave()}
                  autoFocus
                  maxLength={120}
                  placeholder="Názov poznámky"
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700"
                />
                <button
                  type="button"
                  onClick={() => void createAndSave()}
                  disabled={!newTitle.trim() || busy}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Vytvoriť
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                disabled={busy}
                className="mt-3 w-full rounded-xl border border-dashed border-neutral-300 px-4 py-2.5 text-sm text-neutral-500 transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-neutral-700"
              >
                + Nová poznámka
              </button>
            )}

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
