import type { ChatRoomPublic } from '@rodinna/shared-types';
import { Avatar } from '../shared/Avatar';
import { useChat } from './ChatProvider';
import { formatRoomTime } from './chatTime';

interface RoomListProps {
  rooms: ChatRoomPublic[];
  activeRoomId: string | null;
  meId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}

function otherMember(room: ChatRoomPublic, meId: string) {
  return room.members.find((m) => m.id !== meId) ?? null;
}

function displayName(room: ChatRoomPublic, meId: string): string {
  if (room.kind === 'family') return room.title ?? 'Rodina';
  if (room.kind === 'group') return room.title ?? 'Skupina';
  return otherMember(room, meId)?.displayName ?? 'Konverzácia';
}

export function RoomList({ rooms, activeRoomId, meId, onSelect, onNewChat }: RoomListProps) {
  const { isOnline, typingIn } = useChat();

  const preview = (room: ChatRoomPublic): string => {
    const typing = typingIn(room.id).filter((t) => t.userId !== meId);
    if (typing.length > 0) return room.kind === 'dm' ? 'píše…' : `${typing[0]!.displayName} píše…`;
    const lm = room.lastMessage;
    if (!lm) return 'Zatiaľ žiadne správy';
    if (lm.deleted) return 'Správa bola zmazaná';
    const prefix = room.kind !== 'dm' ? `${lm.author.id === meId ? 'Ty' : lm.author.displayName}: ` : '';
    if (!lm.bodyMd && lm.media.length > 0) return `${prefix}📷 Fotka`;
    return `${prefix}${lm.bodyMd}`;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
        <h2 className="text-lg font-semibold">Správy</h2>
        <button
          type="button"
          onClick={onNewChat}
          className="rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
        >
          + Nová
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rooms.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-neutral-400">Žiadne konverzácie</p>
        )}
        {rooms.map((room) => {
          const other = otherMember(room, meId);
          const online = room.kind === 'dm' && other ? isOnline(other.id) : false;
          const typing = typingIn(room.id).some((t) => t.userId !== meId);
          const active = room.id === activeRoomId;
          return (
            <button
              key={room.id}
              type="button"
              onClick={() => onSelect(room.id)}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
                active ? 'bg-accent/10' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              <div className="relative shrink-0">
                {room.kind === 'dm' && other ? (
                  <Avatar user={other} size={48} />
                ) : (
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-accent-teal/20 text-xl">
                    {room.kind === 'family' ? '🏡' : '👥'}
                  </div>
                )}
                {online && (
                  <span className="absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-green-500 dark:border-neutral-900" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{displayName(room, meId)}</span>
                  {room.lastMessage && (
                    <span className="shrink-0 text-xs text-neutral-400">
                      {formatRoomTime(room.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${typing ? 'text-accent' : 'text-neutral-500'}`}>
                    {preview(room)}
                  </span>
                  {room.unreadCount > 0 && (
                    <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-xs font-medium text-white">
                      {room.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
