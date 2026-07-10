import { z } from 'zod';
import { PostAuthorSchema } from './feed';

/**
 * Kalendár & Udalosti (plán §M4): udalosti s RSVP (živá karta vo Feede,
 * technicky „špecializovaná anketa"), narodeniny počítané z users.birthday
 * (agenda ich generuje virtuálne, feed kartu materializuje denný job),
 * push pripomienky deň a hodinu vopred, ICS feed pre Apple/Google Calendar.
 */

export const MAX_EVENT_TITLE = 140;
export const MAX_EVENT_LOCATION = 140;
export const MAX_EVENT_BODY = 4000;

export const RsvpStatusSchema = z.enum(['yes', 'no', 'maybe']);
export type RsvpStatus = z.infer<typeof RsvpStatusSchema>;

export const EventSourceSchema = z.enum(['manual', 'birthday', 'poll', 'suggested']);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const CreateEventInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Chýba názov').max(MAX_EVENT_TITLE),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().nullable().optional(),
    allDay: z.boolean().default(false),
    location: z.string().trim().max(MAX_EVENT_LOCATION).default(''),
    bodyMd: z.string().max(MAX_EVENT_BODY).default(''),
    /** Vložiť RSVP kartu do Feedu (K1). Udalosti žijú v Kalendári/chate — default nie. */
    toFeed: z.boolean().default(false),
  })
  .refine((v) => !v.endsAt || new Date(v.endsAt) >= new Date(v.startsAt), {
    message: 'Koniec nemôže byť pred začiatkom',
    path: ['endsAt'],
  });
export type CreateEventInput = z.infer<typeof CreateEventInputSchema>;

export const UpdateEventInputSchema = z.object({
  title: z.string().trim().min(1).max(MAX_EVENT_TITLE).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  allDay: z.boolean().optional(),
  location: z.string().trim().max(MAX_EVENT_LOCATION).optional(),
  bodyMd: z.string().max(MAX_EVENT_BODY).optional(),
});
export type UpdateEventInput = z.infer<typeof UpdateEventInputSchema>;

export const SetRsvpInputSchema = z.object({
  status: RsvpStatusSchema,
});
export type SetRsvpInput = z.infer<typeof SetRsvpInputSchema>;

export const EventPublicSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  allDay: z.boolean(),
  location: z.string(),
  bodyMd: z.string(),
  source: EventSourceSchema,
  createdBy: PostAuthorSchema,
  /** RSVP zoznamy s menami (rodina je malá, netreba len počty). */
  rsvps: z.object({
    yes: z.array(PostAuthorSchema),
    no: z.array(PostAuthorSchema),
    maybe: z.array(PostAuthorSchema),
  }),
  myRsvp: RsvpStatusSchema.nullable(),
  createdAt: z.string(),
});
export type EventPublic = z.infer<typeof EventPublicSchema>;

/** Narodeniny v agende — virtuálne (z users.birthday), bez riadku v events. */
export const BirthdayPublicSchema = z.object({
  user: PostAuthorSchema,
  /** Tohtoročný (resp. v dopyte ležiaci) výskyt, YYYY-MM-DD. */
  date: z.string(),
  /** Vek v daný deň; null ak rok narodenia vyzerá nevyplnený. */
  age: z.number().int().nullable(),
});
export type BirthdayPublic = z.infer<typeof BirthdayPublicSchema>;

export const AgendaResponseSchema = z.object({
  events: z.array(EventPublicSchema),
  birthdays: z.array(BirthdayPublicSchema),
});
export type AgendaResponse = z.infer<typeof AgendaResponseSchema>;

export const IcsUrlResponseSchema = z.object({
  /** Absolútna URL na read-only ICS feed (subscribe v Apple/Google Calendar); null = nedá sa odvodiť. */
  url: z.string().nullable(),
});
export type IcsUrlResponse = z.infer<typeof IcsUrlResponseSchema>;
