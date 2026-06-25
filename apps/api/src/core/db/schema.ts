import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
  integer,
  unique,
  primaryKey,
} from 'drizzle-orm/pg-core';

/**
 * Dátový model (ARCHITECTURE_V2.md §7). T2a zavádza auth tabuľky.
 * Ďalšie moduly (posts, messages, media…) pridajú vlastné tabuľky v svojich týždňoch.
 */

export const roleEnumValues = ['admin', 'member'] as const;

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  // Nullable — užívateľ môže byť neskôr len-Passkey (T2b).
  passwordHash: text('password_hash'),
  role: text('role', { enum: roleEnumValues }).notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  pushPref: jsonb('push_pref_json'),
});

/**
 * Session = opaque token (Lucia v3 pattern). V DB ukladáme len SHA-256 hash
 * tokenu ako `id`; samotný token žije iba v HttpOnly cookie. Revokovateľné,
 * bez JWT (§8). Sliding expiration namiesto separátneho refresh tokenu.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256(token) hex
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/**
 * Pozývacie tokeny (§8): admin vygeneruje token viazaný na email, platný 7 dní.
 * V DB opäť len hash; raw token je v pozývacom linku.
 */
export const inviteTokens = pgTable('invite_tokens', {
  id: text('id').primaryKey(), // sha256(token) hex
  email: text('email').notNull(),
  role: text('role', { enum: roleEnumValues }).notNull().default('member'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Media (§7): nahrané obrázky/videá. Súbor žije na disku (MEDIA_PATH),
 * v DB len metadáta + relatívna `storage_path`. `blurhash` slúži ako
 * placeholder pred načítaním (bez CLS). `sha256` na kontrolu integrity.
 * T3 spracúva obrázky (sharp re-encode + EXIF strip); video pribudne s chatom.
 */
export const mediaKindValues = ['image', 'video'] as const;

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: mediaKindValues }).notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    storagePath: text('storage_path').notNull(),
    blurhash: text('blurhash'),
    sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('media_owner_id_idx').on(t.ownerId)],
);

/**
 * Feed (§7, T4-5): príspevky rodiny. `visibility` má zatiaľ jedinú hodnotu
 * 'family' (všetci členovia vidia všetko) — Phase 2 môže pridať kruhy/skupiny
 * bez zmeny existujúcich riadkov. Soft delete (`deletedAt`), nech komentáre
 * a reakcie pod zmazaným postom neosirie.
 */
export const postVisibilityValues = ['family'] as const;

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bodyMd: text('body_md').notNull(),
    visibility: text('visibility', { enum: postVisibilityValues }).notNull().default('family'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('posts_created_at_idx').on(t.createdAt)],
);

/** Médiá pripojené k postu (poradie v karuseli). */
export const postMedia = pgTable(
  'post_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
  },
  (t) => [index('post_media_post_id_idx').on(t.postId)],
);

/**
 * Komentáre — vnorené cez `parentCommentId`, max hĺbka 3 (§11). `depth` sa
 * dopočíta pri vytvorení (parent.depth + 1), ukladá sa nech sa nemusí
 * pri každom renderi rekurzívne počítať.
 */
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    parentCommentId: uuid('parent_comment_id'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bodyMd: text('body_md').notNull(),
    depth: integer('depth').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('comments_post_id_idx').on(t.postId), index('comments_parent_idx').on(t.parentCommentId)],
);

/**
 * Reakcie — spoločná tabuľka pre posty, komentáre aj správy v chate (T6).
 * Jedna reakcia na (target, user): nová emoji prepíše starú, rovnaká emoji = unreact.
 * `target_type` je obyčajný text (bez DB CHECK), takže pridanie 'message' nevyžaduje
 * migráciu existujúceho stĺpca.
 */
export const reactionTargetValues = ['post', 'comment', 'message'] as const;

export const reactions = pgTable(
  'reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: text('target_type', { enum: reactionTargetValues }).notNull(),
    targetId: uuid('target_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reactions_target_idx').on(t.targetType, t.targetId),
    unique('reactions_target_user_unique').on(t.targetType, t.targetId, t.userId),
  ],
);
/**
 * Chat (§7, T6) — miestnosti. `dm` = 1:1 (priama správa), `group` = ľubovoľná
 * skupina, `family` = jediná spoločná miestnosť všetkých (založí sa lazy).
 * `dmKey` je kanonický kľúč páru (zoradené user-id spojené `:`) s unique
 * indexom → garantuje práve jednu DM miestnosť na dvojicu (race-safe cez DB).
 */
export const roomKindValues = ['dm', 'group', 'family'] as const;

export const chatRooms = pgTable(
  'chat_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: roomKindValues }).notNull(),
    // null pre DM (názov sa odvodí z druhého člena); povinný len pre skupiny.
    title: text('title'),
    avatarUrl: text('avatar_url'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    // Kanonický kľúč DM ("uuidA:uuidB", zoradené). null pre group/family.
    dmKey: text('dm_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chat_rooms_kind_idx').on(t.kind)],
);

/**
 * Členstvo v miestnosti. `lastReadAt` je zdroj pravdy pre neprečítané aj
 * potvrdenia o prečítaní (správa je „videná" členom, ak `created_at <= lastReadAt`).
 * `lastReadMessageId` je len referenčné (kam doskrolovať). PK = (room, user).
 */
export const roomMemberRoleValues = ['owner', 'member'] as const;

export const roomMembers = pgTable(
  'room_members',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: roomMemberRoleValues }).notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    lastReadMessageId: uuid('last_read_message_id'),
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] }), index('room_members_user_idx').on(t.userId)],
);

/**
 * Správy. `replyToId` je self-referencia bez FK constraintu — odpovedať sa dá
 * aj na neskôr zmazanú správu (zobrazí sa „správa bola zmazaná"). Soft delete
 * (`deletedAt`) nech reakcie/odpovede neosirie. `bodyMd` môže byť prázdny, ak
 * správa nesie len prílohy.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bodyMd: text('body_md').notNull().default(''),
    replyToId: uuid('reply_to_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('messages_room_created_idx').on(t.roomId, t.createdAt)],
);

/** Médiá pripojené k správe (poradie v galérii). */
export const messageMedia = pgTable(
  'message_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
  },
  (t) => [index('message_media_message_idx').on(t.messageId)],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type InviteTokenRow = typeof inviteTokens.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
export type PostRow = typeof posts.$inferSelect;
export type PostMediaRow = typeof postMedia.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type ReactionRow = typeof reactions.$inferSelect;
export type ChatRoomRow = typeof chatRooms.$inferSelect;
export type RoomMemberRow = typeof roomMembers.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type MessageMediaRow = typeof messageMedia.$inferSelect;
