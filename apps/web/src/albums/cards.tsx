import { useEffect, useState } from 'react';
import type { AlbumDetail, MemoryPublic } from '@rodinna/shared-types';
import { albumsApi } from '../lib/api';
import { appNavigate } from '../app/navigate';
import { useChat } from '../chat/ChatProvider';
import type { EntityCardProps } from '../app/cards';

/**
 * Živé karty modulu Albumy (M2): karta albumu (Feed/chat → otvorí modul)
 * a spomienková karta „Na tento deň" (denný worker job).
 */

export function AlbumFeedCard({ entityId, compact }: EntityCardProps) {
  const { subscribe } = useChat();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      albumsApi
        .get(entityId)
        .then((a) => alive && setAlbum(a))
        .catch(() => alive && setGone(true));
    void load();
    const off = subscribe((e) => {
      if (e.t === 'feed:card' && e.module === 'albums' && e.entityId === entityId) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [entityId, subscribe]);

  if (gone) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700">
        Album už neexistuje.
      </div>
    );
  }
  if (!album) {
    return <div className="h-28 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;
  }

  const strip = album.photos.slice(0, 4);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        appNavigate({ module: 'albums', entityId });
      }}
      className={`block w-full overflow-hidden rounded-xl border border-black/10 bg-white text-left shadow-sm transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:hover:bg-neutral-800 ${
        compact ? '' : ''
      }`}
    >
      {strip.length > 0 && (
        // Explicitné triedy — dynamické `grid-cols-${n}` by Tailwind nevygeneroval.
        <div className={`grid gap-0.5 ${strip.length >= 3 ? 'grid-cols-3' : strip.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {strip.slice(0, 3).map((p) => (
            <img
              key={p.media.id}
              src={p.media.url}
              alt=""
              loading="lazy"
              className="aspect-square w-full object-cover"
            />
          ))}
        </div>
      )}
      <div className={compact ? 'px-3 py-2' : 'px-4 py-2.5'}>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          📷 {album.title}
        </p>
        <p className="text-xs text-neutral-500">
          {album.photoCount} {album.photoCount === 1 ? 'fotka' : album.photoCount < 5 ? 'fotky' : 'fotiek'} · ťukni a otvor album
        </p>
      </div>
    </button>
  );
}

export function MemoryCard({ entityId, compact }: EntityCardProps) {
  const [memory, setMemory] = useState<MemoryPublic | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let alive = true;
    albumsApi
      .getMemory(entityId)
      .then((m) => alive && setMemory(m))
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
    };
  }, [entityId]);

  if (gone) return null;
  if (!memory) {
    return <div className="h-40 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;
  }

  const years = memory.yearsAgo;
  const yearsText = years === 1 ? 'Pred rokom' : years < 5 ? `Pred ${years} rokmi` : `Pred ${years} rokmi`;

  return (
    <div
      className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-neutral-900"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          ✨ Na tento deň · {yearsText}
        </p>
        <button
          onClick={() => {
            void albumsApi.hideMemory(entityId).then(() => setGone(true));
          }}
          className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-600"
        >
          Skryť
        </button>
      </div>
      <img
        src={memory.media.url}
        alt=""
        loading="lazy"
        className={`w-full object-cover ${compact ? 'max-h-64' : 'max-h-96'}`}
        style={
          memory.media.width && memory.media.height
            ? { aspectRatio: `${memory.media.width}/${memory.media.height}` }
            : undefined
        }
      />
      <p className="px-4 py-2 text-xs text-neutral-500">
        {memory.owner.displayName} ·{' '}
        {new Date(memory.takenAt).toLocaleDateString('sk-SK', { day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
    </div>
  );
}
