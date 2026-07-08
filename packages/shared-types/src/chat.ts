import { z } from 'zod';
import { MediaPublicSchema } from './media';
import { PostAuthorSchema, ReactionEmojiSchema, ReactionSummarySchema } from './feed';
import { NotificationPublicSchema } from './notifications';

/**
 * Chat kontrakt (ARCHITECTURE_V2.md §7, T6) — zdieľaný medzi API a webom.
 * Obsahuje REST tvary (miestnosti, správy) aj typovaný WebSocket protokol.
 */

export const RoomKindSchema = z.enum(['dm', 'group', 'family']);
export type RoomKind = z.infer<typeof RoomKindSchema>;

/** Člen miestnosti — identita + rola + kam dočítal (pre potvrdenia o prečítaní). */
export const ChatMemberSchema = PostAuthorSchema.extend({
  role: z.enum(['owner', 'member']),
  lastReadAt: z.string().nullable(),
});
export type ChatMember = z.infer<typeof ChatMemberSchema>;

/** Náhľad správy, na ktorú sa odpovedá (citácia nad bublinou). */
export const ReplyPreviewSchema = z.object({
  id: z.string().uuid(),
  authorName: z.string(),
  preview: z.string(),
  hasMedia: z.boolean(),
  deleted: z.boolean(),
});
export type ReplyPreview = z.infer<typeof ReplyPreviewSchema>;

export const MessagePublicSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  author: PostAuthorSchema,
  bodyMd: z.string(),
  media: z.array(MediaPublicSchema),
  reactions: z.array(ReactionSummarySchema),
  replyTo: ReplyPreviewSchema.nullable(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  deleted: z.boolean(),
});
export type MessagePublic = z.infer<typeof MessagePublicSchema>;

export const ChatRoomPublicSchema = z.object({
  id: z.string().uuid(),
  kind: RoomKindSchema,
  /** null pre DM — klient zobrazí meno druhého člena. */
  title: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  members: z.array(ChatMemberSchema),
  lastMessage: MessagePublicSchema.nullable(),
  unreadCount: z.number().int(),
  mutedUntil: z.string().nullable(),
  createdAt: z.string(),
});
export type ChatRoomPublic = z.infer<typeof ChatRoomPublicSchema>;

export const RoomsListResponseSchema = z.object({
  rooms: z.array(ChatRoomPublicSchema),
});
export type RoomsListResponse = z.infer<typeof RoomsListResponseSchema>;

/** Stránka histórie — `messages` vzostupne (najstaršia prvá), cursor ide do minulosti. */
export const MessagesPageSchema = z.object({
  messages: z.array(MessagePublicSchema),
  nextCursor: z.string().nullable(),
});
export type MessagesPage = z.infer<typeof MessagesPageSchema>;

// ── Vstupy ───────────────────────────────────────────────────────────────────

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_MESSAGE_MEDIA = 10;
export const MAX_GROUP_TITLE = 80;

/** Založenie miestnosti. DM: kind='dm' + práve 1 memberId. Group: kind='group' + title. */
export const CreateRoomInputSchema = z
  .object({
    kind: z.enum(['dm', 'group']),
    memberIds: z.array(z.string().uuid()).min(1).max(50),
    title: z.string().trim().min(1).max(MAX_GROUP_TITLE).optional(),
  })
  .refine((v) => v.kind !== 'dm' || v.memberIds.length === 1, {
    message: 'DM musí mať práve jedného druhého člena',
    path: ['memberIds'],
  })
  .refine((v) => v.kind !== 'group' || (v.title?.length ?? 0) > 0, {
    message: 'Skupina potrebuje názov',
    path: ['title'],
  });
export type CreateRoomInput = z.infer<typeof CreateRoomInputSchema>;

export const SendMessageInputSchema = z
  .object({
    bodyMd: z.string().trim().max(MAX_MESSAGE_LENGTH).default(''),
    mediaIds: z.array(z.string().uuid()).max(MAX_MESSAGE_MEDIA).default([]),
    replyToId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.bodyMd.length > 0 || v.mediaIds.length > 0, {
    message: 'Správa nemôže byť prázdna',
    path: ['bodyMd'],
  });
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const EditMessageInputSchema = z.object({
  bodyMd: z.string().trim().min(1, 'Správa nemôže byť prázdna').max(MAX_MESSAGE_LENGTH),
});
export type EditMessageInput = z.infer<typeof EditMessageInputSchema>;

export const SetMessageReactionInputSchema = z.object({
  messageId: z.string().uuid(),
  emoji: ReactionEmojiSchema,
});
export type SetMessageReactionInput = z.infer<typeof SetMessageReactionInputSchema>;

export const MarkReadInputSchema = z.object({
  messageId: z.string().uuid(),
});
export type MarkReadInput = z.infer<typeof MarkReadInputSchema>;

// ── WebSocket protokol ───────────────────────────────────────────────────────
// Typovaný kontrakt cez /ws. `t` je diskriminátor. Klient validuje vstup,
// server odosiela tieto tvary; obe strany zdieľajú typy z tohto súboru.

export const TypingStateSchema = z.enum(['start', 'stop']);
export type TypingState = z.infer<typeof TypingStateSchema>;

/** Klient → server. */
export const ClientWsEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('typing'), roomId: z.string().uuid(), state: TypingStateSchema }),
  z.object({ t: z.literal('read'), roomId: z.string().uuid(), messageId: z.string().uuid() }),
  z.object({ t: z.literal('ping') }),
]);
export type ClientWsEvent = z.infer<typeof ClientWsEventSchema>;

/** Server → klient. */
export const ServerWsEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ready'), onlineUserIds: z.array(z.string().uuid()) }),
  z.object({ t: z.literal('message:new'), message: MessagePublicSchema }),
  z.object({ t: z.literal('message:edit'), message: MessagePublicSchema }),
  z.object({
    t: z.literal('message:delete'),
    roomId: z.string().uuid(),
    messageId: z.string().uuid(),
  }),
  z.object({
    t: z.literal('message:reaction'),
    roomId: z.string().uuid(),
    messageId: z.string().uuid(),
    reactions: z.array(ReactionSummarySchema),
  }),
  z.object({
    t: z.literal('typing'),
    roomId: z.string().uuid(),
    userId: z.string().uuid(),
    displayName: z.string(),
    state: TypingStateSchema,
  }),
  z.object({
    t: z.literal('presence'),
    userId: z.string().uuid(),
    online: z.boolean(),
    lastSeenAt: z.string().nullable(),
  }),
  z.object({
    t: z.literal('read'),
    roomId: z.string().uuid(),
    userId: z.string().uuid(),
    lastReadAt: z.string(),
    lastReadMessageId: z.string().uuid(),
  }),
  z.object({ t: z.literal('room:new'), room: ChatRoomPublicSchema }),
  // In-app notifikácia (M0 notifications kernel) — live update zvončeka.
  z.object({ t: z.literal('notification:new'), notification: NotificationPublicSchema }),
  // Zmena stavu ankety (M1) — klient si refetchne viewer-specific stav.
  z.object({ t: z.literal('poll:update'), pollId: z.string().uuid() }),
  // Nová karta vo feede (K1) — klient zobrazí „nový obsah" / prependne.
  z.object({ t: z.literal('feed:card'), module: z.string(), entityId: z.string().uuid() }),
  z.object({ t: z.literal('pong') }),
]);
export type ServerWsEvent = z.infer<typeof ServerWsEventSchema>;
