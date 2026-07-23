import { useState } from 'react';
import type { MediaPublic } from '@rodinna/shared-types';
import { PhotoBrowser } from './PhotoBrowser';
import { Lightbox } from './Lightbox';

/** Kombinovaný popis obsahu galérie pre badge, napr. „1 video, 5 fotiek". */
function contentLabel(media: MediaPublic[]): string {
  const vid = media.filter((m) => m.kind === 'video').length;
  const img = media.length - vid;
  const photos = img === 1 ? '1 fotka' : img < 5 ? `${img} fotky` : `${img} fotiek`;
  const videos = vid === 1 ? '1 video' : vid < 5 ? `${vid} videá` : `${vid} videí`;
  if (vid > 0 && img > 0) return `${videos}, ${photos}`;
  if (vid > 0) return videos;
  return photos;
}

interface PhotoGalleryProps {
  /** Vizuálne médiá (fotky aj videá) v poradí — prvé je úvodný náhľad. */
  images: MediaPublic[];
  /** Kompaktný variant (bublina v chate, komentár) — menšia výška, jemnejší rám. */
  compact?: boolean;
  /** Ak je zadané, prehliadač ponúkne aj odstránenie vybraných fotiek. */
  onRemove?: (mediaIds: string[]) => Promise<void>;
}

/**
 * Vizuálne médiá príspevku/správy (ladenie 07/2026): zobrazuje sa LEN úvodný
 * náhľad (prvé médium v poradí), pri viacerých badge s obsahom celej skupiny
 * („1 video, 5 fotiek"). Klik otvorí jednu skupinu — mriežku (PhotoBrowser)
 * a lightbox, ktoré zvládajú foto (zoom) aj video (prehrávač).
 */
export function PhotoGallery({ images, compact = false, onRemove }: PhotoGalleryProps) {
  // 'light' = fullscreen lightbox (jedno médium), 'browser' = mriežka s výberom.
  const [view, setView] = useState<'closed' | 'light' | 'browser'>('closed');
  if (images.length === 0) return null;

  const cover = images[0]!;
  const single = images.length === 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setView(single ? 'light' : 'browser')}
        className="relative block w-full"
      >
        <img
          src={cover.kind === 'video' ? (cover.posterUrl ?? cover.url) : cover.url}
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
        {/* Úvodné médium je video → prehrávacia ikona v strede. */}
        {cover.kind === 'video' && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-2xl text-white">▶</span>
          </span>
        )}
        {!single && (
          <span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white">
            {contentLabel(images)}
          </span>
        )}
      </button>

      {view === 'light' && (
        <Lightbox
          items={images}
          initialIndex={0}
          onClose={() => setView('closed')}
          renderActions={() => (
            <button
              type="button"
              onClick={() => setView('browser')}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20"
            >
              Vybrať
            </button>
          )}
        />
      )}
      {view === 'browser' && (
        <PhotoBrowser
          images={images}
          onClose={() => setView('closed')}
          onRemove={onRemove}
          // Jedno médium → výber „Vybrať" ho rovno označí a ukáže dolné menu.
          initialSelectedIds={single ? [cover.id] : undefined}
        />
      )}
    </>
  );
}
