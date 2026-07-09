import { z } from 'zod';
import { UserPublicSchema } from './auth';

/** Úprava vlastného profilu (avatar má vlastný endpoint). */
export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1, 'Zadaj meno').max(80).optional(),
  /** YYYY-MM-DD; null = vymazať. Kalendár (M4) z neho počíta narodeniny. */
  birthday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dátum v tvare RRRR-MM-DD')
    .nullable()
    .optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/** Zoznam členov rodiny. */
export const UsersListResponseSchema = z.object({
  users: z.array(UserPublicSchema),
});
export type UsersListResponse = z.infer<typeof UsersListResponseSchema>;
