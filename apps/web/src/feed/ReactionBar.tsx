import { useState } from 'react';
import { ALLOWED_REACTION_EMOJIS, type ReactionSummary, type ReactionTargetType } from '@rodinna/shared-types';
import { ApiError, feedApi } from '../lib/api';

interface ReactionBarProps {
  targetType: ReactionTargetType;
  targetId: string;
  reactions: ReactionSummary[];
  /** false = len počítadlá (vlastný obsah — naň sa nereaguje). */
  canReact: boolean;
  /** Nový súhrn cieľa + agregát vlákna postu (na počítadlo pod hlavným postom). */
  onChange: (reactions: ReactionSummary[], postReactions: ReactionSummary[]) => void;
}

/**
 * Reakcie (ladenie 07/2026, bod 2): jeden užívateľ = jedna reakcia, na
 * vlastný obsah sa nereaguje. Chipy sú ČISTÉ POČÍTADLÁ (ako bublina
 * komentárov) — reaguje sa výhradne cez 😊+ paletu, kde je moja aktuálna
 * reakcia zvýraznená (klik na ňu = zrušenie, iná = výmena). Pod hlavným
 * príspevkom počítadlá agregujú reakcie celého vlákna.
 */
export function ReactionBar({ targetType, targetId, reactions, canReact, onChange }: ReactionBarProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = reactions.find((r) => r.reactedByMe)?.emoji ?? null;
  // Chipy v stabilnom poradí palety, nech pri zmene reakcie neskáču.
  const chips = ALLOWED_REACTION_EMOJIS.map((emoji) => reactions.find((r) => r.emoji === emoji)).filter(
    (r): r is ReactionSummary => !!r,
  );

  const react = async (emoji: string) => {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    setError(null);
    try {
      const res = await feedApi.setReaction({ targetType, targetId, emoji: emoji as never });
      onChange(res.reactions, res.postReactions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reakcia zlyhala');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {chips.map((r) => (
        <span
          key={r.emoji}
          className={`rounded-full border px-2 py-0.5 text-xs ${
            r.reactedByMe
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300'
          }`}
        >
          {r.emoji} {r.count}
        </span>
      ))}

      {canReact && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={busy}
          className={`grid min-h-8 place-items-center rounded-full px-2 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
            mine ? 'text-accent' : 'text-neutral-500'
          }`}
          title="Pridať / zmeniť reakciu (jedna na osobu)"
          aria-label="Pridať reakciu"
        >
          <SmileyPlusIcon />
        </button>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-1 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            {ALLOWED_REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => react(emoji)}
                title={emoji === mine ? 'Zrušiť reakciu' : undefined}
                className={`rounded-lg px-1.5 py-1 text-lg transition hover:scale-125 ${
                  emoji === mine ? 'bg-accent/15 ring-1 ring-accent' : ''
                }`}
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
