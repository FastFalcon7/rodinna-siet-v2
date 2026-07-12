import { useState } from 'react';
import type { MediaPublic } from '@rodinna/shared-types';
import { Lightbox } from './Lightbox';
import { AlbumPickerDialog } from '../albums/AlbumPickerDialog';

/** Slovenské množné číslo pre badge „+N fotiek". */
function extraLabel(n: number): string {
  if (n === 1) return '+1 fotka';
  if (n < 5) return `+${n} fotky`;
  return `+${n} fotiek`;
}

interface PhotoGalleryProps {
  images: MediaPublic[];
  /** Kompaktný variant (bublina v chate, komentár) — menšia výška, jemnejší rám. */
  compact?: boolean;
}

/**
 * Fotky príspevku/správy (ladenie 07/2026): zobrazuje sa LEN úvodná fotka
 * (prvá v poradí — autor si ju vyberie v composeri), pri viacerých fotkách
 * badge „+N fotiek" v pravom dolnom rohu. Klik otvorí lightbox so všetkými
 * (swipe hore/dole listuje, swipe doprava zatvára, 💾 uloží do albumu).
 */
export function PhotoGallery({ images, compact = false }: PhotoGalleryProps) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [saveMediaId, setSaveMediaId] = useState<string | null>(null);
  if (images.length === 0) return null;

  const cover = images[0]!;
  const extra = images.length - 1;

  return (
    <>
      <button type="button" onClick={() => setLightbox(0)} className="relative block w-full">
        <img
          src={cover.url}
          alt=""
          loading="lazy"
          width={cover.width ?? undefined}
          height={cover.height ?? undefined}
          className={`w-full max-w-full object-cover ${
            compact
              ? 'max-h-72 rounded-lg'
              : 'max-h-96 rounded-xl border border-neutral-200 dark:border-neutral-800'
          }`}
        />
        {extra > 0 && (
          <span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white">
            {extraLabel(extra)}
          </span>
        )}
      </button>

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
      {saveMediaId && <AlbumPickerDialog mediaIds={[saveMediaId]} onClose={() => setSaveMediaId(null)} />}
    </>
  );
}
