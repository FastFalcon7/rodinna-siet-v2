import { useEffect, useState, type ReactNode } from 'react';
import type { MediaPublic } from '@rodinna/shared-types';

interface LightboxProps {
  items: MediaPublic[];
  initialIndex: number;
  onClose: () => void;
  /** Voliteľné akcie v hlavičke pre aktuálnu fotku (napr. „Do albumu"). */
  renderActions?: (current: MediaPublic) => ReactNode;
}

/**
 * Fullscreen prehliadač fotiek (feed, neskôr aj chat): šípky/swipe medzi
 * fotkami, počítadlo, Esc/klik mimo zatvára. Albumy majú zatiaľ vlastný
 * lightbox (s mazaním z albumu) — zjednotenie je téma na neskôr.
 */
export function Lightbox({ items, initialIndex, onClose, renderActions }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const current = items[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(items.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, onClose]);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={onClose}>
      <div
        className="flex items-center justify-between gap-2 p-3 text-white"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm text-white/70">
          {items.length > 1 && `${index + 1} / ${items.length}`}
        </span>
        <div className="flex items-center gap-3">
          {renderActions?.(current)}
          <button type="button" onClick={onClose} aria-label="Zavrieť" className="text-xl leading-none">
            ✕
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {index > 0 && (
          <button
            type="button"
            onClick={() => setIndex(index - 1)}
            aria-label="Predchádzajúca"
            className="absolute left-2 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl text-white"
          >
            ‹
          </button>
        )}
        <img src={current.url} alt="" className="max-h-full max-w-full object-contain" />
        {index < items.length - 1 && (
          <button
            type="button"
            onClick={() => setIndex(index + 1)}
            aria-label="Ďalšia"
            className="absolute right-2 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl text-white"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
