import type { ChatRoomPublic } from '@rodinna/shared-types';
import { useChat } from '../chat/ChatProvider';
import { useAuth } from '../auth/AuthContext';

export type ShareVisibility = 'private' | 'family' | 'rooms';

export function roomLabel(room: ChatRoomPublic, meId: string): string {
  if (room.kind === 'dm') {
    return room.members.find((m) => m.id !== meId)?.displayName ?? 'Súkromný chat';
  }
  return room.title ?? 'Skupina';
}

/**
 * Výber viditeľnosti (ladenie 07/2026): 🔒 Len pre mňa / 👪 Celá rodina /
 * 👥 Podskupiny (multi-výber chat miestností). Spoločné pre poznámky aj
 * udalosti — hodnotu drží volajúci.
 */
export function VisibilityPicker({
  visibility,
  roomIds,
  onChange,
}: {
  visibility: ShareVisibility;
  roomIds: string[];
  onChange: (visibility: ShareVisibility, roomIds: string[]) => void;
}) {
  const { rooms } = useChat();
  const { user } = useAuth();
  const meId = user?.id ?? '';

  const options: { value: ShareVisibility; label: string }[] = [
    { value: 'private', label: '🔒 Len pre mňa' },
    { value: 'family', label: '👪 Celá rodina' },
    { value: 'rooms', label: '👥 Podskupiny' },
  ];

  const toggleRoom = (roomId: string) => {
    const next = roomIds.includes(roomId) ? roomIds.filter((r) => r !== roomId) : [...roomIds, roomId];
    onChange('rooms', next);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value, o.value === 'rooms' ? roomIds : [])}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              visibility === o.value
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {visibility === 'rooms' && (
        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-neutral-200 p-1.5 dark:border-neutral-700">
          {rooms.length === 0 && <p className="px-2 py-1 text-xs text-neutral-500">Zatiaľ nemáš žiadne skupiny.</p>}
          {rooms.map((r) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <input
                type="checkbox"
                checked={roomIds.includes(r.id)}
                onChange={() => toggleRoom(r.id)}
                className="accent-accent"
              />
              <span className="min-w-0 truncate">
                {r.kind === 'dm' ? '💬' : '👥'} {roomLabel(r, meId)}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
