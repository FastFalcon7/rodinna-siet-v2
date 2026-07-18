import type { NoteDetail } from '@rodinna/shared-types';
import { NoteForm } from './NoteForm';

/**
 * Dialóg tvorby zoznamu/poznámky z chat [+] sheetu. Od zjednotenia formulárov
 * (ladenie 07/2026, bod 7B) je to len shell okolo zdieľaného `NoteForm` —
 * `roomId` zamkne viditeľnosť na miestnosť (visibility='rooms'); volajúci
 * po vytvorení pošle app://notes/<id> správu (živá karta K2).
 *
 * Div, nie <form> — renderuje sa vnútri chat composer formu (ako PollComposerDialog).
 */
export function NoteComposerDialog({
  roomId,
  onCreated,
  onClose,
}: {
  roomId: string;
  onCreated: (note: NoteDetail) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <h2 className="font-semibold">✅ Nový zoznam / poznámka</h2>
        <NoteForm
          roomId={roomId}
          submitLabel="Poslať do chatu"
          busyLabel="Vytváram…"
          onDone={onCreated}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
