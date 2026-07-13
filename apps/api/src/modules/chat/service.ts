import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  type ChatMember,
  type ChatRoomPublic,
  type CreateRoomInput,
  type MessagePublic,
  type MessagesPage,
  type PostAuthor,
  type ReactionSummary,
  type ReplyPreview,
  type SendMessageInput,
} from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import {
  chatRooms,
  media,
  messageMedia,
  messages,
  reactions,
  roomMembers,
  users,
  type ChatRoomRow,
  type MessageRow,
} from '../../core/db/schema';
import { toMediaPublic } from '../media/service';
import { decodeCursor, encodeCursor, type Cursor } from '../feed/cursor';
import { advanceRead } from './state';
import { broadcastToRoom, broadcastToUser, joinRoomTopic } from './realtime';
import { notifyNewMessage } from './notify';

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class BadRequestError extends Error {}

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;
const FAMILY_KEY = '__family__';
const REPLY_PREVIEW_LEN = 120;

function truncate(s: string, n = REPLY_PREVIEW_LEN): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Kanonický kľúč DM — zoradené id páru, nech (A,B) a (B,A) ukazujú na tú istú miestnosť. */
function dmKeyOf(a: string, b: string): string {
  return [a, b].sort().join(':');
}

// ── Hydratácia ───────────────────────────────────────────────────────────────

async function fetchAuthors(userIds: string[]): Promise<Map<string, PostAuthor>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, nameColor: users.nameColor })
    .from(users)
    .where(inArray(users.id, userIds));
  return new Map(rows.map((r) => [r.id, r]));
}

async function fetchMessageMedia(messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, ReturnType<typeof toMediaPublic>[]>();
  const rows = await db
    .select({ messageId: messageMedia.messageId, order: messageMedia.order, media })
    .from(messageMedia)
    .innerJoin(media, eq(messageMedia.mediaId, media.id))
    .where(inArray(messageMedia.messageId, messageIds))
    .orderBy(messageMedia.messageId, messageMedia.order);

  const map = new Map<string, ReturnType<typeof toMediaPublic>[]>();
  for (const r of rows) {
    const list = map.get(r.messageId) ?? [];
    list.push(toMediaPublic(r.media));
    map.set(r.messageId, list);
  }
  return map;
}

async function fetchMessageReactions(
  messageIds: string[],
  viewerId: string,
): Promise<Map<string, ReactionSummary[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({
      targetId: reactions.targetId,
      emoji: reactions.emoji,
      count: sql<number>`count(*)::int`,
      reactedByMe: sql<boolean>`bool_or(${reactions.userId} = ${viewerId})`,
    })
    .from(reactions)
    .where(and(eq(reactions.targetType, 'message'), inArray(reactions.targetId, messageIds)))
    .groupBy(reactions.targetId, reactions.emoji);

  const map = new Map<string, ReactionSummary[]>();
  for (const r of rows) {
    const list = map.get(r.targetId) ?? [];
    list.push({ emoji: r.emoji, count: r.count, reactedByMe: r.reactedByMe });
    map.set(r.targetId, list);
  }
  return map;
}

async function fetchReplyPreviews(replyIds: string[]): Promise<Map<string, ReplyPreview>> {
  if (replyIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: messages.id,
      bodyMd: messages.bodyMd,
      deletedAt: messages.deletedAt,
      authorName: users.displayName,
    })
    .from(messages)
    .innerJoin(users, eq(messages.authorId, users.id))
    .where(inArray(messages.id, replyIds));

  const withMedia = await db
    .selectDistinct({ messageId: messageMedia.messageId })
    .from(messageMedia)
    .where(inArray(messageMedia.messageId, replyIds));
  const mediaSet = new Set(withMedia.map((r) => r.messageId));

  return new Map(
    rows.map((r) => {
      const deleted = r.deletedAt !== null;
      const preview: ReplyPreview = {
        id: r.id,
        authorName: r.authorName,
        preview: deleted ? '' : truncate(r.bodyMd),
        hasMedia: mediaSet.has(r.id),
        deleted,
      };
      return [r.id, preview];
    }),
  );
}

async function hydrateMessages(rows: MessageRow[], viewerId: string): Promise<MessagePublic[]> {
  if (rows.length === 0) return [];
  const live = rows.filter((r) => r.deletedAt === null);
  const liveIds = live.map((r) => r.id);
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((v): v is string => v !== null))];

  const [authors, mediaMap, reactionMap, replyMap] = await Promise.all([
    fetchAuthors(authorIds),
    fetchMessageMedia(liveIds),
    fetchMessageReactions(liveIds, viewerId),
    fetchReplyPreviews(replyIds),
  ]);

  return rows.map((row) => {
    const deleted = row.deletedAt !== null;
    return {
      id: row.id,
      roomId: row.roomId,
      author: authors.get(row.authorId)!,
      bodyMd: deleted ? '' : row.bodyMd,
      media: deleted ? [] : mediaMap.get(row.id) ?? [],
      reactions: deleted ? [] : reactionMap.get(row.id) ?? [],
      replyTo: row.replyToId ? replyMap.get(row.replyToId) ?? null : null,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
      deleted,
    };
  });
}

// ── Miestnosti ─────────────────────────────────────────────────────────────

/** Overí členstvo; vracia rolu člena alebo hodí NotFound (nepriznáva existenciu cudzej miestnosti). */
async function requireMembership(roomId: string, userId: string): Promise<'owner' | 'member'> {
  const rows = await db
    .select({ role: roomMembers.role })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Miestnosť nenájdená');
  return rows[0].role;
}

/** Zostaví verejný tvar miestností pre konkrétneho diváka (členovia, posledná správa, neprečítané). */
async function buildRooms(rooms: ChatRoomRow[], viewerId: string): Promise<ChatRoomPublic[]> {
  if (rooms.length === 0) return [];
  const roomIds = rooms.map((r) => r.id);

  // Členovia všetkých miestností naraz.
  const memberRows = await db
    .select({
      roomId: roomMembers.roomId,
      role: roomMembers.role,
      lastReadAt: roomMembers.lastReadAt,
      mutedUntil: roomMembers.mutedUntil,
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      nameColor: users.nameColor,
    })
    .from(roomMembers)
    .innerJoin(users, eq(roomMembers.userId, users.id))
    .where(inArray(roomMembers.roomId, roomIds));

  const membersByRoom = new Map<string, ChatMember[]>();
  const myMuted = new Map<string, Date | null>();
  for (const m of memberRows) {
    const list = membersByRoom.get(m.roomId) ?? [];
    list.push({
      id: m.userId,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
      nameColor: m.nameColor,
      role: m.role,
      lastReadAt: m.lastReadAt?.toISOString() ?? null,
    });
    membersByRoom.set(m.roomId, list);
    if (m.userId === viewerId) myMuted.set(m.roomId, m.mutedUntil);
  }

  // Posledná správa každej miestnosti (vrátane zmazanej → placeholder).
  const lastRows = await db
    .selectDistinctOn([messages.roomId])
    .from(messages)
    .where(inArray(messages.roomId, roomIds))
    .orderBy(messages.roomId, desc(messages.createdAt), desc(messages.id));
  const lastByRoom = new Map<string, MessagePublic>();
  const hydratedLast = await hydrateMessages(lastRows, viewerId);
  for (const m of hydratedLast) lastByRoom.set(m.roomId, m);

  // Neprečítané: správy po mojom lastReadAt, nie odo mňa, nezmazané.
  const unreadRows = await db
    .select({ roomId: messages.roomId, count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(
      roomMembers,
      and(eq(roomMembers.roomId, messages.roomId), eq(roomMembers.userId, viewerId)),
    )
    .where(
      and(
        inArray(messages.roomId, roomIds),
        isNull(messages.deletedAt),
        ne(messages.authorId, viewerId),
        or(
          isNull(roomMembers.lastReadAt),
          sql`${messages.createdAt} > ${roomMembers.lastReadAt}`,
        ),
      ),
    )
    .groupBy(messages.roomId);
  const unreadByRoom = new Map(unreadRows.map((r) => [r.roomId, r.count]));

  const result: ChatRoomPublic[] = rooms.map((room) => ({
    id: room.id,
    kind: room.kind,
    title: room.title,
    avatarUrl: room.avatarUrl,
    members: membersByRoom.get(room.id) ?? [],
    lastMessage: lastByRoom.get(room.id) ?? null,
    unreadCount: unreadByRoom.get(room.id) ?? 0,
    mutedUntil: myMuted.get(room.id)?.toISOString() ?? null,
    createdAt: room.createdAt.toISOString(),
  }));

  // Najnovšia aktivita hore (miestnosti bez správ podľa dátumu založenia).
  result.sort((a, b) => {
    const ta = a.lastMessage?.createdAt ?? a.createdAt;
    const tb = b.lastMessage?.createdAt ?? b.createdAt;
    return tb.localeCompare(ta);
  });
  return result;
}

/** Zaistí jedinú „Rodina" miestnosť (sentinel dmKey = race-safe) a členstvo diváka v nej. */
async function ensureFamilyRoom(viewerId: string): Promise<void> {
  await db
    .insert(chatRooms)
    .values({ kind: 'family', title: 'Rodina', dmKey: FAMILY_KEY })
    .onConflictDoNothing();
  const famRows = await db.select().from(chatRooms).where(eq(chatRooms.dmKey, FAMILY_KEY)).limit(1);
  const fam = famRows[0]!;
  // Doplň všetkých členov (vrátane neskôr pozvaných) — lacný upsert pre ≤10 ľudí.
  const all = await db.select({ id: users.id }).from(users);
  if (all.length > 0) {
    await db
      .insert(roomMembers)
      .values(all.map((u) => ({ roomId: fam.id, userId: u.id })))
      .onConflictDoNothing();
  }
}

export async function listRooms(viewerId: string): Promise<ChatRoomPublic[]> {
  await ensureFamilyRoom(viewerId);
  const myRoomIds = (
    await db
      .select({ roomId: roomMembers.roomId })
      .from(roomMembers)
      .where(eq(roomMembers.userId, viewerId))
  ).map((r) => r.roomId);
  if (myRoomIds.length === 0) return [];
  const rooms = await db.select().from(chatRooms).where(inArray(chatRooms.id, myRoomIds));
  return buildRooms(rooms, viewerId);
}

export async function getRoom(roomId: string, viewerId: string): Promise<ChatRoomPublic> {
  await requireMembership(roomId, viewerId);
  const rows = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId)).limit(1);
  if (!rows[0]) throw new NotFoundError('Miestnosť nenájdená');
  const [room] = await buildRooms([rows[0]], viewerId);
  return room!;
}

async function verifyUsersExist(ids: string[]): Promise<void> {
  const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
  if (found.length !== ids.length) throw new BadRequestError('Niektorí členovia neexistujú');
}

/** Po založení miestnosti rozošle „room:new" + dosubscribuje živé sockety členov. */
async function announceRoom(roomId: string, memberIds: string[]): Promise<void> {
  for (const uid of memberIds) {
    joinRoomTopic(uid, roomId);
    const room = await getRoom(roomId, uid);
    broadcastToUser(uid, { t: 'room:new', room });
  }
}

export async function createRoom(creatorId: string, input: CreateRoomInput): Promise<ChatRoomPublic> {
  if (input.kind === 'dm') {
    const otherId = input.memberIds[0]!;
    if (otherId === creatorId) throw new BadRequestError('S DM samým sebou to nepôjde');
    await verifyUsersExist([otherId]);

    const key = dmKeyOf(creatorId, otherId);
    // Race-safe: unikátny dmKey → onConflictDoNothing, potom re-select.
    await db
      .insert(chatRooms)
      .values({ kind: 'dm', dmKey: key, createdBy: creatorId })
      .onConflictDoNothing();
    const roomRows = await db.select().from(chatRooms).where(eq(chatRooms.dmKey, key)).limit(1);
    const room = roomRows[0]!;
    await db
      .insert(roomMembers)
      .values([
        { roomId: room.id, userId: creatorId },
        { roomId: room.id, userId: otherId },
      ])
      .onConflictDoNothing();

    await announceRoom(room.id, [creatorId, otherId]);
    return getRoom(room.id, creatorId);
  }

  // group
  const memberIds = [...new Set([creatorId, ...input.memberIds])];
  await verifyUsersExist(memberIds.filter((id) => id !== creatorId));
  const inserted = await db
    .insert(chatRooms)
    .values({ kind: 'group', title: input.title!, createdBy: creatorId })
    .returning();
  const room = inserted[0]!;
  await db.insert(roomMembers).values(
    memberIds.map((userId) => ({
      roomId: room.id,
      userId,
      role: (userId === creatorId ? 'owner' : 'member') as 'owner' | 'member',
    })),
  );

  await announceRoom(room.id, memberIds);
  return getRoom(room.id, creatorId);
}

// ── Správy ───────────────────────────────────────────────────────────────────

export async function listMessages(
  roomId: string,
  viewerId: string,
  opts: { limit?: number; cursorRaw?: string | null },
): Promise<MessagesPage> {
  await requireMembership(roomId, viewerId);
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor: Cursor | null = opts.cursorRaw ? decodeCursor(opts.cursorRaw) : null;

  const where = [eq(messages.roomId, roomId)];
  if (cursor) {
    const cAt = new Date(cursor.createdAt);
    where.push(
      or(lt(messages.createdAt, cAt), and(eq(messages.createdAt, cAt), lt(messages.id, cursor.id)))!,
    );
  }

  const rows = await db
    .select()
    .from(messages)
    .where(and(...where))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

  // Vzostupne pre zobrazenie (najstaršia hore).
  const ordered = [...pageRows].reverse();
  const hydrated = await hydrateMessages(ordered, viewerId);
  return { messages: hydrated, nextCursor };
}

export async function sendMessage(
  roomId: string,
  author: PostAuthor,
  input: SendMessageInput,
): Promise<MessagePublic> {
  await requireMembership(roomId, author.id);

  const mediaIds = input.mediaIds ?? [];
  if (mediaIds.length > 0) {
    const owned = await db
      .select({ id: media.id })
      .from(media)
      .where(and(inArray(media.id, mediaIds), eq(media.ownerId, author.id)));
    if (owned.length !== mediaIds.length) {
      throw new ForbiddenError('Niektoré prílohy neexistujú alebo nie sú tvoje');
    }
  }

  const replyToId = input.replyToId ?? null;
  if (replyToId) {
    const r = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, replyToId), eq(messages.roomId, roomId)))
      .limit(1);
    if (!r[0]) throw new NotFoundError('Správa, na ktorú odpovedáš, neexistuje');
  }

  const inserted = await db
    .insert(messages)
    .values({ roomId, authorId: author.id, bodyMd: input.bodyMd, replyToId })
    .returning();
  const msg = inserted[0]!;

  if (mediaIds.length > 0) {
    await db
      .insert(messageMedia)
      .values(mediaIds.map((mediaId, order) => ({ messageId: msg.id, mediaId, order })));
  }

  // Autor automaticky „prečítal" vlastnú správu — neprečítané mu nenarastú.
  // (advanceRead nastaví ukazovateľ s plnou presnosťou priamo z created_at.)
  await advanceRead(author.id, roomId, msg.id);

  const [hydrated] = await hydrateMessages([msg], author.id);
  broadcastToRoom(roomId, { t: 'message:new', message: hydrated! });
  // Push pre offline členov — fire-and-forget, odpoveď naň nečaká.
  void notifyNewMessage(hydrated!).catch((err) => console.error('notifyNewMessage zlyhal:', err));
  return hydrated!;
}

async function getLiveMessage(messageId: string): Promise<MessageRow> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Správa nenájdená');
  return rows[0];
}

export async function editMessage(
  messageId: string,
  userId: string,
  bodyMd: string,
): Promise<MessagePublic> {
  const msg = await getLiveMessage(messageId);
  await requireMembership(msg.roomId, userId);
  if (msg.authorId !== userId) throw new ForbiddenError('Upraviť môžeš len svoju správu');

  const updated = await db
    .update(messages)
    .set({ bodyMd, editedAt: new Date() })
    .where(eq(messages.id, messageId))
    .returning();
  const [hydrated] = await hydrateMessages([updated[0]!], userId);
  broadcastToRoom(msg.roomId, { t: 'message:edit', message: hydrated! });
  return hydrated!;
}

export async function deleteMessage(
  messageId: string,
  userId: string,
  isAdmin: boolean,
): Promise<{ roomId: string }> {
  const msg = await getLiveMessage(messageId);
  await requireMembership(msg.roomId, userId);
  if (msg.authorId !== userId && !isAdmin) {
    throw new ForbiddenError('Nemáš oprávnenie zmazať túto správu');
  }
  await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, messageId));
  broadcastToRoom(msg.roomId, { t: 'message:delete', roomId: msg.roomId, messageId });
  return { roomId: msg.roomId };
}

/** Toggle reakcia na správe (zdieľaná tabuľka reactions, targetType 'message'). */
export async function setMessageReaction(
  messageId: string,
  userId: string,
  emoji: string,
): Promise<{ roomId: string; reactions: ReactionSummary[] }> {
  const msg = await getLiveMessage(messageId);
  await requireMembership(msg.roomId, userId);

  const existingRows = await db
    .select()
    .from(reactions)
    .where(
      and(
        eq(reactions.targetType, 'message'),
        eq(reactions.targetId, messageId),
        eq(reactions.userId, userId),
      ),
    )
    .limit(1);
  const existing = existingRows[0];

  if (existing && existing.emoji === emoji) {
    await db.delete(reactions).where(eq(reactions.id, existing.id));
  } else if (existing) {
    await db.update(reactions).set({ emoji }).where(eq(reactions.id, existing.id));
  } else {
    await db.insert(reactions).values({ targetType: 'message', targetId: messageId, userId, emoji });
  }

  const summary = (await fetchMessageReactions([messageId], userId)).get(messageId) ?? [];
  broadcastToRoom(msg.roomId, {
    t: 'message:reaction',
    roomId: msg.roomId,
    messageId,
    reactions: summary,
  });
  return { roomId: msg.roomId, reactions: summary };
}

export async function markRead(
  userId: string,
  roomId: string,
  messageId: string,
): Promise<{ lastReadAt: string; lastReadMessageId: string } | null> {
  await requireMembership(roomId, userId);
  const adv = await advanceRead(userId, roomId, messageId);
  if (adv) {
    broadcastToRoom(roomId, {
      t: 'read',
      roomId,
      userId,
      lastReadAt: adv.lastReadAt,
      lastReadMessageId: adv.lastReadMessageId,
    });
  }
  return adv;
}
