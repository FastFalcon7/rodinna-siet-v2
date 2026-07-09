import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../core/db/client';
import { jobs } from '../../core/db/schema';
import { enqueueJob } from '../../core/jobs/queue';
import { llmEnabled } from '../../config/env';
import { embedEntry, generateEntry, notifyDraft, runNightly } from './service';

/**
 * Worker joby denníka (M5): nočné generovanie draftov (self-rescheduling,
 * ~23:30 CEST = 21:30 UTC), ranná notifikácia a embeddingy po potvrdení.
 * Worker je sériový → LLM inferencie nikdy nebežia paralelne (§15).
 */

const DAILY_KIND = 'diary.daily';
const DAILY_UTC_HOUR = 21;
const DAILY_UTC_MIN = 30;

const GenerateJobSchema = z.object({
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const EmbedJobSchema = z.object({ entryId: z.string().uuid(), userId: z.string().uuid() });

function nextRun(after = new Date()): Date {
  const next = new Date(
    Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), DAILY_UTC_HOUR, DAILY_UTC_MIN),
  );
  if (next <= after) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Idempotentný bootstrap nočného behu (volá worker pri štarte). */
export async function ensureDiaryJob(): Promise<void> {
  if (!llmEnabled) return; // bez LLM nemá nočný beh čo robiť
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, DAILY_KIND), eq(jobs.status, 'pending')))
    .limit(1);
  if (pending.length === 0) {
    await enqueueJob(DAILY_KIND, {}, { runAt: nextRun() });
  }
}

/** Registrácia job handlerov modulu do worker procesu (volá worker/index.ts). */
export function registerDiaryJobs(
  register: (kind: string, handler: (payload: unknown) => Promise<void>) => void,
): void {
  register(DAILY_KIND, async () => {
    try {
      await runNightly();
    } finally {
      await enqueueJob(DAILY_KIND, {}, { runAt: nextRun() });
    }
  });

  register('diary.generate', async (payload) => {
    const job = GenerateJobSchema.parse(payload);
    await generateEntry(job.userId, job.date);
  });

  register('diary.notify', async (payload) => {
    const job = GenerateJobSchema.parse(payload);
    await notifyDraft(job.userId, job.date);
  });

  register('diary.embed', async (payload) => {
    const job = EmbedJobSchema.parse(payload);
    await embedEntry(job.entryId, job.userId);
  });
}
