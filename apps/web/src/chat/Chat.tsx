import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useChat } from './ChatProvider';
import { RoomList } from './RoomList';
import { Conversation } from './Conversation';
import { NewChatDialog } from './NewChatDialog';

/** Chat: responzívne dva panely. Desktop = zoznam + konverzácia vedľa seba;
 *  mobil = jeden z nich (späť tlačidlom). `initialRoomId` = deep link
 *  (klik na push notifikáciu → /?room=…). */
export function Chat({ initialRoomId = null }: { initialRoomId?: string | null }) {
  const { user } = useAuth();
  const { rooms, connected } = useChat();
  const [selectedId, setSelectedId] = useState<string | null>(initialRoomId);
  const [showNew, setShowNew] = useState(false);

  const meId = user?.id ?? '';
  const selectedRoom = rooms.find((r) => r.id === selectedId) ?? null;

  // Ak vybraná miestnosť zmizne zo zoznamu, zruš výber. (Prázdny zoznam =
  // ešte sa načítava — deep link z push notifikácie musí prežiť prvý render.)
  useEffect(() => {
    if (selectedId && rooms.length > 0 && !rooms.some((r) => r.id === selectedId)) {
      setSelectedId(null);
    }
  }, [rooms, selectedId]);

  return (
    <div className="flex h-full flex-col">
      {!connected && (
        <div className="shrink-0 bg-amber-100 px-3 py-1 text-center text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          Pripájam sa…
        </div>
      )}
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 md:grid-cols-[320px_1fr]">
        {/* min-w-0: bez neho má grid položka min-width:auto a dlhý „nowrap"
            náhľad správy ju v portréte roztiahne za viewport (ladenie 07/2026)
            → „+ Nová" a koniec náhľadu vypadnú mimo obrazovku. */}
        <div
          className={`min-h-0 min-w-0 overflow-hidden border-neutral-200 md:border-r dark:border-neutral-800 ${
            selectedRoom ? 'hidden md:block' : 'block'
          }`}
        >
          <RoomList
            rooms={rooms}
            activeRoomId={selectedId}
            meId={meId}
            onSelect={setSelectedId}
            onNewChat={() => setShowNew(true)}
          />
        </div>

        {/* Na mobile otvorená konverzácia prekryje celý viewport vrátane
            app baru a bottom navu (WhatsApp pattern); na desktope je to
            pravý panel vedľa zoznamu. */}
        <div
          className={
            selectedRoom
              ? 'fixed inset-0 z-40 app-bg md:static md:z-auto md:min-h-0 md:min-w-0'
              : 'hidden min-h-0 md:block'
          }
          style={selectedRoom ? { paddingTop: 'env(safe-area-inset-top)' } : undefined}
        >
          {selectedRoom ? (
            <Conversation room={selectedRoom} meId={meId} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-neutral-400">
              <div>
                <div className="mb-2 text-5xl">💬</div>
                Vyber konverzáciu alebo začni novú.
              </div>
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewChatDialog
          meId={meId}
          onClose={() => setShowNew(false)}
          onCreated={(id) => setSelectedId(id)}
        />
      )}
    </div>
  );
}
