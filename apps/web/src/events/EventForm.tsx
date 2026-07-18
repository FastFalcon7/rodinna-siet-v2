import { useRef, useState } from 'react';
import {
  MAX_EVENT_BODY,
  MAX_EVENT_LOCATION,
  MAX_EVENT_TITLE,
  type EventPublic,
  type MediaPublic,
} from '@rodinna/shared-types';
import { ApiError, eventsApi } from '../lib/api';
import { UploadPreviews } from '../shared/UploadPreviews';
import { useMediaUpload } from '../shared/useMediaUpload';
import { TitleInput } from '../shared/TitleInput';
import { VisibilityPicker, type ShareVisibility } from '../shared/VisibilityPicker';

/**
 * Jednotný formulár udalosti pre TVORBU aj EDITÁCIU (ladenie 07/2026, body 6+7).
 * Predtým existovali tri rozdielne formuláre (Kalendár, chat [+], edit v karte),
 * každý s inou sadou polí — edit napr. nevedel meniť fotky, GPS ani viditeľnosť.
 * Teraz je zdroj pravdy jeden, takže tvorba a úprava ukazujú rovnaké polia.
 *
 * - `event` prítomné = editácia (predvyplní polia, mení cez PATCH + media endpointy).
 * - `roomId` prítomné = tvorba z chatu → viditeľnosť zamknutá na danú miestnosť
 *   (bez pickera), rovnako ako pôvodný EventComposerDialog.
 */
export function EventForm({
  event,
  roomId,
  submitLabel,
  busyLabel,
  onDone,
  onCancel,
}: {
  event?: EventPublic;
  roomId?: string;
  submitLabel: string;
  busyLabel: string;
  onDone: (event: EventPublic) => void;
  onCancel: () => void;
}) {
  const isEdit = !!event;
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = event ? new Date(event.startsAt) : null;

  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(
    event
      ? event.allDay
        ? event.startsAt.slice(0, 10)
        : `${start!.getFullYear()}-${pad(start!.getMonth() + 1)}-${pad(start!.getDate())}`
      : '',
  );
  const [time, setTime] = useState(
    event && !event.allDay ? `${pad(start!.getHours())}:${pad(start!.getMinutes())}` : '17:00',
  );
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  // Rozsah (ladenie 07/2026): celodenná viacdňová (dátum do, vrátane) alebo
  // od–do v hodinách v rámci dňa. Prázdne = bez konca (správanie ako doteraz).
  const end = event?.endsAt ? new Date(event.endsAt) : null;
  const [endDate, setEndDate] = useState(event?.allDay && event.endsAt ? event.endsAt.slice(0, 10) : '');
  const [timeTo, setTimeTo] = useState(
    event && !event.allDay && end ? `${pad(end.getHours())}:${pad(end.getMinutes())}` : '',
  );
  const [location, setLocation] = useState(event?.location ?? '');
  const [locating, setLocating] = useState(false);
  const [bodyMd, setBodyMd] = useState(event?.bodyMd ?? '');
  const [rsvp, setRsvp] = useState(event?.rsvp ?? false);
  const [visibility, setVisibility] = useState<ShareVisibility>(event?.visibility ?? 'family');
  const [roomIds, setRoomIds] = useState<string[]>(event?.roomIds ?? []);
  // Fotky už uložené v udalosti (len edit) — dajú sa odobrať cez media endpoint.
  const [existing, setExisting] = useState<MediaPublic[]>(event?.media ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploads = useMediaUpload(20);
  const fileRef = useRef<HTMLInputElement>(null);

  // Z chatu je viditeľnosť daná miestnosťou; inde ju drží picker.
  const effVisibility: ShareVisibility = roomId ? 'rooms' : visibility;
  const effRoomIds = roomId ? [roomId] : visibility === 'rooms' ? roomIds : [];
  const rangeInvalid = allDay ? endDate !== '' && endDate < date : timeTo !== '' && timeTo <= time;
  const canSubmit =
    title.trim().length > 0 &&
    date.length > 0 &&
    !busy &&
    !uploads.uploading &&
    !rangeInvalid &&
    (effVisibility !== 'rooms' || effRoomIds.length > 0);

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

  const removeExisting = async (mediaId: string) => {
    if (!event) return;
    try {
      const updated = await eventsApi.removeMedia(event.id, mediaId);
      setExisting(updated.media);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Fotku sa nepodarilo odobrať');
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const startsAt = allDay
        ? new Date(`${date}T00:00:00Z`).toISOString()
        : new Date(`${date}T${time}:00`).toISOString();
      // Celodenná: endsAt = 00:00Z posledného dňa (vrátane); ICS si prepočíta
      // exkluzívny DTEND sám. Časová: koniec v ten istý deň.
      const endsAt = allDay
        ? endDate && endDate > date
          ? new Date(`${endDate}T00:00:00Z`).toISOString()
          : null
        : timeTo
          ? new Date(`${date}T${timeTo}:00`).toISOString()
          : null;

      if (event) {
        let result = await eventsApi.update(event.id, {
          title: title.trim(),
          startsAt,
          endsAt,
          allDay,
          location: location.trim(),
          bodyMd: bodyMd.trim(),
          rsvp,
          visibility: effVisibility,
          roomIds: effRoomIds,
        });
        if (uploads.mediaIds.length > 0) {
          result = await eventsApi.addMedia(event.id, uploads.mediaIds);
        }
        uploads.clear();
        onDone(result);
      } else {
        const created = await eventsApi.create({
          title: title.trim(),
          startsAt,
          endsAt,
          allDay,
          location: location.trim(),
          bodyMd: bodyMd.trim(),
          toFeed: false,
          rsvp,
          mediaIds: uploads.mediaIds,
          visibility: effVisibility,
          roomIds: effRoomIds,
        });
        uploads.clear();
        onDone(created);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uloženie zlyhalo');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5">
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
        {allDay ? (
          <>
            <span className="text-sm text-neutral-500">do</span>
            <input
              type="date"
              value={endDate}
              min={date || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              title="Posledný deň (voliteľné — napr. koniec dovolenky)"
              className="rounded-lg border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-neutral-700"
            />
          </>
        ) : (
          <>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-neutral-700"
            />
            <span className="text-sm text-neutral-500">do</span>
            <input
              type="time"
              value={timeTo}
              onChange={(e) => setTimeTo(e.target.value)}
              title="Koniec (voliteľné)"
              className="rounded-lg border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-neutral-700"
            />
          </>
        )}
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-accent" />
          Celý deň
        </label>
      </div>
      {rangeInvalid && (
        <p className="text-xs text-red-600">Koniec nemôže byť pred začiatkom.</p>
      )}
      <div className="flex gap-2">
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={MAX_EVENT_LOCATION}
          placeholder="Miesto (voliteľné)"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
        />
        <button
          type="button"
          onClick={fillLocation}
          disabled={locating}
          title="Vyplniť aktuálnou polohou"
          className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-neutral-700"
        >
          {locating ? '…' : '📍'}
        </button>
      </div>
      <textarea
        value={bodyMd}
        onChange={(e) => setBodyMd(e.target.value)}
        rows={2}
        maxLength={MAX_EVENT_BODY}
        placeholder="Popis (voliteľné)"
        className="w-full resize-none rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
      />

      {existing.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {existing.map((m) => (
            <div key={m.id} className="relative">
              <img src={m.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => void removeExisting(m.id)}
                aria-label="Odobrať fotku"
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-xs text-white"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <UploadPreviews items={uploads.items} onRemove={uploads.remove} onMakeCover={uploads.makeFirst} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={rsvp} onChange={(e) => setRsvp(e.target.checked)} className="accent-accent" />
        Pozvánka — zbierať účasť (Prídem/Neviem/Neprídem)
      </label>

      {/* Z chatu je viditeľnosť zamknutá na miestnosť → picker nezobrazujeme. */}
      {!roomId && (
        <VisibilityPicker
          visibility={visibility}
          roomIds={roomIds}
          onChange={(v, r) => {
            setVisibility(v);
            setRoomIds(r);
          }}
        />
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
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
        <button type="button" onClick={onCancel} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-neutral-500">
          Zrušiť
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </div>
  );
}
