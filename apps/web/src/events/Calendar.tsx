import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgendaResponse, EventPublic } from '@rodinna/shared-types';
import { ApiError, eventsApi } from '../lib/api';
import { useChat } from '../chat/ChatProvider';
import { EventCard } from './EventCard';
import { UploadPreviews } from '../shared/UploadPreviews';
import { useMediaUpload } from '../shared/useMediaUpload';
import { TitleInput } from '../shared/TitleInput';
import { VisibilityPicker, type ShareVisibility } from '../shared/VisibilityPicker';

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
            Pridaj túto URL ako odoberaný kalendár — udalosti aj narodeniny sa objavia v tvojej
            kalendárovej appke (len na čítanie).
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
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('17:00');
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [locating, setLocating] = useState(false);
  // Pozvánka (zbieranie účasti) je voliteľná — default vypnutá, obyčajný oznam.
  const [rsvp, setRsvp] = useState(false);
  // Udalosť je pozvánka — default pre celú rodinu; dá sa zúžiť na skupiny/seba.
  const [visibility, setVisibility] = useState<ShareVisibility>('family');
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploads = useMediaUpload(20);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 📍 vyplní pole Miesto odkazom na mapu z GPS. */
  const fillLocation = () => {
    if (!navigator.geolocation) {
      setError('Zariadenie nepodporuje zisťovanie polohy');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setLocation(`https://maps.google.com/?q=${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`);
      },
      () => {
        setLocating(false);
        setError('Polohu sa nepodarilo zistiť (povoľ prístup k polohe)');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const create = async () => {
    if (!title.trim() || !date || busy || uploads.uploading) return;
    if (visibility === 'rooms' && roomIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const startsAt = allDay
        ? new Date(`${date}T00:00:00Z`).toISOString()
        : new Date(`${date}T${time}:00`).toISOString();
      await eventsApi.create({
        title: title.trim(),
        startsAt,
        allDay,
        location: location.trim(),
        bodyMd: '',
        toFeed: false,
        rsvp,
        mediaIds: uploads.mediaIds,
        visibility,
        roomIds: visibility === 'rooms' ? roomIds : [],
      });
      uploads.clear();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Udalosť sa nepodarilo vytvoriť');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <TitleInput
        value={title}
        onChange={setTitle}
        autoFocus
        maxLength={140}
        placeholder="Názov (napr. Grilovačka u nás)"
        className="w-full px-3 py-2"
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
      <div className="flex gap-2">
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={140}
          placeholder="Miesto (voliteľné)"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
        />
        <button
          onClick={fillLocation}
          disabled={locating}
          title="Vyplniť aktuálnou polohou"
          className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
        >
          {locating ? '…' : '📍'}
        </button>
      </div>
      <UploadPreviews items={uploads.items} onRemove={uploads.remove} onMakeCover={uploads.makeFirst} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={rsvp} onChange={(e) => setRsvp(e.target.checked)} className="accent-accent" />
        Pozvánka — zbierať účasť (Prídem/Neviem/Neprídem)
      </label>
      <VisibilityPicker
        visibility={visibility}
        roomIds={roomIds}
        onChange={(v, r) => {
          setVisibility(v);
          setRoomIds(r);
        }}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Pridať prílohu"
          aria-label="Pridať prílohu"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
        >
          +
        </button>
        <button onClick={onCancel} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-neutral-500">
          Zrušiť
        </button>
        <button
          onClick={() => void create()}
          disabled={!title.trim() || !date || busy || uploads.uploading}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Vytváram…' : 'Vytvoriť'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) uploads.addFiles(files);
        }}
      />
    </div>
  );
}
