import { useChat } from '../chat/ChatProvider';
import { Avatar } from './Avatar';

type Visibility = 'private' | 'family' | 'rooms';

/**
 * Komu je položka (poznámka/zoznam/udalosť) zdieľaná (ladenie 07/2026):
 * 🔒 len ja / 🏡 celá rodina / avatary členov vybraných podskupín. Členov
 * podskupín rieši klient z už načítaných chat miestností (bez extra requestu).
 */
export function SharedWith({
  visibility,
  roomIds,
  className = '',
}: {
  visibility: Visibility;
  roomIds: string[];
  className?: string;
}) {
  const { rooms } = useChat();

  if (visibility === 'private') {
    return <span className={`text-xs text-neutral-400 ${className}`}>🔒 Len ja</span>;
  }
  if (visibility === 'family') {
    return <span className={`text-xs text-neutral-400 ${className}`}>🏡 Celá rodina</span>;
  }

  // rooms: zjednoť členov všetkých priradených miestností (okrem duplicít).
  const byId = new Map<string, { id: string; displayName: string; avatarUrl: string | null }>();
  for (const r of rooms) {
    if (!roomIds.includes(r.id)) continue;
    for (const m of r.members) byId.set(m.id, m);
  }
  const members = [...byId.values()];
  if (members.length === 0) {
    return <span className={`text-xs text-neutral-400 ${className}`}>👥 Podskupiny</span>;
  }
  const shown = members.slice(0, 5);
  return (
    <span className={`flex items-center ${className}`} title={members.map((m) => m.displayName).join(', ')}>
      <span className="flex -space-x-1.5">
        {shown.map((m) => (
          <span key={m.id} className="rounded-full ring-2 ring-white dark:ring-neutral-900">
            <Avatar user={m} size={20} />
          </span>
        ))}
      </span>
      {members.length > shown.length && (
        <span className="ml-1 text-xs text-neutral-400">+{members.length - shown.length}</span>
      )}
    </span>
  );
}
