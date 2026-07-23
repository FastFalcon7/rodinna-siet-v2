import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MediaPublic } from '@rodinna/shared-types';
import { ZoomableImage } from './ZoomableImage';

interface LightboxProps {
  items: MediaPublic[];
  initialIndex: number;
  onClose: () => void;
  /** Voliteľné akcie v hlavičke pre aktuálnu fotku (napr. „Do albumu"). */
  renderActions?: (current: MediaPublic) => ReactNode;
}

/**
 * Fullscreen prehliadač fotiek (feed, chat, komentáre). Ovládanie (ladenie
 * 07/2026): swipe HORE/DOLE = ďalšia/predchádzajúca fotka, swipe DOPRAVA =
 * späť (zavrieť); na desktope šípky ←→/Esc a tlačidlá. Albumy majú zatiaľ
 * vlastný lightbox (s mazaním z albumu).
 */
export function Lightbox({ items, initialIndex, onClose, renderActions }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const current = items[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setIndex((i) => Math.min(items.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, onClose]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]!;
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0]!;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // Vertikálny swipe = listovanie (hore = ďalšia, dole = predchádzajúca).
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      setIndex((i) => (dy < 0 ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)));
      return;
    }
    // Swipe doprava = späť na predchádzajúce zobrazenie.
    if (dx > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) onClose();
  };

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex touch-none flex-col bg-black/95"
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
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
        {current.kind === 'video' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={current.id}
            src={current.url}
            poster={current.posterUrl ?? undefined}
            controls
            playsInline
            className="max-h-full max-w-full bg-black"
          />
        ) : (
          <ZoomableImage key={current.id} src={current.url} />
        )}
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
