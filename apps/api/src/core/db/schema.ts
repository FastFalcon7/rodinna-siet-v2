import { pgTable, text, uuid, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

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

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type InviteTokenRow = typeof inviteTokens.$inferSelect;
