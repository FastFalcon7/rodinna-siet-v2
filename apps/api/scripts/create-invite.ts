/**
 * Bootstrap / admin CLI: vygeneruje pozývací token a vypíše registračný link.
 *
 * Použitie (na serveri, kde beží DB):
 *   bun scripts/create-invite.ts <email> [admin|member]
 *
 * Prvý registrovaný užívateľ sa aj tak stane adminom (bootstrap), takže pre
 * úplne prvú pozvánku stačí: bun scripts/create-invite.ts ty@email.sk
 */
import { RoleSchema } from '@rodinna/shared-types';
import { env } from '../src/config/env';
import { sql } from '../src/core/db/client';
import { createInvite } from '../src/modules/auth/invite';

const email = process.argv[2];
const roleArg = process.argv[3] ?? 'member';

if (!email) {
  console.error('Použitie: bun scripts/create-invite.ts <email> [admin|member]');
  process.exit(1);
}

const role = RoleSchema.parse(roleArg);

const { token, expiresAt } = await createInvite({ email, role });
const url = `${env.PUBLIC_WEB_ORIGIN}/register?token=${token}&email=${encodeURIComponent(email)}`;

console.log('\n✅ Pozvánka vytvorená');
console.log(`   email:    ${email}`);
console.log(`   rola:     ${role}`);
console.log(`   platí do: ${expiresAt.toLocaleString('sk-SK')}`);
console.log(`\n🔗 Registračný link:\n   ${url}\n`);

await sql.end();
