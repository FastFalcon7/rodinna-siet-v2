import { z } from 'zod';
import { PostAuthorSchema } from './feed';
import { MediaPublicSchema } from './media';

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

/**
 * Viditeľnosť udalosti (ladenie 07/2026): 'private' len tvorca, 'family'
 * celá rodina (default — udalosť je pozvánka), 'rooms' členovia vybraných
 * chat miestností.
 */
export const EventVisibilitySchema = z.enum(['private', 'family', 'rooms']);
export type EventVisibility = z.infer<typeof EventVisibilitySchema>;

export const CreateEventInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Chýba názov').max(MAX_EVENT_TITLE),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().nullable().optional(),
    allDay: z.boolean().default(false),
    location: z.string().trim().max(MAX_EVENT_LOCATION).default(''),
    bodyMd: z.string().max(MAX_EVENT_BODY).default(''),
    /** Vložiť RSVP kartu do Feedu (K1) — len pri visibility='family'. */
    toFeed: z.boolean().default(false),
    /** Prílohy (ladenie 07/2026) — fotky z composera alebo výberu vo feede. */
    mediaIds: z.array(z.string().uuid()).max(20).default([]),
    visibility: EventVisibilitySchema.default('family'),
    /** Pri visibility='rooms': miestnosti (podskupiny), ktoré udalosť vidia. */
    roomIds: z.array(z.string().uuid()).max(20).default([]),
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
  media: z.array(MediaPublicSchema),
  visibility: EventVisibilitySchema,
  /** Miestnosti, s ktorými je udalosť zdieľaná (visibility='rooms'). */
  roomIds: z.array(z.string().uuid()),
  createdAt: z.string(),
});
export type EventPublic = z.infer<typeof EventPublicSchema>;

/** Pridanie fotiek do existujúcej udalosti (z výberu vo feede/chate). */
export const AddEventMediaInputSchema = z.object({
  mediaIds: z.array(z.string().uuid()).min(1).max(20),
});
export type AddEventMediaInput = z.infer<typeof AddEventMediaInputSchema>;

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
