import { z } from 'zod';
import { PostAuthorSchema } from './feed';

/**
 * Zoznamy & Poznámky (plán §M3) — zdieľané celou rodinou (family-wide,
 * ako feed). Zoznam = checkboxy s „kto odškrtol/komu priradené",
 * real-time cez WS event `note:update`. Poznámka = markdown text
 * s históriou verzií (last-write-wins + revízie, žiadny CRDT pre 10 ľudí).
 * Živá karta v chate (K2): app://notes/<id> — odškrtáva sa priamo v bubline.
 */

export const MAX_NOTE_TITLE = 120;
export const MAX_NOTE_BODY = 20_000;
export const MAX_ITEM_LABEL = 200;
export const MAX_NOTE_ITEMS = 200;

export const NoteKindSchema = z.enum(['note', 'list']);
export type NoteKind = z.infer<typeof NoteKindSchema>;

export const CreateNoteInputSchema = z.object({
  kind: NoteKindSchema,
  title: z.string().trim().min(1, 'Chýba názov').max(MAX_NOTE_TITLE),
  bodyMd: z.string().max(MAX_NOTE_BODY).default(''),
  /** Počiatočné položky zoznamu (napr. z duplikátu/šablóny). */
  items: z.array(z.string().trim().min(1).max(MAX_ITEM_LABEL)).max(MAX_NOTE_ITEMS).default([]),
});
export type CreateNoteInput = z.infer<typeof CreateNoteInputSchema>;

export const UpdateNoteInputSchema = z.object({
  title: z.string().trim().min(1).max(MAX_NOTE_TITLE).optional(),
  /** Zmena textu poznámky uloží predchádzajúci obsah ako revíziu. */
  bodyMd: z.string().max(MAX_NOTE_BODY).optional(),
  pinned: z.boolean().optional(),
});
export type UpdateNoteInput = z.infer<typeof UpdateNoteInputSchema>;

export const AddNoteItemInputSchema = z.object({
  label: z.string().trim().min(1, 'Prázdna položka').max(MAX_ITEM_LABEL),
});
export type AddNoteItemInput = z.infer<typeof AddNoteItemInputSchema>;

export const UpdateNoteItemInputSchema = z.object({
  label: z.string().trim().min(1).max(MAX_ITEM_LABEL).optional(),
  checked: z.boolean().optional(),
  /** null = zrušiť priradenie. */
  assignedTo: z.string().uuid().nullable().optional(),
});
export type UpdateNoteItemInput = z.infer<typeof UpdateNoteItemInputSchema>;

export const NoteItemPublicSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  checkedBy: PostAuthorSchema.nullable(),
  checkedAt: z.string().nullable(),
  assignedTo: PostAuthorSchema.nullable(),
  order: z.number().int(),
});
export type NoteItemPublic = z.infer<typeof NoteItemPublicSchema>;

export const NoteSummarySchema = z.object({
  id: z.string().uuid(),
  kind: NoteKindSchema,
  title: z.string(),
  pinned: z.boolean(),
  createdBy: PostAuthorSchema,
  updatedBy: PostAuthorSchema.nullable(),
  updatedAt: z.string(),
  createdAt: z.string(),
  /** Len pre kind='list'. */
  itemsTotal: z.number().int(),
  itemsChecked: z.number().int(),
});
export type NoteSummary = z.infer<typeof NoteSummarySchema>;

export const NoteDetailSchema = NoteSummarySchema.extend({
  bodyMd: z.string(),
  items: z.array(NoteItemPublicSchema),
  revisionCount: z.number().int(),
});
export type NoteDetail = z.infer<typeof NoteDetailSchema>;

export const NotesListResponseSchema = z.object({
  notes: z.array(NoteSummarySchema),
});
export type NotesListResponse = z.infer<typeof NotesListResponseSchema>;

export const NoteRevisionSchema = z.object({
  id: z.string().uuid(),
  bodyMd: z.string(),
  savedBy: PostAuthorSchema.nullable(),
  savedAt: z.string(),
});
export type NoteRevision = z.infer<typeof NoteRevisionSchema>;

export const NoteRevisionsResponseSchema = z.object({
  revisions: z.array(NoteRevisionSchema),
});
export type NoteRevisionsResponse = z.infer<typeof NoteRevisionsResponseSchema>;
