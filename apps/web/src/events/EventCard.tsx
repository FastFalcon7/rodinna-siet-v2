import { useEffect, useState } from 'react';
import type { EventPublic, RsvpStatus } from '@rodinna/shared-types';
import { ApiError, chatApi, eventsApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useChat } from '../chat/ChatProvider';
import { appNavigate } from '../app/navigate';
import type { EntityCardProps } from '../app/cards';
import { PhotoGallery } from '../shared/PhotoGallery';
import { TitleInput } from '../shared/TitleInput';

/**
 * Živá karta udalosti vo Feede/chate (M4, K1/K2): RSVP tlačidlá priamo
 * v karte (len ak je udalosť „pozvánka"), zoznam „kto príde" live cez WS
 * event:update. Autor/admin má cez ⋯ Upraviť a Zmazať. Narodeninový
 * variant (source='birthday') má namiesto RSVP tlačidlo gratulácie —
 * založí/otvorí DM s oslávencom.
 */

const RSVP_LABELS: { status: RsvpStatus; label: string }[] = [
  { status: 'yes', label: 'Prídem' },
  { status: 'maybe', label: 'Neviem' },
  { status: 'no', label: 'Neprídem' },
];

export function eventTimeText(e: EventPublic): string {
  const d = new Date(e.startsAt);
  const date = d.toLocaleDateString('sk-SK', { weekday: 'short', day: 'numeric', month: 'numeric' });
  if (e.allDay) return date;
  const time = d.toLocaleTimeString('sk-SK', { hour: 'numeric', minute: '2-digit' });
  return `${date} ${time}`;
}

export function EventCard({ entityId, compact }: EntityCardProps) {
  const { user } = useAuth();
  const { subscribe } = useChat();
  const [event, setEvent] = useState<EventPublic | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      eventsApi
        .get(entityId)
        .then((e) => alive && setEvent(e))
        .catch(() => alive && setGone(true));
    void load();
    const off = subscribe((e) => {
      if (e.t === 'event:update' && e.eventId === entityId) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [entityId, subscribe]);

  if (gone) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700">
        Udalosť už neexistuje.
      </div>
    );
  }
  if (!event) {
    return <div className="h-24 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;
  }

  // Narodeninová karta — gratulácia namiesto RSVP.
  if (event.source === 'birthday') {
    const celebrant = event.createdBy;
    const isMe = celebrant.id === user?.id;
    return (
      <div
        className={`rounded-xl border border-black/10 bg-gradient-to-br from-amber-50 to-rose-50 text-left shadow-sm dark:border-white/10 dark:from-amber-950/40 dark:to-rose-950/40 ${
          compact ? 'px-3 py-2.5' : 'px-4 py-3'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{event.title}</p>
        {!isMe && (
          <button
            onClick={() => {
              void chatApi.createRoom({ kind: 'dm', memberIds: [celebrant.id] }).then((room) => {
                appNavigate({ module: 'chat', entityId: room.id });
              });
            }}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            🎉 Napísať gratuláciu
          </button>
        )}
      </div>
    );
  }

  const canEdit = event.createdBy.id === user?.id || user?.role === 'admin';

  if (editing) {
    return (
      <EventEditForm
        event={event}
        onDone={(updated) => {
          setEvent(updated);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const rsvp = async (status: RsvpStatus) => {
    if (busy) return;
    setBusy(true);
    try {
      setEvent(await eventsApi.rsvp(event.id, status));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setMenuOpen(false);
    if (!confirm('Naozaj zmazať túto udalosť?')) return;
    setBusy(true);
    try {
      await eventsApi.remove(event.id);
      setGone(true);
    } finally {
      setBusy(false);
    }
  };

  const going = event.rsvps.yes;
  return (
    <div
      className={`relative rounded-xl border border-black/10 bg-white text-left shadow-sm dark:border-white/10 dark:bg-neutral-900 ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {canEdit && (
        <div className="absolute right-1.5 top-1.5">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Možnosti udalosti"
            className="grid h-7 w-7 place-items-center rounded-full text-lg leading-none text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-8 z-20 w-32 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-800">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setEditing(true);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  Upraviť
                </button>
                <button
                  onClick={() => void del()}
                  className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  Zmazať
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <p className="pr-7 text-sm font-semibold text-neutral-900 dark:text-neutral-100">📅 {event.title}</p>
      <p className="mt-0.5 text-xs text-neutral-500">
        {eventTimeText(event)}
        {event.location && ` · 📍 ${event.location}`}
      </p>
      {event.bodyMd && !compact && (
        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-300">
          {event.bodyMd}
        </p>
      )}

      {event.media.some((m) => m.kind === 'image') && (
        <div className="mt-2">
          <PhotoGallery images={event.media.filter((m) => m.kind === 'image')} compact />
        </div>
      )}

      {/* RSVP len ak je udalosť pozvánka; inak je to obyčajný oznam. */}
      {event.rsvp && (
        <>
          <div className="mt-2 flex gap-1.5">
            {RSVP_LABELS.map(({ status, label }) => (
              <button
                key={status}
                onClick={() => void rsvp(status)}
                disabled={busy}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                  event.myRsvp === status
                    ? 'border-accent bg-accent text-white'
                    : 'border-neutral-300 text-neutral-600 hover:border-accent dark:border-neutral-700 dark:text-neutral-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="mt-1.5 text-xs text-neutral-400">
            {going.length > 0
              ? `Príde: ${going.map((a) => a.displayName.split(' ')[0]).join(', ')}`
              : 'Zatiaľ nikto nepotvrdil'}
            {event.rsvps.maybe.length > 0 && ` · možno ${event.rsvps.maybe.length}`}
          </p>
        </>
      )}
    </div>
  );
}

/** Inline úprava udalosti (autor/admin) — názov, čas, miesto, popis, pozvánka. */
function EventEditForm({
  event,
  onDone,
  onCancel,
}: {
  event: EventPublic;
  onDone: (updated: EventPublic) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  // allDay udalosť má čas 00:00 UTC; predvyplníme dátum bez posunu.
  const start = new Date(event.startsAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const [date, setDate] = useState(
    event.allDay
      ? event.startsAt.slice(0, 10)
      : `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
  );
  const [time, setTime] = useState(event.allDay ? '17:00' : `${pad(start.getHours())}:${pad(start.getMinutes())}`);
  const [allDay, setAllDay] = useState(event.allDay);
  const [location, setLocation] = useState(event.location);
  const [bodyMd, setBodyMd] = useState(event.bodyMd);
  const [rsvp, setRsvp] = useState(event.rsvp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim() || !date || busy) return;
    setBusy(true);
    setError(null);
    try {
      const startsAt = allDay
        ? new Date(`${date}T00:00:00Z`).toISOString()
        : new Date(`${date}T${time}:00`).toISOString();
      const updated = await eventsApi.update(event.id, {
        title: title.trim(),
        startsAt,
        allDay,
        location: location.trim(),
        bodyMd: bodyMd.trim(),
        rsvp,
      });
      onDone(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uloženie zlyhalo');
      setBusy(false);
    }
  };

  return (
    <div
      className="space-y-2.5 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      onClick={(e) => e.stopPropagation()}
    >
      <TitleInput value={title} onChange={setTitle} autoFocus maxLength={140} placeholder="Názov udalosti" className="w-full px-3 py-2" />
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
        maxLength={140}
        placeholder="Miesto (voliteľné)"
        className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
      />
      <textarea
        value={bodyMd}
        onChange={(e) => setBodyMd(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="Popis (voliteľné)"
        className="w-full resize-none rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={rsvp} onChange={(e) => setRsvp(e.target.checked)} className="accent-accent" />
        Pozvánka — zbierať účasť (Prídem/Neviem/Neprídem)
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-neutral-500">
          Zrušiť
        </button>
        <button
          onClick={() => void save()}
          disabled={!title.trim() || !date || busy}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Ukladám…' : 'Uložiť'}
        </button>
      </div>
    </div>
  );
}
