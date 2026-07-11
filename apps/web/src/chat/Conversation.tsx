import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChatRoomPublic, MessagePublic, ServerWsEvent } from '@rodinna/shared-types';
import { chatApi } from '../lib/api';
import { Avatar } from '../shared/Avatar';
import { useChat } from './ChatProvider';
import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';
import { formatDayLabel, formatLastSeen, sameDay } from './chatTime';

interface ConversationProps {
  room: ChatRoomPublic;
  meId: string;
  onBack: () => void;
}

const GROUP_MS = 2 * 60_000;

/** Patria dve susedné správy do jednej skupiny? (rovnaký autor, < 2 min, nie zmazané) */
function grouped(a: MessagePublic | undefined, b: MessagePublic | undefined): boolean {
  if (!a || !b) return false;
  if (a.author.id !== b.author.id || a.deleted || b.deleted) return false;
  return Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < GROUP_MS;
}

function roomTitle(room: ChatRoomPublic, meId: string): string {
  if (room.kind === 'dm') {
    const other = room.members.find((m) => m.id !== meId);
    return other?.displayName ?? 'Konverzácia';
  }
  return room.title ?? 'Skupina';
}

export function Conversation({ room, meId, onBack }: ConversationProps) {
  const chat = useChat();
  const [messages, setMessages] = useState<MessagePublic[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyTo, setReplyTo] = useState<MessagePublic | null>(null);
  const [editing, setEditing] = useState<MessagePublic | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const prevHeight = useRef(0);

  const other = room.kind === 'dm' ? room.members.find((m) => m.id !== meId) : null;
  const otherReadMax = room.members
    .filter((m) => m.id !== meId)
    .reduce<string | null>((max, m) => (m.lastReadAt && (!max || m.lastReadAt > max) ? m.lastReadAt : max), null);

  const typingNames = chat.typingIn(room.id).filter((t) => t.userId !== meId).map((t) => t.displayName);

  const upsert = (m: MessagePublic) =>
    setMessages((cur) => {
      const idx = cur.findIndex((x) => x.id === m.id);
      if (idx === -1) return [...cur, m];
      const next = [...cur];
      next[idx] = m;
      return next;
    });

  // Načítaj históriu pri zmene miestnosti.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessages([]);
    setCursor(null);
    setReplyTo(null);
    setEditing(null);
    chat.setActiveRoom(room.id);
    chatApi
      .listMessages(room.id)
      .then((page) => {
        if (!alive) return;
        setMessages(page.messages);
        setCursor(page.nextCursor);
        nearBottom.current = true;
        const last = page.messages[page.messages.length - 1];
        if (last) chat.markRead(room.id, last.id);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      chat.setActiveRoom(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  // Live eventy pre túto miestnosť.
  useEffect(() => {
    const off = chat.subscribe((e: ServerWsEvent) => {
      if ('roomId' in e && e.roomId !== room.id) return;
      switch (e.t) {
        case 'message:new':
          upsert(e.message);
          if (e.message.author.id !== meId && document.visibilityState === 'visible') {
            chat.markRead(room.id, e.message.id);
          }
          break;
        case 'message:edit':
          upsert(e.message);
          break;
        case 'message:delete':
          setMessages((cur) =>
            cur.map((m) =>
              m.id === e.messageId ? { ...m, deleted: true, bodyMd: '', media: [], reactions: [] } : m,
            ),
          );
          break;
        case 'message:reaction':
          setMessages((cur) =>
            cur.map((m) => (m.id === e.messageId ? { ...m, reactions: e.reactions } : m)),
          );
          break;
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, meId]);

  // Auto-scroll na spodok po načítaní / novej správe (ak sme blízko spodku).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (loadingMore) {
      // zachovaj pozíciu pri prependovaní starších
      el.scrollTop = el.scrollHeight - prevHeight.current;
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loading, loadingMore]);

  // Fotky/videá sa donačítajú až PO prvom scrolle a obsah narastie — držme
  // pohľad prilepený na poslednej správe, kým je užívateľ pri spodku
  // (ladenie 07/2026: „po otvorení chatu nech sa zobrazí posledná správa").
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    // Pri načítavaní starších je užívateľ pri vrchu → nearBottom=false, guard netreba.
    const ro = new ResizeObserver(() => {
      if (nearBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, loading]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 80 && cursor && !loadingMore) void loadOlder();
  };

  const loadOlder = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    const el = scrollRef.current;
    prevHeight.current = el?.scrollHeight ?? 0;
    try {
      const page = await chatApi.listMessages(room.id, cursor);
      setMessages((cur) => [...page.messages, ...cur]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const subtitle = () => {
    if (typingNames.length > 0) {
      return room.kind === 'dm' ? 'píše…' : `${typingNames.join(', ')} píše…`;
    }
    if (room.kind === 'dm' && other) {
      return chat.isOnline(other.id) ? 'online' : formatLastSeen(chat.lastSeenOf(other.id));
    }
    return `${room.members.length} členov`;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-white/80 px-3 py-2 backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-900/80">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 rounded-lg px-2 py-1 text-neutral-500 hover:bg-neutral-100 md:hidden dark:hover:bg-neutral-800"
        >
          ←
        </button>
        <div className="relative">
          {other ? (
            <Avatar user={other} size={40} />
          ) : (
            <div className="grid h-10 w-10 place-items-center rounded-full bg-accent-teal/20 text-lg">👪</div>
          )}
          {other && chat.isOnline(other.id) && (
            <span className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-white bg-green-500 dark:border-neutral-900" />
          )}
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{roomTitle(room, meId)}</h2>
          <p className={`truncate text-xs ${typingNames.length ? 'text-accent' : 'text-neutral-500'}`}>
            {subtitle()}
          </p>
        </div>
      </header>

      {/* Správy */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3">
        <div ref={contentRef} className="min-h-full">
        {loadingMore && <p className="py-1 text-center text-xs text-neutral-400">Načítavam staršie…</p>}
        {loading ? (
          <p className="py-10 text-center text-sm text-neutral-400">Načítavam…</p>
        ) : messages.length === 0 ? (
          <div className="grid min-h-[60vh] place-items-center text-center text-sm text-neutral-400">
            <div>
              <div className="mb-2 text-4xl">💬</div>
              Zatiaľ žiadne správy.<br />Napíš prvú!
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const showDay = !prev || !sameDay(prev.createdAt, m.createdAt);
            const showAuthor = room.kind !== 'dm' && (!prev || prev.author.id !== m.author.id || showDay);
            const mine = m.author.id === meId;
            const seen = mine && !!otherReadMax && m.createdAt <= otherReadMax;
            // Zoskupovanie (§4.1): po sebe idúce správy autora < 2 min = skupina;
            // chvost + čas má len posledná, vnútri skupiny je menší rozostup.
            const groupWithPrev = !showDay && grouped(prev, m);
            const tail = !(next && sameDay(m.createdAt, next.createdAt) && grouped(m, next));
            return (
              <div key={m.id} className={groupWithPrev ? 'mt-0.5' : 'mt-2'}>
                {showDay && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-neutral-200/70 px-3 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
                      {formatDayLabel(m.createdAt)}
                    </span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  mine={mine}
                  showAuthor={showAuthor}
                  seen={seen}
                  tail={tail}
                  onReply={setReplyTo}
                  onEdit={setEditing}
                />
              </div>
            );
          })
        )}
        {typingNames.length > 0 && !loading && (
          <div className="flex items-center gap-1 px-1 pt-1 text-neutral-400">
            <span className="inline-flex gap-0.5">
              <Dot /> <Dot delay={150} /> <Dot delay={300} />
            </span>
          </div>
        )}
        </div>
      </div>

      <MessageComposer
        roomId={room.id}
        replyTo={replyTo}
        editing={editing}
        onClearReply={() => setReplyTo(null)}
        onClearEdit={() => setEditing(null)}
        onSent={upsert}
      />
    </div>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}
