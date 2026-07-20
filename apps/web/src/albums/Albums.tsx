import { useEffect, useRef, useState } from 'react';
import type { AlbumDetail, AlbumSummary } from '@rodinna/shared-types';
import { ApiError, albumsApi, mediaApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { consumePendingNav } from '../app/navigate';
import { useSwipeBack } from '../shared/useSwipeBack';
import { AlbumPickerDialog } from './AlbumPickerDialog';
import { NotePickerDialog } from '../notes/NotePickerDialog';
import { EventPickerDialog } from '../events/EventPickerDialog';
import { MediaTargetButtons, type MediaTargetKind } from '../shared/MediaTargetButtons';
import { ChatShareDialog, FeedShareDialog } from '../shared/ShareTargetDialogs';
import { ZoomableImage } from '../shared/ZoomableImage';
import { VisibilityPicker, type ShareVisibility } from '../shared/VisibilityPicker';

/**
 * Modul Albumy (M2): zoznam albumov, detail s fotkami, upload, lightbox.
 * Zberač banner (návrhy albumov z fotiek dňa) zrušený pri ladení 07/2026 —
 * zobrazoval sa pri každom otvorení a nebol praktický; API endpoint ostal.
 * Bez routera — detail je in-tab stav; karta vo Feede sem naviguje cez
 * app/navigate.
 */
export function Albums() {
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => consumePendingNav('albums')?.entityId ?? null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    albumsApi
      .list()
      .then((a) => setAlbums(a.albums))
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

      <NewAlbumButton onCreated={(id) => setOpenId(id)} />

      {!albums && !error && <p className="py-6 text-sm text-neutral-500">Načítavam albumy…</p>}
      {albums?.length === 0 && (
        <p className="py-10 text-center text-sm text-neutral-500">
          Zatiaľ žiadne albumy. Vytvor prvý! 📷
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
              <p className="truncate text-sm font-medium">
                {a.visibility === 'private' && <span title="Len pre mňa">🔒 </span>}
                {a.visibility === 'rooms' && <span title="Podskupiny">👥 </span>}
                {a.title}
              </p>
              <p className="text-xs text-neutral-500">{a.photoCount} fotiek</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NewAlbumButton({ onCreated }: { onCreated: (albumId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ShareVisibility>('family');
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!title.trim() || busy) return;
    if (visibility === 'rooms' && roomIds.length === 0) return;
    setBusy(true);
    try {
      const album = await albumsApi.create({
        title: title.trim(),
        description: description.trim(),
        mediaIds: [],
        visibility,
        roomIds: visibility === 'rooms' ? roomIds : [],
      });
      setOpen(false);
      setTitle('');
      setDescription('');
      setVisibility('family');
      setRoomIds([]);
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
    <div className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void create()}
        autoFocus
        maxLength={120}
        placeholder="Názov albumu (napr. Leto 2026)"
        className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Komentár k albumu (voliteľné)"
        className="w-full resize-none rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700"
      />
      <VisibilityPicker
        visibility={visibility}
        roomIds={roomIds}
        onChange={(v, r) => {
          setVisibility(v);
          setRoomIds(r);
        }}
      />
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-neutral-500">
          Zrušiť
        </button>
        <button
          onClick={() => void create()}
          disabled={!title.trim() || busy || (visibility === 'rooms' && roomIds.length === 0)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Vytvoriť
        </button>
      </div>
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
  const [newVis, setNewVis] = useState<ShareVisibility>('family');
  const [newRooms, setNewRooms] = useState<string[]>([]);
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

  /** Hromadné odobratie vybraných fotiek z albumu (ladenie 07/2026, bod 2).
      Odoberá len z albumu — fotky ostávajú nahraté (chat/feed nedotknuté). */
  const removeSelected = async () => {
    if (selected.size === 0) return;
    const n = selected.size;
    if (!confirm(`Odobrať ${n} ${n === 1 ? 'fotku' : n < 5 ? 'fotky' : 'fotiek'} z albumu? (Z chatu/feedu nezmiznú.)`)) {
      return;
    }
    try {
      for (const id of selected) await albumsApi.removePhoto(albumId, id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Niektoré fotky sa nepodarilo odobrať');
    }
    exitSelecting();
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
    setNewVis(album?.visibility ?? 'family');
    setNewRooms(album?.roomIds ?? []);
    setRenaming(true);
  };

  const saveTitle = async () => {
    const title = newTitle.trim();
    const description = newDesc.trim();
    if (!title) {
      setRenaming(false);
      return;
    }
    if (newVis === 'rooms' && newRooms.length === 0) return;
    try {
      setAlbum(
        await albumsApi.update(albumId, {
          title,
          description,
          visibility: newVis,
          roomIds: newVis === 'rooms' ? newRooms : [],
        }),
      );
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
              <VisibilityPicker
                visibility={newVis}
                roomIds={newRooms}
                onChange={(v, r) => {
                  setNewVis(v);
                  setNewRooms(r);
                }}
              />
              <div className="flex gap-2">
                <button onClick={() => setRenaming(false)} className="ml-auto rounded-lg px-2.5 py-1 text-sm text-neutral-500">
                  Zrušiť
                </button>
                <button
                  onClick={() => void saveTitle()}
                  disabled={!newTitle.trim() || (newVis === 'rooms' && newRooms.length === 0)}
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
          <button
            type="button"
            onClick={toggleSelectAll}
            className="flex min-w-0 items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300"
          >
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border text-xs font-bold ${
                allSelected ? 'border-accent bg-accent text-white' : 'border-neutral-400 text-transparent dark:border-neutral-600'
              }`}
            >
              ✓
            </span>
            <span className="truncate">{selected.size > 0 ? `${selected.size}` : 'Všetko'}</span>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <MediaTargetButtons disabled={selected.size === 0} onPick={setPicker} />
            <button
              type="button"
              onClick={() => void removeSelected()}
              disabled={selected.size === 0}
              title="Odobrať z albumu"
              aria-label="Odobrať z albumu"
              className="grid h-9 w-9 place-items-center rounded-full text-red-500 transition hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-950/40"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {picker === 'feed' && selected.size > 0 && (
        <FeedShareDialog
          mediaIds={[...selected]}
          onClose={() => {
            setPicker(null);
            exitSelecting();
          }}
        />
      )}
      {picker === 'chat' && selected.size > 0 && (
        <ChatShareDialog
          mediaIds={[...selected]}
          onClose={() => {
            setPicker(null);
            exitSelecting();
          }}
        />
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
            <ZoomableImage key={album.photos[lightbox].media.id} src={album.photos[lightbox].media.url} />
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
