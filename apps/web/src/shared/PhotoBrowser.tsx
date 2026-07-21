import { useRef, useState } from 'react';
import type { MediaPublic } from '@rodinna/shared-types';
import { Lightbox } from './Lightbox';
import { AlbumPickerDialog } from '../albums/AlbumPickerDialog';
import { NotePickerDialog } from '../notes/NotePickerDialog';
import { EventPickerDialog } from '../events/EventPickerDialog';
import { MediaTargetButtons } from './MediaTargetButtons';
import { ChatShareDialog, FeedShareDialog } from './ShareTargetDialogs';

interface PhotoBrowserProps {
  images: MediaPublic[];
  onClose: () => void;
  /** Ak je zadané, výber ponúkne aj „Odstrániť" (napr. fotky poznámky). */
  onRemove?: (mediaIds: string[]) => Promise<void>;
  /** Otvoriť rovno v režime výberu s týmito fotkami označenými (ladenie 07/2026,
   *  napr. „Vybrať" pri jedinej fotke → hneď dolné menu, bez ďalších klikov). */
  initialSelectedIds?: string[];
}

type PickerKind = 'feed' | 'chat' | 'album' | 'note' | 'event' | null;

/**
 * Prehliadač skupiny fotiek (ladenie 07/2026): mriežka ako v albume +
 * režim „Vybrať" s hromadnými akciami (Do albumu / poznámky / udalosti).
 * Ťuknutie na fotku (mimo výberu) otvorí fullscreen lightbox. Swipe
 * doprava zatvára (gestá vnútri lightboxu si rieši lightbox sám).
 */
export function PhotoBrowser({ images, onClose, onRemove, initialSelectedIds }: PhotoBrowserProps) {
  const [selecting, setSelecting] = useState((initialSelectedIds?.length ?? 0) > 0);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelectedIds ?? []));
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [picker, setPicker] = useState<PickerKind>(null);
  const [pickerIds, setPickerIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = images.length > 0 && selected.size === images.length;
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(images.map((m) => m.id)));

  const openPicker = (kind: Exclude<PickerKind, null>) => {
    setPickerIds([...selected]);
    setPicker(kind);
  };

  const bulkRemove = async () => {
    if (!onRemove || selected.size === 0 || busy) return;
    if (!confirm(`Odstrániť ${selected.size} fotiek?`)) return;
    setBusy(true);
    try {
      await onRemove([...selected]);
      setSelecting(false);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-neutral-900"
      onTouchStart={(e) => {
        e.stopPropagation();
        const t = e.touches[0]!;
        touchStart.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        e.stopPropagation();
        const s = touchStart.current;
        touchStart.current = null;
        if (!s) return;
        const t = e.changedTouches[0]!;
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 2) onClose();
      }}
    >
      {/* Hlavička */}
      <div
        className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Späť"
          className="grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          ←
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {images.length} {images.length === 1 ? 'fotka' : images.length < 5 ? 'fotky' : 'fotiek'}
        </span>
        <button
          type="button"
          onClick={() => {
            setSelecting((s) => !s);
            setSelected(new Set());
          }}
          className={`rounded-lg border px-3 py-1.5 text-sm transition ${
            selecting
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-neutral-300 text-neutral-500 hover:border-accent hover:text-accent dark:border-neutral-700'
          }`}
        >
          {selecting ? 'Zrušiť výber' : 'Vybrať'}
        </button>
      </div>

      {/* Mriežka */}
      <div className="min-h-0 flex-1 overflow-y-auto p-0.5">
        <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4">
          {images.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => (selecting ? toggle(m.id) : setLightbox(i))}
              className="relative aspect-square"
            >
              <img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              {selecting && (
                <span
                  className={`absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${
                    selected.has(m.id)
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
      </div>

      {/* Akčná lišta výberu — jeden riadok: vľavo výber všetkého + počet, vpravo ikony. */}
      {selecting && (
        <div
          className="flex shrink-0 items-center gap-2 border-t border-neutral-200 bg-white/95 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/95"
          style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
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
            <MediaTargetButtons disabled={selected.size === 0 || busy} onPick={openPicker} />
            {onRemove && (
              <button
                type="button"
                onClick={() => void bulkRemove()}
                disabled={selected.size === 0 || busy}
                title="Odstrániť vybrané"
                aria-label="Odstrániť vybrané"
                className="grid h-10 w-10 place-items-center rounded-xl border border-red-300 text-red-600 disabled:opacity-40 dark:border-red-900"
              >
                🗑
              </button>
            )}
          </div>
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
              onClick={() => {
                setPickerIds([current.id]);
                setPicker('album');
              }}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20"
            >
              💾 Do albumu
            </button>
          )}
        />
      )}

      {picker === 'feed' && <FeedShareDialog mediaIds={pickerIds} onClose={() => setPicker(null)} />}
      {picker === 'chat' && <ChatShareDialog mediaIds={pickerIds} onClose={() => setPicker(null)} />}
      {picker === 'album' && <AlbumPickerDialog mediaIds={pickerIds} onClose={() => setPicker(null)} />}
      {picker === 'note' && <NotePickerDialog mediaIds={pickerIds} onClose={() => setPicker(null)} />}
      {picker === 'event' && <EventPickerDialog mediaIds={pickerIds} onClose={() => setPicker(null)} />}
    </div>
  );
}
