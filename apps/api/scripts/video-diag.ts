/**
 * Diagnostika videa na iPhone (ladenie 07/2026): vypíše všetky video médiá —
 * stav transkódu, existenciu/veľkosť playback súboru na disku a hotovú
 * verejnú URL s `?mt=` tokenom, ktorú sa dá:
 *   a) otvoriť priamo v Safari na iPhone (izoluje appku/service worker),
 *   b) otestovať curl-om cez celý reťazec (edge Caddy → interný Caddy → api):
 *      curl -s -D - -o /dev/null -H "Range: bytes=0-1" "<URL>"
 *
 * Použitie (v bežiacom api kontajneri):
 *   sudo docker compose exec api bun apps/api/scripts/video-diag.ts
 */
import { desc, eq } from 'drizzle-orm';
import { env } from '../src/config/env';
import { db } from '../src/core/db/client';
import { media } from '../src/core/db/schema';
import { initMediaUrlTokens, mediaUrlToken } from '../src/modules/media/urlToken';
import { readMedia } from '../src/modules/media/storage';

await initMediaUrlTokens();

const rows = await db
  .select()
  .from(media)
  .where(eq(media.kind, 'video'))
  .orderBy(desc(media.createdAt))
  .limit(20);

if (rows.length === 0) {
  console.log('Žiadne videá v DB.');
  process.exit(0);
}

console.log(`Posledných ${rows.length} videí (najnovšie prvé):\n`);
for (const row of rows) {
  const mt = mediaUrlToken(row.id);
  const url = `${env.PUBLIC_WEB_ORIGIN}/api/media/${row.id}${mt ? `?mt=${mt}` : ' (TOKEN CHÝBA!)'}`;
  const playFile = row.playbackPath ? readMedia(row.playbackPath) : null;
  const playExists = playFile ? await playFile.exists() : false;
  const origFile = readMedia(row.storagePath);
  const origExists = await origFile.exists();

  console.log(`— ${row.createdAt.toISOString()}  ${row.mime}`);
  console.log(`  transcodeStatus: ${row.transcodeStatus ?? 'null'}`);
  console.log(`  originál: ${origExists ? `OK (${origFile.size} B)` : 'CHÝBA NA DISKU!'}`);
  console.log(
    `  playback: ${
      row.playbackPath === null
        ? '— (servíruje sa originál)'
        : playExists
          ? `OK (${playFile!.size} B)`
          : `CHÝBA NA DISKU! (${row.playbackPath})`
    }`,
  );
  console.log(`  poster:   ${row.posterPath ? 'áno' : 'nie'}`);
  console.log(`  URL: ${url}`);
  console.log('');
}

console.log('Test cez celý reťazec (spusti na NAS-e, mimo kontajnera):');
console.log('  curl -s -D - -o /dev/null -H "Range: bytes=0-1" "<URL z výpisu>"');
console.log('Očakávané: HTTP 206, Content-Range: bytes 0-1/<size>, Content-Length: 2, žiadny Transfer-Encoding: chunked.');
process.exit(0);
