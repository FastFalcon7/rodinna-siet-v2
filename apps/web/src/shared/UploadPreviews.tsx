import type { UploadItem } from './useMediaUpload';

/** Náhľady príloh v composeri: thumb / video / file chip + progress overlay. */
export function UploadPreviews({
  items,
  onRemove,
}: {
  items: UploadItem[];
  onRemove: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
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
