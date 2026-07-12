import { useRef, useState } from 'react';
import type { PostPublic } from '@rodinna/shared-types';
import { ApiError, feedApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../shared/Avatar';
import { UploadPreviews } from '../shared/UploadPreviews';
import { useMediaUpload } from '../shared/useMediaUpload';

interface PostComposerProps {
  onCreated: (post: PostPublic) => void;
  /** 'card' = inline karta (desktop feed), 'sheet' = obsah compose sheetu (mobil FAB). */
  variant?: 'card' | 'sheet';
  autoFocus?: boolean;
}

/**
 * Nový príspevok — text + prílohy. „+" otvára PRIAMO natívny výber súboru
 * (ladenie 07/2026: na iOS je to systémové menu Knihovna fotek / Pořídit
 * snímek / Vybrat soubory — žiadne vlastné medzimenu navyše).
 */
export function PostComposer({ onCreated, variant = 'card', autoFocus = false }: PostComposerProps) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const uploads = useMediaUpload(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (busy || uploads.uploading) return;
    if (!trimmed && uploads.mediaIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const post = await feedApi.createPost({ bodyMd: trimmed, mediaIds: uploads.mediaIds });
      onCreated(post);
      setBody('');
      uploads.clear();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Príspevok sa nepodarilo vytvoriť');
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form onSubmit={onSubmit} className="flex gap-3">
      <Avatar user={user} size={40} />
      <div className="min-w-0 flex-1 space-y-3">
        <textarea
          ref={taRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          rows={3}
          autoFocus={autoFocus}
          placeholder="Čo nové v rodine?"
          className="w-full resize-none rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:border-accent dark:border-neutral-700"
        />
        <UploadPreviews items={uploads.items} onRemove={uploads.remove} onMakeCover={uploads.makeFirst} />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || uploads.items.length >= 10}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-2xl leading-none text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
            title="Pridať prílohu"
            aria-label="Pridať prílohu"
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
          <button
            type="submit"
            disabled={busy || uploads.uploading || (!body.trim() && uploads.mediaIds.length === 0)}
            className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          >
            Zverejniť
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  );

  if (variant === 'sheet') return form;
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      {form}
    </section>
  );
}
