import { useRef, useState } from 'react';
import type { MediaPublic, PostPublic } from '@rodinna/shared-types';
import { ApiError, feedApi, mediaApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../shared/Avatar';

interface PostComposerProps {
  onCreated: (post: PostPublic) => void;
}

/** Formulár na nový príspevok — text + voľné fotky (upload cez /media, max 10). */
export function PostComposer({ onCreated }: PostComposerProps) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<MediaPublic[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of files.slice(0, 10 - media.length)) {
        const uploaded = await mediaApi.upload(file);
        setMedia((prev) => [...prev, uploaded]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nahranie fotky zlyhalo');
    } finally {
      setBusy(false);
    }
  };

  const removeMedia = (id: string) => setMedia((prev) => prev.filter((m) => m.id !== id));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const post = await feedApi.createPost({ bodyMd: trimmed, mediaIds: media.map((m) => m.id) });
      onCreated(post);
      setBody('');
      setMedia([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Príspevok sa nepodarilo vytvoriť');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6">
      <form onSubmit={onSubmit} className="flex gap-3">
        <Avatar user={user} size={40} />
        <div className="flex-1 space-y-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            rows={3}
            placeholder="Čo nové v rodine?"
            className="w-full resize-none rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:border-accent"
          />
          {media.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {media.map((m) => (
                <div key={m.id} className="relative h-16 w-16 overflow-hidden rounded-lg">
                  <img src={m.url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeMedia(m.id)}
                    className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-xs text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={onPickFiles}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy || media.length >= 10}
              className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
            >
              📷 Foto
            </button>
            <button
              type="submit"
              disabled={busy || !body.trim()}
              className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
            >
              Zverejniť
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </form>
    </section>
  );
}
