import type { EventPublic } from '@rodinna/shared-types';
import { EventForm } from './EventForm';

/**
 * Dialóg tvorby udalosti pre chat [+] sheet (M4 doplnok). Od zjednotenia
 * formulárov (ladenie 07/2026, body 6+7) je to len shell okolo zdieľaného
 * `EventForm` — `roomId` zamkne viditeľnosť na danú miestnosť. Volajúci po
 * vytvorení pošle app://events/<id> správu do miestnosti.
 *
 * Zámerne <div>, nie <form> — dialóg sa renderuje vnútri chat composer formu
 * a vnorené formy sú nevalidné HTML (rovnaký dôvod ako PollComposerDialog).
 */
export function EventComposerDialog({
  roomId,
  onCreated,
  onClose,
}: {
  /** Miestnosť chatu — udalosť uvidia len jej členovia (visibility='rooms'). */
  roomId?: string;
  onCreated: (event: EventPublic) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-2.5 rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <h2 className="font-semibold">📅 Nová udalosť</h2>
        <EventForm
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
