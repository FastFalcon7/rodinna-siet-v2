import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../core/db/client';
import { media } from '../../core/db/schema';
import { enqueueJob } from '../../core/jobs/queue';
import { env } from '../../config/env';
import { resolveStoragePath } from './storage';

/**
 * Video normalizácia (ladenie 07/2026): iPhone nahráva HEVC (.mov), ktoré PC
 * bez HW dekodéra neprehrá. Job 'media.transcode' pre každé video:
 *   1. ffprobe: kodek + rozmery + dĺžka,
 *   2. poster JPEG (prvý frame) → posterPath,
 *   3. H.264/AAC MP4 s +faststart → playbackPath:
 *      – zdroj už H.264 → len remux (-c copy, sekundy),
 *      – inak CPU transkód (libx264 veryfast; DS925+ zvládne krátke rodinné
 *        videá, job je sériový tak neblokuje nič iné).
 * Zlyhanie (napr. chýbajúci ffmpeg) = status 'failed' a servíruje sa originál.
 */

const KIND = 'media.transcode';

async function run(cmd: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { ok: code === 0, stdout, stderr };
}

interface ProbeResult {
  codec: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

async function probe(absPath: string): Promise<ProbeResult> {
  const r = await run(
    [
      env.FFPROBE_PATH,
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      absPath,
    ],
    30_000,
  );
  if (!r.ok) throw new Error(`ffprobe zlyhal: ${r.stderr.slice(0, 500)}`);
  const parsed = JSON.parse(r.stdout) as {
    streams?: { codec_name?: string; width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const s = parsed.streams?.[0];
  const durationS = parsed.format?.duration ? Number(parsed.format.duration) : null;
  return {
    codec: s?.codec_name ?? null,
    width: s?.width ?? null,
    height: s?.height ?? null,
    durationMs: durationS && Number.isFinite(durationS) ? Math.round(durationS * 1000) : null,
  };
}

/** 20 min na transkód — dlhé video na CPU chvíľu trvá; job je sériový. */
const TRANSCODE_TIMEOUT_MS = 20 * 60 * 1000;

/** Exportované aj pre testy (scripts/test-feed.ts) — handler jobu ju len obaľuje. */
export async function transcodeVideo(mediaId: string): Promise<void> {
  const rows = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  const row = rows[0];
  if (!row || row.kind !== 'video') return; // zmazané / nie je video — nič
  if (row.transcodeStatus === 'done') return; // idempotencia pri retry

  const src = resolveStoragePath(row.storagePath);
  if (!(await Bun.file(src).exists())) throw new Error('Zdrojový súbor videa chýba na disku');

  const base = row.storagePath.replace(/\.[^.]+$/, '');
  const posterRel = `${base}.poster.jpg`;
  const playRel = `${base}.play.mp4`;

  const info = await probe(src);

  // Poster: prvý frame, max šírka 1280 (párne rozmery kvôli yuv420).
  const poster = await run(
    [
      env.FFMPEG_PATH, '-y', '-i', src,
      '-frames:v', '1',
      '-vf', "scale='min(1280,iw)':-2",
      '-q:v', '3',
      resolveStoragePath(posterRel),
    ],
    60_000,
  );
  if (!poster.ok) console.warn(`media.transcode: poster zlyhal pre ${mediaId}: ${poster.stderr.slice(0, 300)}`);

  // Playback: H.264 remux (rýchle) alebo transkód.
  const playAbs = resolveStoragePath(playRel);
  const play =
    info.codec === 'h264'
      ? await run(
          [env.FFMPEG_PATH, '-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', playAbs],
          TRANSCODE_TIMEOUT_MS,
        )
      : await run(
          [
            env.FFMPEG_PATH, '-y', '-i', src,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-vf', "scale='min(1920,iw)':-2",
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            '-f', 'mp4',
            playAbs,
          ],
          TRANSCODE_TIMEOUT_MS,
        );
  if (!play.ok) throw new Error(`ffmpeg transkód zlyhal: ${play.stderr.slice(-500)}`);

  await db
    .update(media)
    .set({
      playbackPath: playRel,
      posterPath: poster.ok ? posterRel : null,
      transcodeStatus: 'done',
      width: row.width ?? info.width,
      height: row.height ?? info.height,
      durationMs: row.durationMs ?? info.durationMs,
    })
    .where(eq(media.id, mediaId));
  console.log(`🎬 media.transcode: ${mediaId} hotové (${info.codec} → h264${info.codec === 'h264' ? ' remux' : ''})`);
}

/**
 * Backfill pri štarte workera: videá nahrané pred touto verziou (status
 * null) sa označia pending a zaradia do fronty — opraví aj existujúce
 * neprehrateľné videá bez zásahu užívateľa.
 */
export async function ensureTranscodeBackfill(): Promise<void> {
  const stale = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.kind, 'video'), isNull(media.transcodeStatus)));
  for (const v of stale) {
    await db.update(media).set({ transcodeStatus: 'pending' }).where(eq(media.id, v.id));
    await enqueueJob(KIND, { mediaId: v.id });
  }
  if (stale.length > 0) console.log(`🎬 media.transcode: backfill ${stale.length} videí`);
}

/** Registrácia job handlerov modulu do worker procesu (volá worker/index.ts). */
export function registerMediaJobs(
  register: (kind: string, handler: (payload: unknown) => Promise<void>) => void,
): void {
  register(KIND, async (payload) => {
    const { mediaId } = payload as { mediaId: string };
    try {
      await transcodeVideo(mediaId);
    } catch (err) {
      // failed = fail-open: serve endpoint ďalej vracia originál.
      await db.update(media).set({ transcodeStatus: 'failed' }).where(eq(media.id, mediaId));
      throw err;
    }
  });
}
