import { useState } from 'react';
import { ApiError } from '../lib/api';
import { AttachmentSheet } from '../shared/AttachmentSheet';
import { UploadPreviews } from '../shared/UploadPreviews';
import { useMediaUpload } from '../shared/useMediaUpload';

interface CommentComposerProps {
  placeholder: string;
  autoFocus?: boolean;
  /** Uloží komentár; pri chybe nech rejectne — composer zobrazí hlášku. */
  onSubmit: (input: { bodyMd: string; mediaIds: string[] }) => Promise<void>;
}

/**
 * Composer komentára/odpovede s prílohami (ladenie 07/2026, bod 3):
 * text + 📎 (foto/video/súbor cez AttachmentSheet, max 4). Spoločný pre
 * root komentár v PostCard aj odpovede v CommentThread.
 */
export function CommentComposer({ placeholder, autoFocus, onSubmit }: CommentComposerProps) {
  const [text, setText] = useState('');
  const uploads = useMediaUpload(4);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (busy || uploads.uploading) return;
    if (!trimmed && uploads.mediaIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ bodyMd: trimmed, mediaIds: uploads.mediaIds });
      setText('');
      uploads.clear();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Komentár sa nepodarilo uložiť');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0 flex-1 space-y-2">
      <UploadPreviews items={uploads.items} onRemove={uploads.remove} />
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700"
        />
        <button
          type="button"
          onClick={() => setSheet(true)}
          disabled={busy || uploads.items.length >= 4}
          title="Pridať prílohu"
          aria-label="Pridať prílohu"
          className="grid h-8 w-8 shrink-0 place-items-center self-center rounded-full text-xl leading-none text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
        >
          +
        </button>
        <button
          type="submit"
          disabled={busy || uploads.uploading || (!text.trim() && uploads.mediaIds.length === 0)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Odoslať
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {sheet && <AttachmentSheet onFiles={uploads.addFiles} onClose={() => setSheet(false)} />}
    </div>
  );
}
