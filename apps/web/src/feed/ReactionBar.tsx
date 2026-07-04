import { useState } from 'react';
import { ALLOWED_REACTION_EMOJIS, type ReactionSummary, type ReactionTargetType } from '@rodinna/shared-types';
import { feedApi } from '../lib/api';
import { useLongPress } from '../shared/useLongPress';

interface ReactionBarProps {
  targetType: ReactionTargetType;
  targetId: string;
  reactions: ReactionSummary[];
  onChange: (reactions: ReactionSummary[]) => void;
}

/**
 * Reakcie à la Bluesky/WhatsApp: ❤️ ako primárna reakcia (tap = toggle),
 * long-press alebo 😊+ otvorí paletu všetkých emoji. Ostatné reakcie sa
 * zobrazujú ako chipy s počtom.
 */
export function ReactionBar({ targetType, targetId, reactions, onChange }: ReactionBarProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const longPress = useLongPress(() => setOpen(true));

  const heart = reactions.find((r) => r.emoji === '❤️');
  const others = reactions.filter((r) => r.emoji !== '❤️');

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
      <button
        type="button"
        {...longPress}
        onClick={() => react('❤️')}
        disabled={busy}
        className={`flex min-h-8 items-center gap-1 rounded-full px-2 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
          heart?.reactedByMe ? 'text-accent' : 'text-neutral-500'
        }`}
        title="Páči sa mi (podrž pre viac reakcií)"
      >
        <HeartIcon filled={!!heart?.reactedByMe} />
        {heart ? heart.count : ''}
      </button>

      {others.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => react(r.emoji)}
          disabled={busy}
          className={`rounded-full border px-2 py-0.5 text-xs transition ${
            r.reactedByMe
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
          }`}
        >
          {r.emoji} {r.count}
        </button>
      ))}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="grid min-h-8 place-items-center rounded-full px-2 text-sm text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
        title="Pridať reakciu"
        aria-label="Pridať reakciu"
      >
        <SmileyPlusIcon />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-1 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            {ALLOWED_REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => react(emoji)}
                className="rounded-lg px-1.5 py-1 text-lg transition hover:scale-125"
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden
    >
      <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3.4 1-4.5 2.5C10.9 4 9.3 3 7.5 3A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />
    </svg>
  );
}

function SmileyPlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden
    >
      <circle cx="10" cy="11" r="8" />
      <path d="M7 13.5c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5" />
      <path d="M7.5 9h.01M12.5 9h.01" />
      <path d="M19 2v6M16 5h6" />
    </svg>
  );
}
