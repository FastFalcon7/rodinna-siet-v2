import { useEffect, useRef, useState } from 'react';
import type { AlbumDetail, AlbumSuggestion, AlbumSummary } from '@rodinna/shared-types';
import { ApiError, albumsApi, mediaApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { consumePendingNav } from '../app/navigate';
import { useSwipeBack } from '../shared/useSwipeBack';
import { AlbumPickerDialog } from './AlbumPickerDialog';
import { NotePickerDialog } from '../notes/NotePickerDialog';
import { EventPickerDialog } from '../events/EventPickerDialog';
import { MediaTargetButtons, type MediaTargetKind } from '../shared/MediaTargetButtons';

/**
 * Modul Albumy (M2): zoznam albumov + Zberač banner, detail s fotkami,
 * upload, lightbox. Bez routera — detail je in-tab stav; karta vo Feede
 * sem naviguje cez app/navigate.
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
      const album = await albumsApi.create({ title, description: '', mediaIds: suggestion.mediaIds });
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
      const album = await albumsApi.create({ title: title.trim(), description: '', mediaIds: [] });
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
  const [newDesc, setNewDesc] = useState('');
  // Hromadný výber fotiek (ladenie 07/2026): kopírovanie do albumu / odstránenie.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<MediaTargetKind | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Swipe doprava = späť na zoznam albumov; lightbox si gestá rieši sám.
  const swipeBack = useSwipeBack(onBack);
  const lightboxTouch = useRef<{ x: number; y: number } | null>(null);

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

  const toggleSelected = (mediaId: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });

  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const allSelected = !!album && album.photos.length > 0 && selected.size === album.photos.length;
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(album!.photos.map((p) => p.media.id)));

  const isOwner = album && user ? album.createdBy.id === user.id || user.role === 'admin' : false;

  const startEdit = () => {
    setNewTitle(album?.title ?? '');
    setNewDesc(album?.description ?? '');
    setRenaming(true);
  };

  const saveTitle = async () => {
    const title = newTitle.trim();
    const description = newDesc.trim();
    if (!title) {
      setRenaming(false);
      return;
    }
    if (title === album?.title && description === (album?.description ?? '')) {
      setRenaming(false);
      return;
    }
    try {
      setAlbum(await albumsApi.update(albumId, { title, description }));
      setRenaming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Úprava zlyhala');
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
    <div className="px-4 py-4" {...swipeBack}>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} aria-label="Späť na albumy" className="grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
          ←
        </button>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="space-y-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle();
                  if (e.key === 'Escape') setRenaming(false);
                }}
                autoFocus
                maxLength={120}
                placeholder="Názov albumu"
                className="w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm font-semibold outline-none focus:border-accent dark:border-neutral-700"
              />
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Komentár k albumu (voliteľné)"
                className="w-full resize-none rounded-lg border border-neutral-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-accent dark:border-neutral-700"
              />
              <div className="flex gap-2">
                <button onClick={() => setRenaming(false)} className="ml-auto rounded-lg px-2.5 py-1 text-sm text-neutral-500">
                  Zrušiť
                </button>
                <button
                  onClick={() => void saveTitle()}
                  disabled={!newTitle.trim()}
                  className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-sm font-medium text-white disabled:opacity-40"
                >
                  Uložiť
                </button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="flex min-w-0 items-center gap-1.5 font-semibold">
                <span className="truncate">{album.title}</span>
                {isOwner && (
                  <button
                    onClick={startEdit}
                    aria-label="Upraviť album"
                    title="Upraviť názov a komentár"
                    className="shrink-0 rounded-full px-1 text-sm text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200"
                  >
                    ✏️
                  </button>
                )}
              </h2>
              {album.description && (
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-300">
                  {album.description}
                </p>
              )}
              <p className="mt-0.5 text-xs text-neutral-500">
                {album.photoCount} fotiek · založil {album.createdBy.displayName}
              </p>
            </>
          )}
        </div>
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

      <div className="mb-3 flex gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || selecting}
          className="shrink-0 rounded-xl border border-dashed border-neutral-300 px-4 py-2.5 text-sm text-neutral-500 transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-neutral-700"
        >
          {uploading ? 'Nahrávam…' : '+ Fotky'}
        </button>
        {album.photos.length > 0 && (
          <button
            onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
            className={`ml-auto shrink-0 rounded-xl border px-4 py-2.5 text-sm transition ${
              selecting
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-neutral-300 text-neutral-500 hover:border-accent hover:text-accent dark:border-neutral-700'
            }`}
          >
            {selecting ? 'Zrušiť výber' : 'Vybrať'}
          </button>
        )}
      </div>
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
            <button
              key={p.media.id}
              onClick={() => (selecting ? toggleSelected(p.media.id) : setLightbox(i))}
              className="relative aspect-square"
            >
              <img src={p.media.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              {selecting && (
                <span
                  className={`absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
                    selected.has(p.media.id)
                      ? 'bg-accent text-white'
                      : 'border-2 border-white/90 bg-black/25 text-transparent'
                  }`}
                >
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Akčná lišta hromadného výberu — len ikony (Album / Poznámka / Udalosť). */}
      {selecting && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-900/95"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <span className="shrink-0 text-sm text-neutral-500">Vybraté: {selected.size}</span>
          <button
            onClick={toggleSelectAll}
            className="shrink-0 rounded-lg border border-neutral-300 px-2.5 py-1 text-sm transition hover:border-accent hover:text-accent dark:border-neutral-700"
          >
            {allSelected ? 'Zrušiť všetko' : 'Vybrať všetko'}
          </button>
          <div className="ml-auto">
            <MediaTargetButtons disabled={selected.size === 0} onPick={setPicker} />
          </div>
        </div>
      )}

      {picker === 'album' && selected.size > 0 && (
        <AlbumPickerDialog
          mediaIds={[...selected]}
          onClose={() => {
            setPicker(null);
            exitSelecting();
          }}
        />
      )}
      {picker === 'note' && selected.size > 0 && (
        <NotePickerDialog
          mediaIds={[...selected]}
          onClose={() => {
            setPicker(null);
            exitSelecting();
          }}
        />
      )}
      {picker === 'event' && selected.size > 0 && (
        <EventPickerDialog
          mediaIds={[...selected]}
          onClose={() => {
            setPicker(null);
            exitSelecting();
          }}
        />
      )}

      {lightbox !== null && album.photos[lightbox] && (
        <div
          className="fixed inset-0 z-50 flex touch-none flex-col bg-black/95"
          onClick={() => setLightbox(null)}
          onTouchStart={(e) => {
            e.stopPropagation(); // neprepúšťaj gesto do swipe-back detailu
            const t = e.touches[0]!;
            lightboxTouch.current = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            const s = lightboxTouch.current;
            lightboxTouch.current = null;
            if (!s) return;
            const t = e.changedTouches[0]!;
            const dx = t.clientX - s.x;
            const dy = t.clientY - s.y;
            // Swipe hore/dole = ďalšia/predchádzajúca fotka.
            if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
              setLightbox((i) =>
                i === null ? null : dy < 0 ? Math.min(album.photos.length - 1, i + 1) : Math.max(0, i - 1),
              );
              return;
            }
            // Swipe doprava = späť do mriežky albumu.
            if (dx > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) setLightbox(null);
          }}
        >
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
