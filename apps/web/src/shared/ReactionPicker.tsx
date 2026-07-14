import { useState } from 'react';
import { ALLOWED_REACTION_EMOJIS } from '@rodinna/shared-types';

/**
 * Výber reakcie (ladenie 07/2026): 12 rýchlych emoji v riadku + „+", ktorý
 * rozbalí veľkú paletu ďalších emoji (natívne, bez knižnice). Zdieľané pre
 * Feed (ReactionBar) aj Chat (MessageBubble) — obe si komponent vložia do
 * vlastnej vyskakovacej bublinky.
 */

/** Veľká paleta — bežné emoji naprieč kategóriami (smajlíky, gestá, srdcia, zvieratá, jedlo, aktivity, symboly). */
const EMOJI_PALETTE: string[] = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
  '😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤗','🤭','🤫','🤔','🤨','😐','😑',
  '😏','😒','🙄','😬','😌','😔','😪','😴','😷','🤒','🤕','🤢','🤮','🥳','🥺','😢',
  '😭','😤','😠','😡','🤬','😳','🥵','🥶','😱','😨','😰','😥','🤯','😎','🤓','🧐',
  '👍','👎','👏','🙌','🙏','👌','🤌','🤏','✌️','🤞','🤟','🤘','👊','✊','🤛','🤝',
  '💪','👀','🫶','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💕','💞','💓',
  '💗','💖','💘','💝','⭐','🌟','✨','⚡','🔥','💯','🎉','🎊','🎈','🎁','🏆','🥇',
  '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐷','🐮','🐔','🐧','🐦','🦄','🐝',
  '🌸','🌼','🌻','🌹','🌈','☀️','🌙','⛄','🍀','🍎','🍕','🍔','🍟','🎂','🍰','🍦',
  '☕','🍺','🍻','🥂','🍷','⚽','🏀','🎮','🎸','🎧','📷','🚗','✈️','🏠','💤','✅',
];

export function ReactionPicker({
  current,
  onPick,
}: {
  /** Aktuálna reakcia používateľa — zvýrazní sa v základnej palete. */
  current?: string | null;
  onPick: (emoji: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <div className="max-h-56 w-64 overflow-y-auto">
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJI_PALETTE.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick(e)}
              className="rounded-lg p-1 text-xl transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-60 flex-wrap items-center gap-0.5">
      {ALLOWED_REACTION_EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onPick(e)}
          title={e === current ? 'Zrušiť reakciu' : undefined}
          className={`rounded-lg px-1 py-0.5 text-xl transition hover:scale-125 ${
            e === current ? 'bg-accent/15 ring-1 ring-accent' : ''
          }`}
        >
          {e}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        title="Viac emoji"
        aria-label="Viac emoji"
        className="ml-0.5 grid h-8 w-8 place-items-center rounded-lg text-lg text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        ＋
      </button>
    </div>
  );
}
