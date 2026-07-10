import type { MediaPublic } from '@rodinna/shared-types';
import { formatBytes } from './time';

/**
 * Jednotný render média (feed aj chat): obrázok → img s lightbox linkom,
 * video → natívny prehrávač (originál cez Range requesty, §4.3),
 * súbor → download karta s názvom a veľkosťou.
 */
export function MediaItem({ media, className = '' }: { media: MediaPublic; className?: string }) {
  if (media.kind === 'video') {
    return (
      <div className={`relative overflow-hidden rounded-lg ${className}`}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src={media.url}
          controls
          playsInline
          preload="metadata"
          poster={media.posterUrl ?? undefined}
          className="max-h-96 w-full max-w-full bg-black"
        />
        {media.processing && (
          <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
            ⏳ Video sa pripravuje…
          </span>
        )}
      </div>
    );
  }

  if (media.kind === 'file') {
    return (
      <a
        href={media.url}
        download={media.fileName ?? true}
        className={`flex min-w-0 items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-left transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700 ${className}`}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-teal/15 text-xl">
          📄
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {media.fileName ?? 'Súbor'}
          </span>
          <span className="block text-xs text-neutral-500">{formatBytes(media.bytes)}</span>
        </span>
      </a>
    );
  }

  return (
    <a href={media.url} target="_blank" rel="noreferrer" className="block">
      <img
        src={media.url}
        alt=""
        loading="lazy"
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        className={`max-h-96 w-full max-w-full object-cover ${className}`}
      />
    </a>
  );
}
