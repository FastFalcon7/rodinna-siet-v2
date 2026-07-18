import { useRef, useState } from 'react';
import type { MediaPublic, NoteDetail, NoteKind } from '@rodinna/shared-types';
import { ApiError, notesApi } from '../lib/api';
import { TitleInput } from '../shared/TitleInput';
import { UploadPreviews } from '../shared/UploadPreviews';
import { useMediaUpload } from '../shared/useMediaUpload';
import { VisibilityPicker, type ShareVisibility } from '../shared/VisibilityPicker';

/**
 * Jednotný formulár zoznamu/poznámky pre TVORBU aj EDITÁCIU (ladenie 07/2026,
 * bod 7B) — rovnaký vzor ako EventForm, aby sa všetky moduly ovládali rovnako.
 *
 * - `note` prítomné = editácia (názov, fotky, viditeľnosť; text poznámky a
 *   položky zoznamu sa ďalej upravujú priamo v detaile — sú to obsah, nie
 *   metadáta).
 * - `roomId` prítomné = tvorba z chatu → viditeľnosť zamknutá na miestnosť.
 * - Viditeľnosť mení len autor (server to vynucuje) — inému sa picker neukáže.
 */
export function NoteForm({
  note,
  roomId,
  initialKind = 'list',
  canEditVisibility = true,
  submitLabel,
  busyLabel,
  onDone,
  onCancel,
}: {
  note?: NoteDetail;
  roomId?: string;
  initialKind?: NoteKind;
  canEditVisibility?: boolean;
  submitLabel: string;
  busyLabel: string;
  onDone: (note: NoteDetail) => void;
  onCancel: () => void;
}) {
  const isEdit = !!note;
  const [kind, setKind] = useState<NoteKind>(note?.kind ?? initialKind);
  const [title, setTitle] = useState(note?.title ?? '');
  // Nové poznámky sú predvolene súkromné (ladenie 07/2026) — vidí ich len autor.
  const [visibility, setVisibility] = useState<ShareVisibility>(note?.visibility ?? 'private');
  const [roomIds, setRoomIds] = useState<string[]>(note?.roomIds ?? []);
  const [existing, setExisting] = useState<MediaPublic[]>(note?.media ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploads = useMediaUpload(20);
  const fileRef = useRef<HTMLInputElement>(null);

  const effVisibility: ShareVisibility = roomId ? 'rooms' : visibility;
  const effRoomIds = roomId ? [roomId] : visibility === 'rooms' ? roomIds : [];
  const canSubmit =
    title.trim().length > 0 &&
    !busy &&
    !uploads.uploading &&
    (effVisibility !== 'rooms' || effRoomIds.length > 0);

  const removeExisting = async (mediaId: string) => {
    if (!note) return;
    try {
      const updated = await notesApi.removeMedia(note.id, mediaId);
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
      if (note) {
        let result = await notesApi.update(note.id, {
          title: title.trim(),
          // Viditeľnosť smie meniť len autor — ostatní ju neposielajú vôbec.
          ...(canEditVisibility ? { visibility: effVisibility, roomIds: effRoomIds } : {}),
        });
        if (uploads.mediaIds.length > 0) {
          result = await notesApi.addMedia(note.id, uploads.mediaIds);
        }
        uploads.clear();
        onDone(result);
      } else {
        const created = await notesApi.create({
          kind,
          visibility: effVisibility,
          title: title.trim(),
          bodyMd: '',
          items: [],
          mediaIds: uploads.mediaIds,
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
      {!isEdit && (
        <div className="flex gap-1.5">
          {(
            [
              { value: 'list', label: '✅ Zoznam' },
              { value: 'note', label: '📝 Poznámka' },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setKind(o.value)}
              className={`rounded-full border px-3 py-1 text-sm transition ${
                kind === o.value
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      <TitleInput
        value={title}
        onChange={setTitle}
        onSubmit={() => void submit()}
        autoFocus
        placeholder={kind === 'list' ? 'Názov zoznamu (napr. Nákup)' : 'Názov poznámky'}
        className="w-full px-3 py-2"
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

      {roomId ? (
        <p className="text-xs text-neutral-500">Uvidia ho len účastníci tejto konverzácie.</p>
      ) : (
        canEditVisibility && (
          <VisibilityPicker
            visibility={visibility}
            roomIds={roomIds}
            onChange={(v, r) => {
              setVisibility(v);
              setRoomIds(r);
            }}
          />
        )
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
