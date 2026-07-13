import { useRef, useState } from 'react';
import { MAX_EVENT_LOCATION, MAX_EVENT_TITLE, type EventPublic } from '@rodinna/shared-types';
import { ApiError, eventsApi } from '../lib/api';
import { UploadPreviews } from '../shared/UploadPreviews';
import { useMediaUpload } from '../shared/useMediaUpload';
import { TitleInput } from '../shared/TitleInput';

/**
 * Dialóg tvorby udalosti pre chat [+] sheet (M4 doplnok): rovnaký vzor ako
 * PollComposerDialog (M1) — toFeed=false, volajúci pošle app://events/<id>
 * správu len do konkrétnej miestnosti namiesto karty do celorodinného Feedu.
 */
export function EventComposerDialog({
  roomId,
  onCreated,
  onClose,
}: {
  /** Miestnosť chatu — udalosť uvidia len jej členovia (visibility='rooms'). */
  roomId?: string;
  onCreated: (event: EventPublic) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('17:00');
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploads = useMediaUpload(20);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSubmit = title.trim().length > 0 && date.length > 0 && !busy && !uploads.uploading;

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
        mediaIds: uploads.mediaIds,
        // Z chatu: udalosť vidia len účastníci miestnosti (ladenie 07/2026).
        visibility: roomId ? 'rooms' : 'family',
        roomIds: roomId ? [roomId] : [],
      });
      uploads.clear();
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

        <TitleInput
          value={title}
          onChange={setTitle}
          autoFocus
          maxLength={MAX_EVENT_TITLE}
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
            maxLength={MAX_EVENT_LOCATION}
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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Pridať prílohu"
            aria-label="Pridať prílohu"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
          >
            +
          </button>
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
          <button onClick={onClose} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-neutral-500">
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
