import { useState } from 'react';
import type { MediaPublic } from '@rodinna/shared-types';
import { PhotoBrowser } from './PhotoBrowser';

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
  /** Ak je zadané, prehliadač ponúkne aj odstránenie vybraných fotiek. */
  onRemove?: (mediaIds: string[]) => Promise<void>;
}

/**
 * Fotky príspevku/správy (ladenie 07/2026): zobrazuje sa LEN úvodná fotka
 * (prvá v poradí — autor si ju vyberie v composeri), pri viacerých fotkách
 * badge „+N fotiek". Klik otvorí PhotoBrowser — mriežku ako v albume
 * s režimom „Vybrať" (Do albumu / poznámky / udalosti) a lightboxom.
 */
export function PhotoGallery({ images, compact = false, onRemove }: PhotoGalleryProps) {
  const [open, setOpen] = useState(false);
  if (images.length === 0) return null;

  const cover = images[0]!;
  const extra = images.length - 1;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="relative block w-full">
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

      {open && <PhotoBrowser images={images} onClose={() => setOpen(false)} onRemove={onRemove} />}
    </>
  );
}
