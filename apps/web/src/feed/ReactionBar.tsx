import { useState } from 'react';
import { ALLOWED_REACTION_EMOJIS, type ReactionSummary, type ReactionTargetType } from '@rodinna/shared-types';
import { feedApi } from '../lib/api';

interface ReactionBarProps {
  targetType: ReactionTargetType;
  targetId: string;
  reactions: ReactionSummary[];
  onChange: (reactions: ReactionSummary[]) => void;
}

/** Riadok reakcií: existujúce emoji pills + paleta na pridanie/zmenu/zrušenie (toggle). */
export function ReactionBar({ targetType, targetId, reactions, onChange }: ReactionBarProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const react = async (emoji: string) => {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      const { reactions: next } = await feedApi.setReaction({ targetType, targetId, emoji: emoji as never });
      onChange(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => react(r.emoji)}
          disabled={busy}
          className={`rounded-full border px-2 py-0.5 text-xs transition ${
            r.reactedByMe
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800'
          }`}
        >
          {r.emoji} {r.count}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="rounded-full border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        + reakcia
      </button>
      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 flex gap-1 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-1.5 shadow-lg">
          {ALLOWED_REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => react(emoji)}
              className="rounded-lg px-1.5 py-1 text-lg transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
