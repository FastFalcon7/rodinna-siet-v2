import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../core/db/client';
import { jobs } from '../../core/db/schema';
import { enqueueJob } from '../../core/jobs/queue';
import { processBirthdays, sendReminder } from './service';

/**
 * Worker joby kalendára (M4): pripomienky udalostí (deň/hodinu vopred)
 * a denný narodeninový beh (karta + push). Rovnaký self-rescheduling
 * vzor ako memories.daily.
 */

const DAILY_KIND = 'events.birthdays.daily';
const DAILY_UTC_HOUR = 5;

const RemindJobSchema = z.object({
  eventId: z.string().uuid(),
  startsAtExpected: z.string(),
  label: z.string(),
});

function nextRun(after = new Date()): Date {
  const next = new Date(
    Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), DAILY_UTC_HOUR, 30),
  );
  if (next <= after) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Idempotentný bootstrap denného behu (volá worker pri štarte). */
export async function ensureBirthdaysJob(): Promise<void> {
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
export function registerEventsJobs(
  register: (kind: string, handler: (payload: unknown) => Promise<void>) => void,
): void {
  register('events.remind', async (payload) => {
    const job = RemindJobSchema.parse(payload);
    await sendReminder(job.eventId, job.startsAtExpected, job.label);
  });

  register(DAILY_KIND, async () => {
    try {
      await processBirthdays();
    } finally {
      await enqueueJob(DAILY_KIND, {}, { runAt: nextRun() });
    }
  });
}
