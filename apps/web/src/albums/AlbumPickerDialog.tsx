import { useEffect, useState } from 'react';
import type { AlbumSummary } from '@rodinna/shared-types';
import { ApiError, albumsApi } from '../lib/api';

interface AlbumPickerDialogProps {
  /** Fotky, ktoré sa majú uložiť do albumu (jedna z lightboxu, viac z výberu). */
  mediaIds: string[];
  onClose: () => void;
}

/**
 * „Uložiť do albumu" (z feedu, bod 8 ladenia): výber existujúceho albumu
 * alebo vytvorenie nového. Backend addPhotos je family-wide (§7), takže
 * do albumu ide aj fotka iného autora.
 */
export function AlbumPickerDialog({ mediaIds, onClose }: AlbumPickerDialogProps) {
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    albumsApi
      .list()
      .then((r) => setAlbums(r.albums))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Načítanie albumov zlyhalo'));
  }, []);

  const finish = (title: string) => {
    setSavedTo(title);
    setTimeout(onClose, 1200);
  };

  const saveTo = async (album: AlbumSummary) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await albumsApi.addPhotos(album.id, mediaIds);
      finish(album.title);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uloženie zlyhalo');
      setBusy(false);
    }
  };

  const createAndSave = async () => {
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      await albumsApi.create({ title, description: newDesc.trim(), mediaIds, visibility: 'family', roomIds: [] });
      finish(title);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Album sa nepodarilo vytvoriť');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <h3 className="mb-3 font-semibold">Uložiť do albumu</h3>

        {savedTo ? (
          <p className="py-6 text-center text-sm">
            ✓ Uložené do albumu <strong>{savedTo}</strong>
          </p>
        ) : (
          <>
            {!albums && !error && <p className="py-4 text-sm text-neutral-500">Načítavam albumy…</p>}

            {albums && albums.length > 0 && (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {albums.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => void saveTo(a)}
                      disabled={busy}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
                    >
                      {a.cover ? (
                        <img src={a.cover.url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <span className="grid h-10 w-10 place-items-center rounded-lg bg-neutral-100 dark:bg-neutral-800">📷</span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{a.title}</span>
                        <span className="block text-xs text-neutral-500">{a.photoCount} fotiek</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {albums?.length === 0 && (
              <p className="py-2 text-sm text-neutral-500">Zatiaľ žiadne albumy — vytvor prvý nižšie.</p>
            )}

            {creating ? (
              <div className="mt-3 space-y-2">
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void createAndSave()}
                  autoFocus
                  maxLength={120}
                  placeholder="Názov albumu (napr. Leto 2026)"
                  className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700"
                />
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Komentár k albumu (voliteľné)"
                  className="w-full resize-none rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700"
                />
                <button
                  type="button"
                  onClick={() => void createAndSave()}
                  disabled={!newTitle.trim() || busy}
                  className="w-full rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Vytvoriť album
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                disabled={busy}
                className="mt-3 w-full rounded-xl border border-dashed border-neutral-300 px-4 py-2.5 text-sm text-neutral-500 transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-neutral-700"
              >
                + Nový album
              </button>
            )}

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
