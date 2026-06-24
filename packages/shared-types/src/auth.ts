import { z } from 'zod';

/** RBAC role (ARCHITECTURE_V2.md §9: admin / member). */
export const RoleSchema = z.enum(['admin', 'member']);
export type Role = z.infer<typeof RoleSchema>;

/** Verejná reprezentácia užívateľa (bez hesla a citlivých polí). */
export const UserPublicSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: RoleSchema,
  createdAt: z.string(),
});
export type UserPublic = z.infer<typeof UserPublicSchema>;

/** Pravidlá hesla — §9: min 10 znakov. */
export const PasswordSchema = z
  .string()
  .min(10, 'Heslo musí mať aspoň 10 znakov')
  .max(200, 'Heslo je príliš dlhé');

export const LoginInputSchema = z.object({
  email: z.string().email('Neplatný email'),
  password: z.string().min(1, 'Zadaj heslo'),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const RegisterInputSchema = z.object({
  token: z.string().min(1, 'Chýba pozývací token'),
  email: z.string().email('Neplatný email'),
  displayName: z.string().min(1, 'Zadaj meno').max(80),
  password: PasswordSchema,
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

/** Vstup pre vygenerovanie pozvánky (admin-only). */
export const InviteInputSchema = z.object({
  email: z.string().email('Neplatný email'),
  role: RoleSchema.default('member'),
});
export type InviteInput = z.infer<typeof InviteInputSchema>;

export const InviteResponseSchema = z.object({
  email: z.string().email(),
  role: RoleSchema,
  url: z.string(),
  expiresAt: z.string(),
});
export type InviteResponse = z.infer<typeof InviteResponseSchema>;

/** Odpoveď /api/auth/me a /login a /register — vždy obsahuje aktuálneho usera. */
export const AuthUserResponseSchema = z.object({
  user: UserPublicSchema.nullable(),
});
export type AuthUserResponse = z.infer<typeof AuthUserResponseSchema>;
