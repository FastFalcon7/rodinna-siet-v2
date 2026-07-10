import { useState } from 'react';
import type { MediaPublic } from '@rodinna/shared-types';
import { Lightbox } from '../shared/Lightbox';
import { AlbumPickerDialog } from '../albums/AlbumPickerDialog';

const MAX_TILES = 4;

/**
 * Fotky príspevku (ladenie 07/2026, bod 1): namiesto nekonečnej mriežky max
 * 4 dlaždice v kompaktnom štvorci; pri 5+ fotkách má posledná dlaždica
 * overlay „+N". Klik otvorí lightbox so všetkými fotkami, odkiaľ sa dá
 * fotka uložiť do albumu (bod 8).
 */
export function PostGallery({ images }: { images: MediaPublic[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [saveMediaId, setSaveMediaId] = useState<string | null>(null);
  if (images.length === 0) return null;

  const tiles = images.slice(0, MAX_TILES);
  const extra = images.length - MAX_TILES;

  return (
    <>
      {images.length === 1 ? (
        <button type="button" onClick={() => setLightbox(0)} className="block w-full">
          <img
            src={images[0]!.url}
            alt=""
            loading="lazy"
            width={images[0]!.width ?? undefined}
            height={images[0]!.height ?? undefined}
            className="max-h-96 w-full rounded-xl border border-neutral-200 object-cover dark:border-neutral-800"
          />
        </button>
      ) : (
        <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
          {tiles.map((m, i) => {
            const isLast = i === tiles.length - 1;
            const span =
              images.length === 2 ? 'row-span-2' : images.length === 3 && i === 0 ? 'row-span-2' : '';
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setLightbox(i)}
                className={`relative block h-full w-full ${span}`}
              >
                <img src={m.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                {isLast && extra > 0 && (
                  <span className="absolute inset-0 grid place-items-center bg-black/50 text-2xl font-semibold text-white">
                    +{extra}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {lightbox !== null && (
        <Lightbox
          items={images}
          initialIndex={lightbox}
          onClose={() => setLightbox(null)}
          renderActions={(current) => (
            <button
              type="button"
              onClick={() => setSaveMediaId(current.id)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20"
            >
              💾 Do albumu
            </button>
          )}
        />
      )}
      {saveMediaId && <AlbumPickerDialog mediaId={saveMediaId} onClose={() => setSaveMediaId(null)} />}
    </>
  );
}
