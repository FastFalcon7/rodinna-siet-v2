import { z } from 'zod';

/**
 * Notifications kernel (M0, plán §M0-2) — in-app notifikácie + Web Push.
 * `kind` je registrovaný modulom (integračný kontrakt K3); per-kind opt-out
 * si užívateľ nastaví v profile (users.push_pref_json).
 */

/** Známe druhy notifikácií. Nové moduly sem pridávajú svoje (K3). */
export const NOTIFICATION_KINDS = ['chat.message', 'polls.closed'] as const;
export const NotificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

/** Slovenské popisky pre nastavenia (jediný zdroj pravdy pre UI). */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  'chat.message': 'Nové správy v chate',
  'polls.closed': 'Výsledky ankiet',
};

/** Obsah notifikácie — rovnaký tvar konzumuje service worker aj in-app zoznam. */
export const NotificationPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  /** Relatívna URL v appke, kam klik notifikácie vedie (napr. /?room=…). */
  url: z.string(),
  /** Tag zoskupuje push notifikácie (napr. roomId — nová správa nahradí starú). */
  tag: z.string().optional(),
});
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;

export const NotificationPublicSchema = z.object({
  id: z.string().uuid(),
  kind: NotificationKindSchema,
  payload: NotificationPayloadSchema,
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationPublic = z.infer<typeof NotificationPublicSchema>;

export const NotificationsListResponseSchema = z.object({
  notifications: z.array(NotificationPublicSchema),
  unreadCount: z.number().int(),
});
export type NotificationsListResponse = z.infer<typeof NotificationsListResponseSchema>;

// ── Push subscriptions ───────────────────────────────────────────────────────

/** Tvar PushSubscription.toJSON() z prehliadača. */
export const PushSubscribeInputSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  deviceLabel: z.string().max(120).optional(),
});
export type PushSubscribeInput = z.infer<typeof PushSubscribeInputSchema>;

export const PushUnsubscribeInputSchema = z.object({
  endpoint: z.string().url(),
});
export type PushUnsubscribeInput = z.infer<typeof PushUnsubscribeInputSchema>;

export const VapidKeyResponseSchema = z.object({
  /** null = push nie je na serveri nakonfigurovaný (chýbajú VAPID kľúče). */
  publicKey: z.string().nullable(),
});
export type VapidKeyResponse = z.infer<typeof VapidKeyResponseSchema>;

// ── Preferencie ──────────────────────────────────────────────────────────────

/** Per-kind zapnutie/vypnutie; chýbajúci kľúč = zapnuté (konzervatívny default). */
export const NotificationPrefsSchema = z.record(NotificationKindSchema, z.boolean());
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export const NotificationPrefsResponseSchema = z.object({
  prefs: NotificationPrefsSchema,
});
export type NotificationPrefsResponse = z.infer<typeof NotificationPrefsResponseSchema>;

export const MarkNotificationsReadInputSchema = z.object({
  /** Bez ids = označ všetky ako prečítané. */
  ids: z.array(z.string().uuid()).optional(),
});
export type MarkNotificationsReadInput = z.infer<typeof MarkNotificationsReadInputSchema>;
