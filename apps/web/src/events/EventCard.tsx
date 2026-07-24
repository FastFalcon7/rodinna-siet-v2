import { useEffect, useState } from 'react';
import type { EventPublic, RsvpStatus } from '@rodinna/shared-types';
import { chatApi, eventsApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useChat } from '../chat/ChatProvider';
import { appNavigate } from '../app/navigate';
import type { EntityCardProps } from '../app/cards';
import { PhotoGallery } from '../shared/PhotoGallery';
import { SharedWith } from '../shared/SharedWith';
import { useSwipeBack } from '../shared/useSwipeBack';
import { EventForm } from './EventForm';

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
  const end = e.endsAt ? new Date(e.endsAt) : null;
  if (e.allDay) {
    // Viacdňová (ladenie 07/2026): „pi 18. 7. – ut 28. 7." (endsAt = posledný deň, vrátane).
    if (end && e.endsAt!.slice(0, 10) !== e.startsAt.slice(0, 10)) {
      return `${date} – ${end.toLocaleDateString('sk-SK', { weekday: 'short', day: 'numeric', month: 'numeric' })}`;
    }
    return date;
  }
  const time = d.toLocaleTimeString('sk-SK', { hour: 'numeric', minute: '2-digit' });
  if (end) {
    const endTime = end.toLocaleTimeString('sk-SK', { hour: 'numeric', minute: '2-digit' });
    // Koniec v iný deň (dáta z API to dovoľujú) → vypíš aj dátum konca.
    const sameDay = d.toDateString() === end.toDateString();
    return sameDay
      ? `${date} ${time} – ${endTime}`
      : `${date} ${time} – ${end.toLocaleDateString('sk-SK', { weekday: 'short', day: 'numeric', month: 'numeric' })} ${endTime}`;
  }
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
              {/* Klik na kartu už otvára úpravu — v ⋯ ostáva len rýchle Zmazať
                  (aby sa neaktuálna udalosť dala zmazať bez otvorenia). */}
              <div className="absolute right-0 top-8 z-20 w-32 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-800">
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

      {/* Klik na názov/čas otvorí celú udalosť na úpravu (ladenie 07/2026) —
          bez cesty cez ⋯ → Upraviť. Len autor/admin a len v plnej karte. */}
      <button
        type="button"
        onClick={canEdit && !compact ? () => setEditing(true) : undefined}
        className={`block w-full pr-7 text-left ${canEdit && !compact ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">📅 {event.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
          <span className="truncate">
            {eventTimeText(event)}
            {event.location && ` · 📍 ${event.location}`}
          </span>
          <SharedWith visibility={event.visibility} roomIds={event.roomIds} className="ml-auto shrink-0" />
        </span>
      </button>
      {event.bodyMd && !compact && (
        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-300">
          {event.bodyMd}
        </p>
      )}

      {event.media.some((m) => m.kind === 'image' || m.kind === 'video') && (
        <div className="mt-2">
          <PhotoGallery images={event.media.filter((m) => m.kind === 'image' || m.kind === 'video')} compact />
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

/**
 * Úprava udalosti (autor/admin) ako celoobrazovkový detail — otvorí sa klikom
 * na udalosť, swipe od ľavého okraja doprava zavrie (ako detail poznámky).
 * Zdieľaný EventForm má rovnaké polia ako tvorba + „Uložiť".
 */
function EventEditForm({
  event,
  onDone,
  onCancel,
}: {
  event: EventPublic;
  onDone: (updated: EventPublic) => void;
  onCancel: () => void;
}) {
  const swipeBack = useSwipeBack(onCancel);
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto app-bg"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      onClick={(e) => e.stopPropagation()}
      {...swipeBack}
    >
      <div className="mx-auto max-w-2xl px-4 py-4">
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={onCancel}
            aria-label="Späť"
            className="grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ←
          </button>
          <h2 className="font-semibold">Upraviť udalosť</h2>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <EventForm event={event} submitLabel="Uložiť" busyLabel="Ukladám…" onDone={onDone} onCancel={onCancel} />
        </div>
      </div>
    </div>
  );
}
