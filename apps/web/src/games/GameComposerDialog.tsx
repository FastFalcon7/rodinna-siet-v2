import { useState } from 'react';
import type { TttDifficulty, TttOpponent } from '@rodinna/shared-types';

/**
 * Výber súpera pred založením piškvoriek (M6 doplnok): niekto v miestnosti
 * (pôvodné správanie — karta čaká na "Prijať výzvu"), alebo počítač s jednou
 * z 3 úrovní obtiažnosti (hra sa rozbehne rovno, bot ťahá hneď po tebe).
 */
export function GameComposerDialog({
  onChosen,
  onClose,
}: {
  onChosen: (opponent: TttOpponent, difficulty: TttDifficulty) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const choose = (opponent: TttOpponent, difficulty: TttDifficulty = 'medium') => {
    if (busy) return;
    setBusy(true);
    onChosen(opponent, difficulty);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <h2 className="font-semibold">⭕ Piškvorky — proti komu?</h2>

        <button
          onClick={() => choose('human')}
          disabled={busy}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-left text-sm transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          👤 Niekto v miestnosti
          <span className="block text-xs text-neutral-500">Karta čaká, kým ju niekto prijme</span>
        </button>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-neutral-500">🤖 Počítač</p>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => choose('bot', 'easy')}
              disabled={busy}
              className="rounded-lg border border-neutral-300 px-2 py-2 text-sm transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Ľahká
            </button>
            <button
              onClick={() => choose('bot', 'medium')}
              disabled={busy}
              className="rounded-lg border border-neutral-300 px-2 py-2 text-sm transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Stredná
            </button>
            <button
              onClick={() => choose('bot', 'hard')}
              disabled={busy}
              className="rounded-lg border border-neutral-300 px-2 py-2 text-sm transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Ťažká
            </button>
          </div>
        </div>

        <button onClick={onClose} className="w-full rounded-lg px-3 py-1.5 text-sm text-neutral-500">
          Zrušiť
        </button>
      </div>
    </div>
  );
}
