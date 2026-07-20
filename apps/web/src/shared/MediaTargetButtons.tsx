import { CalendarIcon, ChatIcon, ChecklistIcon, HomeIcon, PhotoIcon } from '../app/registry';

export type MediaTargetKind = 'feed' | 'chat' | 'album' | 'note' | 'event';

/**
 * Ikonové akcie nad výberom fotiek (ladenie 07/2026): Feed / Chat / Album /
 * Poznámka / Udalosť — rovnaké ikony ako v navigácii, bez textov (šetria
 * miesto v spodnej lište). Spoločné pre PhotoBrowser (feed/chat) aj detail
 * albumu. Feed a Chat = preposlanie vybraných fotiek ako nový príspevok/správa.
 */
export function MediaTargetButtons({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (kind: MediaTargetKind) => void;
}) {
  const targets: { kind: MediaTargetKind; label: string; Icon: typeof PhotoIcon }[] = [
    { kind: 'feed', label: 'Do Feedu', Icon: HomeIcon },
    { kind: 'chat', label: 'Do chatu', Icon: ChatIcon },
    { kind: 'album', label: 'Do albumu', Icon: PhotoIcon },
    { kind: 'note', label: 'Do poznámky', Icon: ChecklistIcon },
    { kind: 'event', label: 'Do udalosti', Icon: CalendarIcon },
  ];
  return (
    <>
      {targets.map(({ kind, label, Icon }) => (
        <button
          key={kind}
          type="button"
          onClick={() => onPick(kind)}
          disabled={disabled}
          title={label}
          aria-label={label}
          className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-300 text-neutral-600 transition hover:border-accent hover:text-accent disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300"
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </>
  );
}
