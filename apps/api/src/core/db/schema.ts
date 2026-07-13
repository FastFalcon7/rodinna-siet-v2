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
  boolean,
  date,
  vector,
} from 'drizzle-orm/pg-core';

/**
 * Dátový model (ARCHITECTURE_V2.md §7). T2a zavádza auth tabuľky.
 * Ďalšie moduly (posts, messages, media…) pridajú vlastné tabuľky v svojich týždňoch.
 */

/**
 * Interné tajomstvá appky generované pri prvom boote (žiadny nový env var).
 * Prvý konzument: 'media_url' — HMAC kľúč pre tokeny v media URL (iOS
 * AVPlayer neposiela cookies pri prehrávaní videa, ladenie 07/2026).
 */
export const appSecrets = pgTable('app_secrets', {
  name: text('name').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  // M4: kalendár z dátumu narodenia počíta narodeniny (agenda + ranná karta).
  birthday: date('birthday'),
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
 * T3 spracúva obrázky (sharp re-encode + EXIF strip); video a iné súbory sa
 * ukladajú ako originál (bez transkódovania — NAS nemá GPU). `file_name` drží
 * pôvodný názov pre download karty (kind='file').
 */
export const mediaKindValues = ['image', 'video', 'file'] as const;

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
    fileName: text('file_name'),
    sha256: text('sha256').notNull(),
    /**
     * Video normalizácia (ladenie 07/2026): iPhone HEVC neprehrá PC bez HW
     * dekodéra → worker job 'media.transcode' pripraví H.264/AAC MP4 +
     * poster JPEG. `playbackPath` = súbor, ktorý sa reálne servíruje
     * (null/failed → originál), status: pending → done | failed.
     */
    playbackPath: text('playback_path'),
    posterPath: text('poster_path'),
    transcodeStatus: text('transcode_status', { enum: ['pending', 'done', 'failed'] }),
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

/** Médiá pripojené ku komentáru (ladenie 07/2026, bod 3) — ako postMedia. */
export const commentMedia = pgTable(
  'comment_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
  },
  (t) => [index('comment_media_comment_id_idx').on(t.commentId)],
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
export type CommentMediaRow = typeof commentMedia.$inferSelect;
export type ReactionRow = typeof reactions.$inferSelect;
export type ChatRoomRow = typeof chatRooms.$inferSelect;
export type RoomMemberRow = typeof roomMembers.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type MessageMediaRow = typeof messageMedia.$inferSelect;

/**
 * OG link preview cache (DESIGN_REVIEW_FEED_CHAT.md §3.3): každá URL sa
 * fetchne raz, metadáta sa cachujú tu, og:image ide zmenšený do media.
 * `ok=false` = negatívna cache (fetch zlyhal), po hodine sa skúsi znova.
 */
/**
 * DB-based job queue (§4, §6) — žiadny Redis pre 10 užívateľov. API (alebo
 * worker sám) joby enqueuje, worker proces ich claimuje cez
 * FOR UPDATE SKIP LOCKED a spracúva **sériovo** (jeden semafór, §15 — dôležité
 * až pre LLM joby, ale disciplína platí od začiatku). Zlyhaný job sa retryuje
 * s backoffom do `maxAttempts`, potom ostáva 'failed' na inšpekciu.
 */
export const jobStatusValues = ['pending', 'running', 'done', 'failed'] as const;

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status', { enum: jobStatusValues }).notNull().default('pending'),
    // Kedy najskôr job spustiť (odložené joby, retry backoff).
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('jobs_status_run_at_idx').on(t.status, t.runAt)],
);

/**
 * Web Push subscription per zariadenie (§7, M0). `endpoint` je unikátny
 * identifikátor zariadenia u push provideru (FCM/APNs mostík) — upsert podľa
 * neho, takže re-subscribe toho istého prehliadača neduplikuje riadky.
 * Neplatné subscriptions (410 Gone) worker pri odosielaní maže.
 */
export const pushSubs = pgTable(
  'push_subs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    // Voľný popis zariadenia (z user-agentu) pre správu subscriptions v profile.
    deviceLabel: text('device_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('push_subs_user_idx').on(t.userId)],
);

/**
 * In-app notifikácie (§7) — zvonček/„Viac". Chat správy sem nejdú (ich in-app
 * signál je unread badge); patria sem udalosti modulov: reakcia na tvoj post,
 * nový komentár, neskôr narodeniny, hotový denník… `payload` nesie title/body/url.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload_json').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_created_idx').on(t.userId, t.createdAt)],
);

/**
 * Živé karty vo Feede (plán §M0-4, kontrakt K1): karta ukazuje na entitu
 * modulu (anketa, album, udalosť…) — render + aktuálny stav si modul rieši
 * cez vlastné API, feed drží len referenciu a radenie. Prvý konzument: M1
 * Ankety (UNION s postami v paginácii feedu). V chate karta žije ako
 * `app://modul/entityId` link v tele správy — bez vlastnej tabuľky.
 */
export const feedCards = pgTable(
  'feed_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    module: text('module').notNull(),
    entityId: uuid('entity_id').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('feed_cards_created_idx').on(t.createdAt),
    unique('feed_cards_entity_unique').on(t.module, t.entityId),
  ],
);

/**
 * Ankety (plán §M1). `closedAt` = skutočné uzavretie (manuálne autorom alebo
 * worker jobom po `closesAt`) — anketa je uzavretá aj keď closesAt < now()
 * a job ešte nedobehol (server aj klient derivujú `closed` z oboch).
 */
export const pollKindValues = ['single', 'multi'] as const;

export const polls = pgTable('polls', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  kind: text('kind', { enum: pollKindValues }).notNull().default('single'),
  anonymous: boolean('anonymous').notNull().default(false),
  closesAt: timestamp('closes_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pollOptions = pgTable(
  'poll_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** Fotka možnosti (ladenie 07/2026) — anketa s obrázkovými voľbami. */
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    order: integer('order').notNull().default(0),
  },
  (t) => [index('poll_options_poll_idx').on(t.pollId)],
);

/** Hlas = (anketa, možnosť, užívateľ). Single-choice vynucuje service (replace). */
export const pollVotes = pgTable(
  'poll_votes',
  {
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => pollOptions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.pollId, t.optionId, t.userId] }),
    index('poll_votes_poll_idx').on(t.pollId),
  ],
);

/**
 * Albumy (plán §M2). Fotky = referencie na existujúce `media` riadky —
 * album nič nekopíruje. `coverMediaId` null = obálka je najnovšia fotka.
 */
export const albums = pgTable('albums', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  coverMediaId: uuid('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const albumPhotos = pgTable(
  'album_photos',
  {
    albumId: uuid('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    order: integer('order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.albumId, t.mediaId] }), index('album_photos_media_idx').on(t.mediaId)],
);

/**
 * Skryté spomienky („túto už neukazuj"). Odchýlka od plánu: globálne, nie
 * per-user — spomienková karta vo feede je jedna pre celú rodinu, takže
 * per-user skrytie by kartu aj tak nechalo visieť ostatným.
 */
export const memoryMarks = pgTable('memory_marks', {
  mediaId: uuid('media_id')
    .primaryKey()
    .references(() => media.id, { onDelete: 'cascade' }),
  hiddenBy: uuid('hidden_by').references(() => users.id, { onDelete: 'set null' }),
  hiddenAt: timestamp('hidden_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Zoznamy & Poznámky (plán §M3). Rodinne zdieľané — editovať môže každý
 * člen (to je pointa spolupráce), mazať autor/admin. Poznámka drží text
 * v `bodyMd`; zoznam má položky v note_items. Zmena textu odloží
 * predchádzajúcu verziu do note_revisions (last-write-wins + história).
 */
export const noteKindValues = ['note', 'list'] as const;
/**
 * Ladenie 07/2026: 'private' vidí len autor, 'rooms' členovia priradených
 * chat miestností (note_rooms); DB default 'family' drží staré riadky viditeľné.
 */
export const noteVisibilityValues = ['private', 'family', 'rooms'] as const;

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: noteKindValues }).notNull(),
    visibility: text('visibility', { enum: noteVisibilityValues }).notNull().default('family'),
    title: text('title').notNull(),
    bodyMd: text('body_md').notNull().default(''),
    pinned: boolean('pinned').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('notes_updated_idx').on(t.updatedAt)],
);

export const noteItems = pgTable(
  'note_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    checkedBy: uuid('checked_by').references(() => users.id, { onDelete: 'set null' }),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    order: integer('order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('note_items_note_idx').on(t.noteId)],
);

/** Zdieľanie poznámky s podskupinami — členovia miestnosti ju vidia (visibility='rooms'). */
export const noteRooms = pgTable(
  'note_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
  },
  (t) => [index('note_rooms_note_idx').on(t.noteId), unique('note_rooms_unique').on(t.noteId, t.roomId)],
);

/** Fotky/prílohy poznámky (ladenie 07/2026) — ako postMedia, family-wide. */
export const noteMedia = pgTable(
  'note_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
  },
  (t) => [index('note_media_note_idx').on(t.noteId), unique('note_media_unique').on(t.noteId, t.mediaId)],
);

export const noteRevisions = pgTable(
  'note_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    bodyMd: text('body_md').notNull(),
    savedBy: uuid('saved_by').references(() => users.id, { onDelete: 'set null' }),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('note_revisions_note_idx').on(t.noteId, t.savedAt)],
);

/**
 * Kalendár (plán §M4). `source='birthday'` riadky materializuje denný job
 * len ako nosič feed karty (agenda narodeniny počíta virtuálne
 * z users.birthday — riadok na každý rok dopredu by nedával zmysel).
 */
export const eventSourceValues = ['manual', 'birthday', 'poll', 'suggested'] as const;
export const rsvpStatusValues = ['yes', 'no', 'maybe'] as const;
/** Ladenie 07/2026: viditeľnosť udalosti ako pri poznámkach (default family — pozvánka). */
export const eventVisibilityValues = ['private', 'family', 'rooms'] as const;

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    allDay: boolean('all_day').notNull().default(false),
    location: text('location').notNull().default(''),
    bodyMd: text('body_md').notNull().default(''),
    visibility: text('visibility', { enum: eventVisibilityValues }).notNull().default('family'),
    source: text('source', { enum: eventSourceValues }).notNull().default('manual'),
    // Pri source='birthday' odkazuje na oslávenca (kvôli gratulácii z karty).
    subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('events_starts_idx').on(t.startsAt)],
);

/** Zdieľanie udalosti s podskupinami (visibility='rooms') — ako note_rooms. */
export const eventRooms = pgTable(
  'event_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => chatRooms.id, { onDelete: 'cascade' }),
  },
  (t) => [index('event_rooms_event_idx').on(t.eventId), unique('event_rooms_unique').on(t.eventId, t.roomId)],
);

/** Fotky/prílohy udalosti (ladenie 07/2026) — ako postMedia, family-wide. */
export const eventMedia = pgTable(
  'event_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
  },
  (t) => [index('event_media_event_idx').on(t.eventId), unique('event_media_unique').on(t.eventId, t.mediaId)],
);

export const eventRsvps = pgTable(
  'event_rsvps',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: rsvpStatusValues }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);

/**
 * Denník (plán §M5, §15.2) — striktne privátny (všetky dopyty filtrujú
 * podľa vlastníka). Fragmenty = quick capture cez deň; entries = jeden
 * zápis na (užívateľ, deň), vždy najprv draft; embeddingy sa počítajú
 * až po potvrdení (pgvector, nomic-embed-text 768 dim).
 */
export const diaryFragmentSourceValues = ['manual', 'feed', 'chat'] as const;
export const diaryEntryStatusValues = ['draft', 'confirmed'] as const;

export const diaryFragments = pgTable(
  'diary_fragments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull().default(''),
    mood: text('mood'),
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    source: text('source', { enum: diaryFragmentSourceValues }).notNull().default('manual'),
    sourceRefId: uuid('source_ref_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('diary_fragments_user_created_idx').on(t.userId, t.createdAt)],
);

export const diaryEntries = pgTable(
  'diary_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    bodyMd: text('body_md').notNull(),
    status: text('status', { enum: diaryEntryStatusValues }).notNull().default('draft'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('diary_entries_user_date_unique').on(t.userId, t.date)],
);

export const diaryEmbeddings = pgTable(
  'diary_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .unique()
      .references(() => diaryEntries.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Dimenzia musí sedieť s LLM_EMBED_DIM (nomic-embed-text = 768).
    embedding: vector('embedding', { dimensions: 768 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('diary_embeddings_user_idx').on(t.userId)],
);

/**
 * Hry (plán §M6). `stateJson` drží stav podľa druhu (piškvorky: board/turn/
 * hráči; denná otázka/foto výzva: question/date). Ťahy a odpovede v
 * game_moves (payloadJson). roomId len pre hry viazané na konverzáciu.
 */
export const gameKindValues = ['tictactoe', 'daily', 'photo'] as const;
export const gameStatusValues = ['open', 'active', 'finished'] as const;

export const gameSessions = pgTable(
  'game_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: gameKindValues }).notNull(),
    roomId: uuid('room_id').references(() => chatRooms.id, { onDelete: 'cascade' }),
    stateJson: jsonb('state_json').notNull().default({}),
    status: text('status', { enum: gameStatusValues }).notNull().default('open'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('game_sessions_kind_idx').on(t.kind, t.createdAt)],
);

export const gameMoves = pgTable(
  'game_moves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    payloadJson: jsonb('payload_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('game_moves_session_idx').on(t.sessionId, t.createdAt)],
);

export type GameSessionRow = typeof gameSessions.$inferSelect;

/**
 * Svet okolo (plán §M7, §15.3). news_items drží len titulok + snippet +
 * link (copyright: nikdy celý článok); unique(url) = dedupe pri opakovanom
 * fetchi. Preferencie sú opt-in per užívateľ a kategória.
 */
export const userNewsPrefs = pgTable(
  'user_news_prefs',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.category] })],
);

export const newsItems = pgTable(
  'news_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    snippet: text('snippet').notNull().default(''),
    source: text('source').notNull(),
    url: text('url').notNull().unique(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('news_items_cat_pub_idx').on(t.category, t.publishedAt)],
);

export type NewsItemRow = typeof newsItems.$inferSelect;

/**
 * Kvízy (plán §M8). LLM vygeneruje otázky na zadanú tému vo worker jobe;
 * questions_json = [{q, options[4], correct}] — vzniká ako DRAFT, autor
 * skontroluje (human-in-the-loop, malý model halucinuje) a publikuje.
 * audience: private (len autor) / room (členovia miestnosti, karta v chate)
 * / family (karta vo Feede). quiz_answers = jeden pokus na užívateľa
 * (skóre počíta server, výsledky vidíš po vlastnom dohraní).
 */
export const quizStatusValues = ['generating', 'draft', 'published', 'failed'] as const;
export const quizAudienceValues = ['private', 'room', 'family'] as const;

export const quizzes = pgTable(
  'quizzes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topic: text('topic').notNull(),
    title: text('title').notNull().default(''),
    facts: text('facts'),
    questionCount: integer('question_count').notNull().default(5),
    questionsJson: jsonb('questions_json').notNull().default([]),
    status: text('status', { enum: quizStatusValues }).notNull().default('generating'),
    audience: text('audience', { enum: quizAudienceValues }).notNull(),
    roomId: uuid('room_id').references(() => chatRooms.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [index('quizzes_created_by_idx').on(t.createdBy, t.createdAt)],
);

export const quizAnswers = pgTable(
  'quiz_answers',
  {
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    answersJson: jsonb('answers_json').notNull(),
    score: integer('score').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.quizId, t.userId] })],
);

export type QuizRow = typeof quizzes.$inferSelect;

export type JobRow = typeof jobs.$inferSelect;
export type PushSubRow = typeof pushSubs.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type FeedCardRow = typeof feedCards.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type DiaryEntryRow = typeof diaryEntries.$inferSelect;
export type DiaryFragmentRow = typeof diaryFragments.$inferSelect;
export type PollRow = typeof polls.$inferSelect;
export type PollOptionRow = typeof pollOptions.$inferSelect;
export type AlbumRow = typeof albums.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type NoteItemRow = typeof noteItems.$inferSelect;

export const linkPreviews = pgTable('link_previews', {
  id: uuid('id').primaryKey().defaultRandom(),
  urlHash: text('url_hash').notNull().unique(),
  url: text('url').notNull(),
  ok: boolean('ok').notNull().default(false),
  title: text('title'),
  description: text('description'),
  siteName: text('site_name'),
  imageMediaId: uuid('image_media_id').references(() => media.id, { onDelete: 'set null' }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LinkPreviewRow = typeof linkPreviews.$inferSelect;
