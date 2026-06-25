import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useChat } from './ChatProvider';
import { RoomList } from './RoomList';
import { Conversation } from './Conversation';
import { NewChatDialog } from './NewChatDialog';

/** Chat: responzívne dva panely. Desktop = zoznam + konverzácia vedľa seba;
 *  mobil = jeden z nich (späť tlačidlom). */
export function Chat() {
  const { user } = useAuth();
  const { rooms, connected } = useChat();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const meId = user?.id ?? '';
  const selectedRoom = rooms.find((r) => r.id === selectedId) ?? null;

  // Ak vybraná miestnosť zmizne zo zoznamu, zruš výber.
  useEffect(() => {
    if (selectedId && !rooms.some((r) => r.id === selectedId)) setSelectedId(null);
  }, [rooms, selectedId]);

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      {!connected && (
        <div className="bg-amber-100 px-3 py-1 text-center text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          Pripájam sa…
        </div>
      )}
      <div className="grid h-[72vh] md:grid-cols-[320px_1fr]">
        <div
          className={`min-h-0 border-neutral-200 md:border-r dark:border-neutral-800 ${
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

        <div className={`min-h-0 ${selectedRoom ? 'block' : 'hidden md:block'}`}>
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
