import { z } from 'zod';
import { UserPublicSchema } from './auth';

/** Úprava vlastného profilu — zatiaľ len zobrazované meno (avatar má vlastný endpoint). */
export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1, 'Zadaj meno').max(80),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/** Zoznam členov rodiny. */
export const UsersListResponseSchema = z.object({
  users: z.array(UserPublicSchema),
});
export type UsersListResponse = z.infer<typeof UsersListResponseSchema>;
