import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ChatRoomPublic, ServerWsEvent } from '@rodinna/shared-types';
import { useAuth } from '../auth/AuthContext';
import { chatApi } from '../lib/api';
import { ChatSocket } from './chatSocket';

interface TypingEntry {
  displayName: string;
  at: number;
}

interface ChatState {
  connected: boolean;
  rooms: ChatRoomPublic[];
  online: Set<string>;
  lastSeen: Record<string, string | null>;
  typing: Record<string, Record<string, TypingEntry>>;
}

interface ChatContextValue {
  connected: boolean;
  rooms: ChatRoomPublic[];
  totalUnread: number;
  isOnline: (userId: string) => boolean;
  lastSeenOf: (userId: string) => string | null;
  typingIn: (roomId: string) => { userId: string; displayName: string }[];
  setActiveRoom: (roomId: string | null) => void;
  refreshRooms: () => Promise<void>;
  upsertRoom: (room: ChatRoomPublic) => void;
  sendTyping: (roomId: string, state: 'start' | 'stop') => void;
  markRead: (roomId: string, messageId: string) => void;
  subscribe: (l: (e: ServerWsEvent) => void) => () => void;
}

const TYPING_TTL = 6000;

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const meId = user?.id ?? null;

  const [state, setState] = useState<ChatState>({
    connected: false,
    rooms: [],
    online: new Set(),
    lastSeen: {},
    typing: {},
  });

  const socketRef = useRef<ChatSocket | null>(null);
  const activeRoomRef = useRef<string | null>(null);
  const listenersRef = useRef(new Set<(e: ServerWsEvent) => void>());

  const refreshRooms = useRef(async () => {
    try {
      const { rooms } = await chatApi.listRooms();
      setState((s) => ({ ...s, rooms }));
    } catch {
      /* ticho — reconnect to skúsi znova */
    }
  }).current;

  // Pripojenie socketu počas prihlásenia.
  useEffect(() => {
    if (!meId) return;
    const socket = new ChatSocket();
    socketRef.current = socket;

    const offStatus = socket.onStatus((connected) => {
      setState((s) => ({ ...s, connected }));
      if (connected) void refreshRooms();
    });

    const offEvent = socket.onEvent((e) => {
      handleEvent(e);
      for (const l of listenersRef.current) l(e);
    });

    void refreshRooms();
    socket.connect();

    return () => {
      offStatus();
      offEvent();
      socket.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  // Prune typing indikátorov.
  useEffect(() => {
    const iv = setInterval(() => {
      setState((s) => {
        const now = Date.now();
        let changed = false;
        const typing: ChatState['typing'] = {};
        for (const [roomId, users] of Object.entries(s.typing)) {
          const kept: Record<string, TypingEntry> = {};
          for (const [uid, t] of Object.entries(users)) {
            if (now - t.at < TYPING_TTL) kept[uid] = t;
            else changed = true;
          }
          if (Object.keys(kept).length > 0) typing[roomId] = kept;
        }
        return changed ? { ...s, typing } : s;
      });
    }, 1500);
    return () => clearInterval(iv);
  }, []);

  function bumpRoom(rooms: ChatRoomPublic[], roomId: string, mut: (r: ChatRoomPublic) => ChatRoomPublic) {
    const idx = rooms.findIndex((r) => r.id === roomId);
    if (idx === -1) return rooms;
    const updated = mut(rooms[idx]!);
    const next = [...rooms.slice(0, idx), ...rooms.slice(idx + 1)];
    next.unshift(updated);
    return next;
  }

  function handleEvent(e: ServerWsEvent) {
    switch (e.t) {
      case 'ready':
        setState((s) => ({ ...s, online: new Set(e.onlineUserIds) }));
        return;

      case 'presence':
        setState((s) => {
          const online = new Set(s.online);
          if (e.online) online.add(e.userId);
          else online.delete(e.userId);
          return { ...s, online, lastSeen: { ...s.lastSeen, [e.userId]: e.lastSeenAt } };
        });
        return;

      case 'typing':
        setState((s) => {
          const room = { ...(s.typing[e.roomId] ?? {}) };
          if (e.state === 'stop') delete room[e.userId];
          else room[e.userId] = { displayName: e.displayName, at: Date.now() };
          return { ...s, typing: { ...s.typing, [e.roomId]: room } };
        });
        return;

      case 'message:new': {
        const m = e.message;
        const fromMe = m.author.id === meId;
        const isActive = activeRoomRef.current === m.roomId && document.visibilityState === 'visible';
        // V aktívnej a viditeľnej miestnosti rovno potvrď prečítanie.
        if (!fromMe && isActive) markReadRef.current(m.roomId, m.id);
        setState((s) => {
          const exists = s.rooms.some((r) => r.id === m.roomId);
          if (!exists) {
            void refreshRooms();
            return s;
          }
          const rooms = bumpRoom(s.rooms, m.roomId, (r) => ({
            ...r,
            lastMessage: m,
            unreadCount: fromMe || isActive ? r.unreadCount : r.unreadCount + 1,
          }));
          // typing tej osoby zhasni (poslala správu)
          const roomTyping = { ...(s.typing[m.roomId] ?? {}) };
          delete roomTyping[m.author.id];
          return { ...s, rooms, typing: { ...s.typing, [m.roomId]: roomTyping } };
        });
        return;
      }

      case 'message:edit':
        setState((s) => ({
          ...s,
          rooms: s.rooms.map((r) =>
            r.lastMessage?.id === e.message.id ? { ...r, lastMessage: e.message } : r,
          ),
        }));
        return;

      case 'message:delete':
        setState((s) => ({
          ...s,
          rooms: s.rooms.map((r) =>
            r.lastMessage?.id === e.messageId
              ? { ...r, lastMessage: { ...r.lastMessage, deleted: true, bodyMd: '', media: [], reactions: [] } }
              : r,
          ),
        }));
        return;

      case 'read':
        setState((s) => ({
          ...s,
          rooms: s.rooms.map((r) => {
            if (r.id !== e.roomId) return r;
            const members = r.members.map((m) =>
              m.id === e.userId ? { ...m, lastReadAt: e.lastReadAt } : m,
            );
            // Moje vlastné prečítanie → vynuluj badge.
            return { ...r, members, unreadCount: e.userId === meId ? 0 : r.unreadCount };
          }),
        }));
        return;

      case 'room:new':
        setState((s) => (s.rooms.some((r) => r.id === e.room.id) ? s : { ...s, rooms: [e.room, ...s.rooms] }));
        return;
    }
  }

  // Reassign každý render → vždy čerstvý state.connected (handleEvent/value čítajú .current).
  const markReadRef = useRef<(roomId: string, messageId: string) => void>(() => {});
  markReadRef.current = (roomId: string, messageId: string) => {
    const socket = socketRef.current;
    if (socket && state.connected) socket.send({ t: 'read', roomId, messageId });
    else void chatApi.markRead(roomId, messageId).catch(() => {});
    setState((s) => ({
      ...s,
      rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r)),
    }));
  };

  const value = useMemo<ChatContextValue>(() => {
    const totalUnread = state.rooms.reduce((sum, r) => sum + r.unreadCount, 0);
    return {
      connected: state.connected,
      rooms: state.rooms,
      totalUnread,
      isOnline: (id) => state.online.has(id),
      lastSeenOf: (id) => state.lastSeen[id] ?? null,
      typingIn: (roomId) =>
        Object.entries(state.typing[roomId] ?? {}).map(([userId, t]) => ({
          userId,
          displayName: t.displayName,
        })),
      setActiveRoom: (roomId) => {
        activeRoomRef.current = roomId;
      },
      refreshRooms,
      upsertRoom: (room) =>
        setState((s) => {
          const rest = s.rooms.filter((r) => r.id !== room.id);
          return { ...s, rooms: [room, ...rest] };
        }),
      sendTyping: (roomId, st) => socketRef.current?.send({ t: 'typing', roomId, state: st }),
      markRead: (roomId, messageId) => markReadRef.current(roomId, messageId),
      subscribe: (l) => {
        listenersRef.current.add(l);
        return () => listenersRef.current.delete(l);
      },
    };
  }, [state, refreshRooms]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat musí byť vnútri <ChatProvider>');
  return ctx;
}
