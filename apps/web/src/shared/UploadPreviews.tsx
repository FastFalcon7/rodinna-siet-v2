import type { UploadItem } from './useMediaUpload';

/**
 * Náhľady príloh v composeri: thumb / video / file chip + progress overlay.
 * Pri viacerých prílohách je prvá fotka „Úvodná" (zobrazí sa ako obálka
 * príspevku) — ★ na inej fotke ju presunie na začiatok (ladenie 07/2026).
 */
export function UploadPreviews({
  items,
  onRemove,
  onMakeCover,
}: {
  items: UploadItem[];
  onRemove: (key: string) => void;
  /** Ak je zadané, umožní vybrať úvodnú fotku (presun na začiatok). */
  onMakeCover?: (key: string) => void;
}) {
  if (items.length === 0) return null;
  const withCover = !!onMakeCover && items.length > 1;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <div key={item.key} className="relative">
          {item.previewKind === 'image' && item.localUrl ? (
            <img src={item.localUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
          ) : item.previewKind === 'video' && item.localUrl ? (
            <video src={item.localUrl} muted playsInline className="h-16 w-16 rounded-lg bg-black object-cover" />
          ) : (
            <div className="flex h-16 w-28 flex-col items-center justify-center gap-0.5 rounded-lg bg-neutral-100 px-1 dark:bg-neutral-800">
              <span className="text-lg">📄</span>
              <span className="w-full truncate text-center text-[10px] text-neutral-500">{item.name}</span>
            </div>
          )}

          {withCover && index === 0 && (
            <span className="absolute bottom-0 left-0 rounded-tr-lg rounded-bl-lg bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold text-white">
              Úvodná
            </span>
          )}
          {withCover && index > 0 && item.previewKind === 'image' && (
            <button
              type="button"
              onClick={() => onMakeCover(item.key)}
              title="Nastaviť ako úvodnú fotku"
              aria-label="Nastaviť ako úvodnú fotku"
              className="absolute bottom-0 left-0 rounded-tr-lg rounded-bl-lg bg-black/65 px-1.5 py-0.5 text-[10px] text-white transition hover:bg-black/80"
            >
              ★
            </button>
          )}

          {!item.media && !item.error && (
            <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/45 text-xs font-semibold text-white">
              {item.progress} %
            </div>
          )}
          {item.error && (
            <div
              className="absolute inset-0 grid place-items-center rounded-lg bg-red-600/70 text-lg text-white"
              title={item.error}
            >
              ⚠️
            </div>
          )}

          <button
            type="button"
            onClick={() => onRemove(item.key)}
            className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-neutral-800 text-xs text-white"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
