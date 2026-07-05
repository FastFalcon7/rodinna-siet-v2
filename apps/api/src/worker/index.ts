import { sql } from 'drizzle-orm';
import { db } from '../core/db/client';
import { claimNextJob, completeJob, failJob, pruneJobs } from '../core/jobs/queue';
import { registerNotificationJobs } from '../modules/notifications/worker';
import { registerPollsJobs } from '../modules/polls/worker';
import { ensureMemoriesJob, registerAlbumsJobs } from '../modules/albums/worker';

/**
 * Worker proces (§6, M0) — spracúva pg_jobs queue mimo API procesu, nech
 * push fan-out, neskôr ffmpeg/LLM joby nikdy neblokujú latenciu chatu.
 *
 * Zámerne **sériové** spracovanie (jeden job naraz): DS925+ je CPU-only a
 * Phase 2 LLM joby musia bežať s jedným semaforom (§15). Polling 1 s je pre
 * 10 užívateľov lacnejší a jednoduchší než LISTEN/NOTIFY; ak by latencia
 * jobov niekedy vadila, NOTIFY sa doplní bez zmeny kontraktu.
 */

type JobHandler = (payload: unknown) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(kind: string, handler: JobHandler): void {
  if (handlers.has(kind)) throw new Error(`Job handler '${kind}' už je registrovaný`);
  handlers.set(kind, handler);
}

const POLL_MS = 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;

/** Migrácie spúšťa API pri boote — worker len počká, kým tabuľka jobs existuje. */
async function waitForSchema(): Promise<void> {
  for (;;) {
    try {
      await db.execute(sql`SELECT 1 FROM jobs LIMIT 1`);
      return;
    } catch {
      console.log('⏳ worker: čakám na DB schému (jobs)…');
      await Bun.sleep(2000);
    }
  }
}

async function loop(): Promise<void> {
  let lastPrune = 0;
  for (;;) {
    if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
      lastPrune = Date.now();
      await pruneJobs().catch((err) => console.error('worker: prune zlyhal', err));
    }

    let job;
    try {
      job = await claimNextJob();
    } catch (err) {
      console.error('worker: claim zlyhal', err);
      await Bun.sleep(POLL_MS * 5);
      continue;
    }
    if (!job) {
      await Bun.sleep(POLL_MS);
      continue;
    }

    const handler = handlers.get(job.kind);
    if (!handler) {
      // Neznámy kind (typicky starší worker po deployi) → failed bez retry spamu.
      await failJob({ ...job, attempts: job.maxAttempts }, new Error(`Neznámy job kind '${job.kind}'`));
      continue;
    }

    const started = Date.now();
    try {
      await handler(job.payload);
      await completeJob(job.id);
      console.log(`✔ job ${job.kind} (${job.id.slice(0, 8)}) za ${Date.now() - started} ms`);
    } catch (err) {
      console.error(`✖ job ${job.kind} (${job.id.slice(0, 8)}) zlyhal:`, err);
      await failJob(job, err).catch(() => {});
    }
  }
}

if (import.meta.main) {
  registerNotificationJobs(registerJobHandler);
  registerPollsJobs(registerJobHandler);
  registerAlbumsJobs(registerJobHandler);
  await waitForSchema();
  await ensureMemoriesJob();
  console.log(`🟢 rodinna-worker beží — handlery: ${[...handlers.keys()].join(', ') || '(žiadne)'}`);
  await loop();
}
