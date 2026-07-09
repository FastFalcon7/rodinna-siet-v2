import { useState } from 'react';
import { MAX_EVENT_LOCATION, MAX_EVENT_TITLE, type EventPublic } from '@rodinna/shared-types';
import { ApiError, eventsApi } from '../lib/api';

/**
 * Dialóg tvorby udalosti pre chat [+] sheet (M4 doplnok): rovnaký vzor ako
 * PollComposerDialog (M1) — toFeed=false, volajúci pošle app://events/<id>
 * správu len do konkrétnej miestnosti namiesto karty do celorodinného Feedu.
 */
export function EventComposerDialog({
  onCreated,
  onClose,
}: {
  onCreated: (event: EventPublic) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('17:00');
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && date.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const startsAt = allDay
        ? new Date(`${date}T00:00:00Z`).toISOString()
        : new Date(`${date}T${time}:00`).toISOString();
      const event = await eventsApi.create({
        title: title.trim(),
        startsAt,
        allDay,
        location: location.trim(),
        bodyMd: '',
        toFeed: false,
      });
      onCreated(event);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Udalosť sa nepodarilo vytvoriť');
      setBusy(false);
    }
  };

  return (
    // Zámerne div, nie <form> — rovnaký dôvod ako PollComposerDialog (vnorené formy
    // sú nevalidné HTML, dialóg sa môže renderovať vnútri chat composer formu).
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-2.5 rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <h2 className="font-semibold">📅 Nová udalosť</h2>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          maxLength={MAX_EVENT_TITLE}
          placeholder="Názov (napr. Grilovačka u nás)"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-neutral-700"
          />
          {!allDay && (
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-neutral-700"
            />
          )}
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-accent" />
            Celý deň
          </label>
        </div>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={MAX_EVENT_LOCATION}
          placeholder="Miesto (voliteľné)"
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-neutral-500">
            Zrušiť
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? 'Vytváram…' : 'Poslať do chatu'}
          </button>
        </div>
      </div>
    </div>
  );
}
