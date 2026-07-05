import { extname } from 'node:path';
import { Zip, ZipPassThrough } from 'fflate';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../core/db/client';
import { albumPhotos, media } from '../../core/db/schema';
import { resolveStoragePath } from '../media/storage';

/**
 * ZIP export albumu (plán §M2) — streamuje sa priamo do odpovede, fotky sa
 * čítajú sériovo (RAM drží vždy len jeden súbor). STORE bez kompresie:
 * fotky/videá sú už komprimované, deflate by len pálil CPU NAS-u.
 */

function sanitizeName(name: string): string {
  return name.replace(/[^\w.\-áäčďéíĺľňóôŕšťúýžÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ ]+/g, '_').slice(0, 80);
}

export async function albumZipStream(albumId: string): Promise<ReadableStream<Uint8Array>> {
  const photos = await db
    .select({ media })
    .from(albumPhotos)
    .innerJoin(media, eq(albumPhotos.mediaId, media.id))
    .where(eq(albumPhotos.albumId, albumId))
    .orderBy(desc(albumPhotos.createdAt));

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });

      void (async () => {
        try {
          const used = new Set<string>();
          for (const [i, p] of photos.entries()) {
            const ext = extname(p.media.storagePath) || '';
            const base = p.media.fileName
              ? sanitizeName(p.media.fileName.replace(/\.[^.]+$/, ''))
              : p.media.id.slice(0, 8);
            let name = `${String(i + 1).padStart(3, '0')}-${base}${ext}`;
            while (used.has(name)) name = `_${name}`;
            used.add(name);

            const entry = new ZipPassThrough(name);
            entry.mtime = p.media.createdAt;
            zip.add(entry);
            const bytes = await Bun.file(resolveStoragePath(p.media.storagePath))
              .arrayBuffer()
              .catch(() => null);
            // Chýbajúci súbor na disku preskoč — ZIP ostatných fotiek má stále cenu.
            entry.push(bytes ? new Uint8Array(bytes) : new Uint8Array(0), true);
          }
          zip.end();
        } catch (err) {
          controller.error(err);
        }
      })();
    },
  });
}
