import { useRef, useState } from 'react';
import type { NoteDetail, NoteKind } from '@rodinna/shared-types';
import { ApiError, notesApi } from '../lib/api';
import { TitleInput } from '../shared/TitleInput';
import { UploadPreviews } from '../shared/UploadPreviews';
import { useMediaUpload } from '../shared/useMediaUpload';

/**
 * Dialóg tvorby zoznamu/poznámky z chat [+] sheetu (ladenie 07/2026):
 * vytvorí sa s visibility='rooms' pre danú miestnosť — vidia ju len jej
 * účastníci; volajúci pošle app://notes/<id> správu (živá karta K2).
 */
export function NoteComposerDialog({
  roomId,
  onCreated,
  onClose,
}: {
  roomId: string;
  onCreated: (note: NoteDetail) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<NoteKind>('list');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploads = useMediaUpload(20);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!title.trim() || busy || uploads.uploading) return;
    setBusy(true);
    setError(null);
    try {
      const note = await notesApi.create({
        kind,
        visibility: 'rooms',
        title: title.trim(),
        bodyMd: '',
        items: [],
        mediaIds: uploads.mediaIds,
        roomIds: [roomId],
      });
      uploads.clear();
      onCreated(note);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nepodarilo sa vytvoriť');
      setBusy(false);
    }
  };

  return (
    // Div, nie <form> — renderuje sa vnútri chat composer formu (ako PollComposerDialog).
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <h2 className="font-semibold">✅ Nový zoznam / poznámka</h2>

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

        <TitleInput
          value={title}
          onChange={setTitle}
          onSubmit={() => void submit()}
          autoFocus
          placeholder={kind === 'list' ? 'Názov zoznamu (napr. Nákup)' : 'Názov poznámky'}
          className="w-full"
        />
        <UploadPreviews items={uploads.items} onRemove={uploads.remove} onMakeCover={uploads.makeFirst} />
        <p className="text-xs text-neutral-500">Uvidia ho len účastníci tejto konverzácie.</p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Pridať prílohu"
            aria-label="Pridať prílohu"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
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
            disabled={!title.trim() || busy || uploads.uploading}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? 'Vytváram…' : 'Poslať do chatu'}
          </button>
        </div>
      </div>
    </div>
  );
}
