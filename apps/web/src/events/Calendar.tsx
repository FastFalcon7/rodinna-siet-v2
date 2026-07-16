import { useEffect, useMemo, useState } from 'react';
import type { AgendaResponse, EventPublic } from '@rodinna/shared-types';
import { ApiError, eventsApi } from '../lib/api';
import { useChat } from '../chat/ChatProvider';
import { EventCard } from './EventCard';
import { EventForm } from './EventForm';

/**
 * Modul Kalendár (M4): agenda najbližších 60 dní — udalosti s RSVP kartou
 * + narodeniny z profilov, zoskupené po dňoch. Mesačná mriežka je na
 * mobile nepoužiteľná (plán §M4) — agenda je default aj jediný pohľad.
 * Dole ICS subscribe URL pre Apple/Google Calendar.
 */
export function Calendar() {
  const { subscribe } = useChat();
  const [agenda, setAgenda] = useState<AgendaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [icsUrl, setIcsUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = () =>
    eventsApi
      .agenda()
      .then(setAgenda)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Načítanie kalendára zlyhalo'));

  useEffect(() => {
    void refresh();
    void eventsApi.icsUrl().then((r) => setIcsUrl(r.url)).catch(() => {});
    const off = subscribe((e) => {
      if (e.t === 'event:update') void refresh();
    });
    return off;
  }, [subscribe]);

  /** Dni agendy: udalosti + narodeniny zlúčené a zoradené. */
  const days = useMemo(() => {
    if (!agenda) return [];
    const byDay = new Map<string, { events: EventPublic[]; birthdays: AgendaResponse['birthdays'] }>();
    const dayOf = (iso: string) => iso.slice(0, 10);
    for (const e of agenda.events) {
      const d = dayOf(e.startsAt);
      const entry = byDay.get(d) ?? { events: [], birthdays: [] };
      entry.events.push(e);
      byDay.set(d, entry);
    }
    for (const b of agenda.birthdays) {
      const entry = byDay.get(b.date) ?? { events: [], birthdays: [] };
      entry.birthdays.push(b);
      byDay.set(b.date, entry);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [agenda]);

  const dayLabel = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    const today = new Date().toISOString().slice(0, 10);
    if (iso === today) return 'Dnes';
    return d.toLocaleDateString('sk-SK', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  return (
    <div className="space-y-4 px-4 py-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {compose ? (
        <NewEventForm
          onDone={() => {
            setCompose(false);
            void refresh();
          }}
          onCancel={() => setCompose(false)}
        />
      ) : (
        <button
          onClick={() => setCompose(true)}
          className="w-full rounded-2xl border border-dashed border-neutral-300 px-4 py-2.5 text-sm text-neutral-500 transition hover:border-accent hover:text-accent dark:border-neutral-700"
        >
          + Nová udalosť
        </button>
      )}

      {!agenda && !error && <p className="py-6 text-sm text-neutral-500">Načítavam…</p>}
      {agenda && days.length === 0 && (
        <p className="py-10 text-center text-sm text-neutral-500">
          Najbližších 60 dní je voľných. Naplánuj grilovačku! 🍖
        </p>
      )}

      {days.map(([day, entry]) => (
        <section key={day}>
          <h3 className="mb-2 text-sm font-semibold capitalize text-neutral-500">{dayLabel(day)}</h3>
          <div className="space-y-2">
            {entry.birthdays.map((b) => (
              <div
                key={`b-${b.user.id}`}
                className="rounded-xl border border-black/10 bg-gradient-to-br from-amber-50 to-rose-50 px-4 py-2.5 text-sm dark:border-white/10 dark:from-amber-950/40 dark:to-rose-950/40"
              >
                🎂 <strong>{b.user.displayName}</strong> má narodeniny
                {b.age !== null && ` (${b.age})`}
              </div>
            ))}
            {entry.events.map((e) => (
              <EventCard key={e.id} entityId={e.id} />
            ))}
          </div>
        </section>
      ))}

      {icsUrl && (
        <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="mb-1 text-sm font-semibold">Odber v Apple/Google Calendar</h3>
          <p className="mb-2 text-xs text-neutral-500">
            Pridaj túto URL ako odoberaný kalendár — rodinné udalosti, narodeniny aj tvoje
            súkromné a skupinové udalosti sa objavia v tvojej kalendárovej appke (len na čítanie).
            Odkaz je osobný — nezdieľaj ho.
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
      )}
    </div>
  );
}

function NewEventForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <EventForm submitLabel="Vytvoriť" busyLabel="Vytváram…" onDone={() => onDone()} onCancel={onCancel} />
    </div>
  );
}
