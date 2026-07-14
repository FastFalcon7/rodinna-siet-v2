/**
 * Bootstrap / admin CLI: vygeneruje pozývací token, registračný link a hotový
 * pozývací e-mail (HTML súbor + verzia na skopírovanie).
 *
 * Použitie (na serveri, kde beží DB):
 *   bun scripts/create-invite.ts <email> [admin|member]
 *
 * Prvý registrovaný užívateľ sa aj tak stane adminom (bootstrap), takže pre
 * úplne prvú pozvánku stačí: bun scripts/create-invite.ts ty@email.sk
 *
 * Appka e-maily sama neposiela — skript vypíše text na skopírovanie do Gmailu
 * a uloží `invite-<email>.html`, ktorý stačí otvoriť v prehliadači, označiť
 * všetko (Ctrl/Cmd+A), skopírovať a vložiť do tela e-mailu (zachová formát).
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
const manualUrl = `${env.PUBLIC_WEB_ORIGIN}/napoveda.html`;
const expiresText = expiresAt.toLocaleString('cs-CZ', { dateStyle: 'long', timeStyle: 'short' });

// Hotový HTML e-mail zo šablóny (placeholdery → skutočné hodnoty).
const templatePath = new URL('./invite-email.template.html', import.meta.url);
const emailHtml = (await Bun.file(templatePath).text())
  .replaceAll('{{REGISTRATION_URL}}', url)
  .replaceAll('{{EMAIL}}', email)
  .replaceAll('{{EXPIRES}}', expiresText)
  .replaceAll('{{MANUAL_URL}}', manualUrl)
  .replaceAll('{{APP_ORIGIN}}', env.PUBLIC_WEB_ORIGIN);

const safeName = email.replace(/[^a-zA-Z0-9._-]/g, '_');
const outPath = `invite-${safeName}.html`;
await Bun.write(outPath, emailHtml);

// Jednoduchá textová verzia (fallback na rýchle vloženie / SMS / WhatsApp).
const plainEmail = `Předmět: Pozvánka do naší rodinné sítě

Ahoj,
zvu tě do naší soukromé rodinné sítě — místa jen pro nás (fotky, zprávy,
události). Přihlašovací e-mail: ${email}

1) Otevři tento odkaz a nastav si jméno a heslo (aspoň 10 znaků):
   ${url}

2) Na telefonu si appku přidej na plochu:
   iPhone: Sdílet → Přidat na plochu   ·   Android: nabídka ⋮ → Nainstalovat aplikaci

Podrobný návod: ${manualUrl}
Odkaz je osobní, platí do ${expiresText} a lze ho použít jednou — neposílej ho dál.`;

console.log('\n✅ Pozvánka vytvorená');
console.log(`   email:    ${email}`);
console.log(`   rola:     ${role}`);
console.log(`   platí do: ${expiresText}`);
console.log(`\n🔗 Registračný link:\n   ${url}`);
console.log(`\n📧 Hotový HTML e-mail uložený do: ${outPath}`);
console.log('   → otvor v prehliadači, Ctrl/Cmd+A, skopíruj a vlož do tela e-mailu.');
console.log('\n📝 Textová verzia na skopírovanie:\n');
console.log(plainEmail);
console.log('');

await sql.end();
