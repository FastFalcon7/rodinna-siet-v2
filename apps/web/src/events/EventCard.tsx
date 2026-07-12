import { useEffect, useState } from 'react';
import type { EventPublic, RsvpStatus } from '@rodinna/shared-types';
import { chatApi, eventsApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useChat } from '../chat/ChatProvider';
import { appNavigate } from '../app/navigate';
import type { EntityCardProps } from '../app/cards';
import { PhotoGallery } from '../shared/PhotoGallery';

/**
 * Živá karta udalosti vo Feede/chate (M4, K1/K2): RSVP tlačidlá priamo
 * v karte, zoznam „kto príde" live cez WS event:update. Narodeninový
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

  const rsvp = async (status: RsvpStatus) => {
    if (busy) return;
    setBusy(true);
    try {
      setEvent(await eventsApi.rsvp(event.id, status));
    } finally {
      setBusy(false);
    }
  };

  const going = event.rsvps.yes;
  return (
    <div
      className={`rounded-xl border border-black/10 bg-white text-left shadow-sm dark:border-white/10 dark:bg-neutral-900 ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">📅 {event.title}</p>
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
    </div>
  );
}
