import type { MessagePublic } from '@rodinna/shared-types';
import { ReactionPicker } from '../shared/ReactionPicker';

/**
 * Akcie nad správou po dlhom podržaní (ladenie 07/2026, WhatsApp vzor):
 * fixed overlay s rozostreným pozadím, reakcie hore, náhľad správy v strede
 * a zoznam akcií dole — vždy kompletne viditeľné bez ohľadu na to, kde je
 * bublina na obrazovke (predtým sa popover pri hornom okraji orezal).
 */
export function MessageActionSheet({
  message,
  mine,
  canDelete,
  bodyText,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onClose,
}: {
  message: MessagePublic;
  mine: boolean;
  canDelete: boolean;
  bodyText: string;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const myReaction = message.reactions.find((r) => r.reactedByMe)?.emoji ?? null;
  const preview = bodyText.trim() || (message.media.length > 0 ? '📷 Fotka' : '');

  const copy = () => {
    if (bodyText) void navigator.clipboard?.writeText(bodyText).catch(() => {});
    onClose();
  };

  const Action = ({ icon, label, danger, onClick }: { icon: string; label: string; danger?: boolean; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
        danger ? 'text-red-600' : ''
      }`}
    >
      <span>{label}</span>
      <span className="text-base">{icon}</span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-black/40 px-6 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Reakcie */}
      <div
        className="rounded-full border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <ReactionPicker current={myReaction} onPick={onReact} />
      </div>

      {/* Náhľad správy */}
      {preview && (
        <div
          className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
            mine ? 'bg-bubble-mine text-neutral-900 dark:text-neutral-100' : 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="line-clamp-4 whitespace-pre-wrap [overflow-wrap:anywhere]">{preview}</p>
        </div>
      )}

      {/* Akcie */}
      <div
        className="w-full max-w-xs overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <Action icon="↩" label="Odpovedať" onClick={() => { onClose(); onReply(); }} />
        {bodyText && <Action icon="⧉" label="Kopírovať" onClick={copy} />}
        {mine && <Action icon="✎" label="Upraviť" onClick={() => { onClose(); onEdit(); }} />}
        {canDelete && <Action icon="🗑" label="Zmazať" danger onClick={() => { onClose(); onDelete(); }} />}
      </div>
    </div>
  );
}
