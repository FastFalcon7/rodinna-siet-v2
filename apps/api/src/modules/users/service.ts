import type { UserPublic } from '@rodinna/shared-types';
import type { UserRow } from '../../core/db/schema';

/** Verejná reprezentácia užívateľa (bez hesla a citlivých polí). Zdieľaná auth aj users modulom. */
export function toPublicUser(u: UserRow): UserPublic {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
  };
}
