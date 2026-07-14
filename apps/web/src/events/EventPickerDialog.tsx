import { useEffect, useState } from 'react';
import type { EventPublic } from '@rodinna/shared-types';
import { ApiError, eventsApi } from '../lib/api';
import { eventTimeText } from './EventCard';

interface EventPickerDialogProps {
  /** Fotky, ktoré sa majú pridať do udalosti. */
  mediaIds: string[];
  onClose: () => void;
}

/**
 * „Do udalosti" (ladenie 07/2026): výber nadchádzajúcej udalosti alebo
 * vytvorenie novej (názov + dátum) s vybranými fotkami.
 */
export function EventPickerDialog({ mediaIds, onClose }: EventPickerDialogProps) {
  const [events, setEvents] = useState<EventPublic[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    eventsApi
      .agenda()
      .then((r) => setEvents(r.events))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Načítanie udalostí zlyhalo'));
  }, []);

  const finish = (title: string) => {
    setSavedTo(title);
    setTimeout(onClose, 1200);
  };

  const saveTo = async (event: EventPublic) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await eventsApi.addMedia(event.id, mediaIds);
      finish(event.title);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uloženie zlyhalo');
      setBusy(false);
    }
  };

  const createAndSave = async () => {
    const title = newTitle.trim();
    if (!title || !date || busy) return;
    setBusy(true);
    setError(null);
    try {
      await eventsApi.create({
        title,
        startsAt: new Date(`${date}T00:00:00Z`).toISOString(),
        allDay: true,
        location: '',
        bodyMd: '',
        toFeed: false,
        rsvp: false,
        mediaIds,
        visibility: 'family',
        roomIds: [],
      });
      finish(title);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Udalosť sa nepodarilo vytvoriť');
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
        <h3 className="mb-3 font-semibold">Pridať do udalosti</h3>

        {savedTo ? (
          <p className="py-6 text-center text-sm">
            ✓ Pridané do <strong>{savedTo}</strong>
          </p>
        ) : (
          <>
            {!events && !error && <p className="py-4 text-sm text-neutral-500">Načítavam…</p>}

            {events && events.length > 0 && (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {events.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => void saveTo(e)}
                      disabled={busy}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
                    >
                      <span className="text-lg">📅</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{e.title}</span>
                        <span className="block text-xs text-neutral-500">{eventTimeText(e)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {events?.length === 0 && (
              <p className="py-2 text-sm text-neutral-500">
                Žiadne nadchádzajúce udalosti — vytvor novú nižšie.
              </p>
            )}

            {creating ? (
              <div className="mt-3 space-y-2">
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  autoFocus
                  maxLength={140}
                  placeholder="Názov udalosti"
                  className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700"
                />
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-neutral-700"
                  />
                  <button
                    type="button"
                    onClick={() => void createAndSave()}
                    disabled={!newTitle.trim() || !date || busy}
                    className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                  >
                    Vytvoriť
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                disabled={busy}
                className="mt-3 w-full rounded-xl border border-dashed border-neutral-300 px-4 py-2.5 text-sm text-neutral-500 transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-neutral-700"
              >
                + Nová udalosť
              </button>
            )}

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
