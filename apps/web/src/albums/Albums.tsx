import { useEffect, useRef, useState } from 'react';
import type { AlbumDetail, AlbumSuggestion, AlbumSummary } from '@rodinna/shared-types';
import { ApiError, albumsApi, mediaApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { consumePendingNav } from '../app/navigate';

/**
 * Modul Albumy (M2): zoznam albumov + Zberač banner, detail s fotkami,
 * upload, lightbox, ZIP download. Bez routera — detail je in-tab stav;
 * karta vo Feede sem naviguje cez app/navigate.
 */
export function Albums() {
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [suggestions, setSuggestions] = useState<AlbumSuggestion[]>([]);
  const [openId, setOpenId] = useState<string | null>(() => consumePendingNav('albums')?.entityId ?? null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([albumsApi.list(), albumsApi.suggestions()])
      .then(([a, s]) => {
        setAlbums(a.albums);
        setSuggestions(s.suggestions);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Načítanie albumov zlyhalo'));

  useEffect(() => {
    void refresh();
  }, []);

  if (openId) {
    return (
      <AlbumDetailView
        albumId={openId}
        onBack={() => {
          setOpenId(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-4 px-4 py-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {suggestions.map((s) => (
        <SuggestionBanner key={s.date} suggestion={s} onCreated={(id) => setOpenId(id)} />
      ))}

      <NewAlbumButton onCreated={(id) => setOpenId(id)} />

      {!albums && !error && <p className="py-6 text-sm text-neutral-500">Načítavam albumy…</p>}
      {albums?.length === 0 && suggestions.length === 0 && (
        <p className="py-10 text-center text-sm text-neutral-500">
          Zatiaľ žiadne albumy. Vytvor prvý — alebo pošli fotky do chatu a Zberač ti ho navrhne sám. 📷
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {albums?.map((a) => (
          <button
            key={a.id}
            onClick={() => setOpenId(a.id)}
            className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left transition hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
          >
            {a.cover ? (
              <img src={a.cover.url} alt="" loading="lazy" className="aspect-square w-full object-cover transition group-hover:scale-[1.02]" />
            ) : (
              <div className="grid aspect-square w-full place-items-center bg-neutral-100 text-3xl dark:bg-neutral-800">📷</div>
            )}
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium">{a.title}</p>
              <p className="text-xs text-neutral-500">{a.photoCount} fotiek</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Zberač: „Máte N fotiek z dňa X — vytvoriť album?" (plán §M2, inovácia 1). */
function SuggestionBanner({
  suggestion,
  onCreated,
}: {
  suggestion: AlbumSuggestion;
  onCreated: (albumId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const dateText = new Date(`${suggestion.date}T12:00:00Z`).toLocaleDateString('sk-SK', {
    day: 'numeric',
    month: 'long',
  });

  const create = async () => {
    setBusy(true);
    try {
      // Názov = len dátum dd.mm.rr (ladenie 07/2026) — premenovať sa dá v detaile.
      const title = new Date(`${suggestion.date}T12:00:00Z`).toLocaleDateString('sk-SK', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      });
      const album = await albumsApi.create({ title, mediaIds: suggestion.mediaIds });
      onCreated(album.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-accent/30 bg-accent/5">
      <div className="flex items-center gap-3 p-3">
        <div className="flex -space-x-2">
          {suggestion.previews.slice(0, 3).map((m) => (
            <img key={m.id} src={m.url} alt="" className="h-12 w-12 rounded-lg border-2 border-white object-cover dark:border-neutral-900" />
          ))}
        </div>
        <p className="min-w-0 flex-1 text-sm">
          <strong>{suggestion.count} fotiek</strong> z {dateText} ešte nie je v albume.
        </p>
      </div>
      <div className="flex justify-end gap-2 px-3 pb-3">
        <button
          onClick={() => setDismissed(true)}
          className="rounded-lg px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Teraz nie
        </button>
        <button
          onClick={() => void create()}
          disabled={busy}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Vytváram…' : 'Vytvoriť album'}
        </button>
      </div>
    </section>
  );
}

function NewAlbumButton({ onCreated }: { onCreated: (albumId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const album = await albumsApi.create({ title: title.trim(), mediaIds: [] });
      setOpen(false);
      setTitle('');
      onCreated(album.id);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-500 transition hover:border-accent hover:text-accent dark:border-neutral-700"
      >
        + Nový album
      </button>
    );
  }
  return (
    <div className="flex gap-2 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void create()}
        autoFocus
        maxLength={120}
        placeholder="Názov albumu (napr. Leto 2026)"
        className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700"
      />
      <button
        onClick={() => void create()}
        disabled={!title.trim() || busy}
        className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        Vytvoriť
      </button>
    </div>
  );
}

function AlbumDetailView({ albumId, onBack }: { albumId: string; onBack: () => void }) {
  const { user } = useAuth();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () =>
    albumsApi
      .get(albumId)
      .then(setAlbum)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Album sa nepodarilo načítať'));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId]);

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const ids: string[] = [];
      for (const f of files) {
        const m = await mediaApi.upload(f);
        ids.push(m.id);
      }
      setAlbum(await albumsApi.addPhotos(albumId, ids));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nahrávanie zlyhalo');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (mediaId: string) => {
    if (!confirm('Odstrániť fotku z albumu? (Z chatu/feedu nezmizne.)')) return;
    await albumsApi.removePhoto(albumId, mediaId);
    setLightbox(null);
    void load();
  };

  const removeAlbum = async () => {
    if (!confirm('Zmazať celý album? Fotky ostanú v systéme.')) return;
    await albumsApi.remove(albumId);
    onBack();
  };

  const isOwner = album && user ? album.createdBy.id === user.id || user.role === 'admin' : false;

  const saveTitle = async () => {
    const title = newTitle.trim();
    if (!title || title === album?.title) {
      setRenaming(false);
      return;
    }
    try {
      setAlbum(await albumsApi.update(albumId, { title }));
      setRenaming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Premenovanie zlyhalo');
    }
  };

  if (error) {
    return (
      <div className="px-4 py-4">
        <button onClick={onBack} className="mb-3 text-sm text-accent">← Albumy</button>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!album) return <p className="px-4 py-6 text-sm text-neutral-500">Načítavam album…</p>;

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} aria-label="Späť na albumy" className="grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
          ←
        </button>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex gap-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle();
                  if (e.key === 'Escape') setRenaming(false);
                }}
                autoFocus
                maxLength={120}
                className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm font-semibold outline-none focus:border-accent dark:border-neutral-700"
              />
              <button
                onClick={() => void saveTitle()}
                disabled={!newTitle.trim()}
                className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-sm font-medium text-white disabled:opacity-40"
              >
                Uložiť
              </button>
            </div>
          ) : (
            <h2 className="flex min-w-0 items-center gap-1.5 font-semibold">
              <span className="truncate">{album.title}</span>
              {isOwner && (
                <button
                  onClick={() => {
                    setNewTitle(album.title);
                    setRenaming(true);
                  }}
                  aria-label="Premenovať album"
                  title="Premenovať album"
                  className="shrink-0 rounded-full px-1 text-sm text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200"
                >
                  ✏️
                </button>
              )}
            </h2>
          )}
          <p className="text-xs text-neutral-500">
            {album.photoCount} fotiek · založil {album.createdBy.displayName}
          </p>
        </div>
        {album.photoCount > 0 && (
          <a
            href={albumsApi.downloadUrl(albumId)}
            download
            className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            ⬇ ZIP
          </a>
        )}
        {isOwner && (
          <button
            onClick={() => void removeAlbum()}
            aria-label="Zmazať album"
            className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
          >
            🗑
          </button>
        )}
      </div>

      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="mb-3 w-full rounded-xl border border-dashed border-neutral-300 px-4 py-2.5 text-sm text-neutral-500 transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-neutral-700"
      >
        {uploading ? 'Nahrávam…' : '+ Pridať fotky'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void upload(files);
        }}
      />

      {album.photos.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">Album je zatiaľ prázdny.</p>
      ) : (
        <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-xl sm:grid-cols-4">
          {album.photos.map((p, i) => (
            <button key={p.media.id} onClick={() => setLightbox(i)} className="relative aspect-square">
              <img src={p.media.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {lightbox !== null && album.photos[lightbox] && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={() => setLightbox(null)}>
          <div className="flex items-center justify-between p-3 text-white" onClick={(e) => e.stopPropagation()}>
            <span className="text-sm text-white/70">
              {lightbox + 1} / {album.photos.length}
              {album.photos[lightbox].addedBy && ` · ${album.photos[lightbox].addedBy!.displayName}`}
            </span>
            <div className="flex gap-3">
              <button onClick={() => void removePhoto(album.photos[lightbox]!.media.id)} className="text-sm text-red-400">
                Odstrániť
              </button>
              <button onClick={() => setLightbox(null)} aria-label="Zavrieť" className="text-xl leading-none">
                ✕
              </button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {lightbox > 0 && (
              <button onClick={() => setLightbox(lightbox - 1)} aria-label="Predchádzajúca" className="absolute left-2 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl text-white">
                ‹
              </button>
            )}
            <img src={album.photos[lightbox].media.url} alt="" className="max-h-full max-w-full object-contain" />
            {lightbox < album.photos.length - 1 && (
              <button onClick={() => setLightbox(lightbox + 1)} aria-label="Ďalšia" className="absolute right-2 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl text-white">
                ›
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
