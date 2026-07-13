import { z } from 'zod';
import { UserPublicSchema } from './auth';

/**
 * Paleta farieb mena (ladenie 07/2026) — pevná sada tónov čitateľných
 * v svetlom aj tmavom režime. Užívateľ si v profile zvolí farbu svojho
 * mena pre lepšiu orientáciu vo feede a chate.
 */
export const NAME_COLORS = [
  '#ef4444', // červená
  '#f97316', // oranžová
  '#f59e0b', // jantárová
  '#eab308', // žltá
  '#22c55e', // zelená
  '#14b8a6', // tyrkysová
  '#06b6d4', // azúrová
  '#3b82f6', // modrá
  '#6366f1', // indigo
  '#8b5cf6', // fialová
  '#d946ef', // purpurová
  '#ec4899', // ružová
] as const;
export const NameColorSchema = z.enum(NAME_COLORS);
export type NameColor = z.infer<typeof NameColorSchema>;

/** Úprava vlastného profilu (avatar má vlastný endpoint). */
export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1, 'Zadaj meno').max(80).optional(),
  /** YYYY-MM-DD; null = vymazať. Kalendár (M4) z neho počíta narodeniny. */
  birthday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dátum v tvare RRRR-MM-DD')
    .nullable()
    .optional(),
  /** Farba mena z palety; null = predvolená (bez farby). */
  nameColor: NameColorSchema.nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/** Zoznam členov rodiny. */
export const UsersListResponseSchema = z.object({
  users: z.array(UserPublicSchema),
});
export type UsersListResponse = z.infer<typeof UsersListResponseSchema>;
