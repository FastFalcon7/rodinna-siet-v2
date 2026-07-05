import { and, eq } from 'drizzle-orm';
import { db } from '../../core/db/client';
import { jobs } from '../../core/db/schema';
import { enqueueJob } from '../../core/jobs/queue';
import { createTodaysMemory } from './service';

/**
 * Denný job „Na tento deň" (plán §M2): každé ráno vyberie fotku spred roka+
 * a vloží spomienkovú kartu do Feedu. Job sa po behu sám preplánuje na
 * ďalšie ráno — žiadny externý cron.
 */

const KIND = 'memories.daily';
const RUN_AT_UTC_HOUR = 5; // ~07:00 v Európe (NAS beží v UTC kontajneri)

function nextRun(after = new Date()): Date {
  const next = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), RUN_AT_UTC_HOUR));
  if (next <= after) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Idempotentný bootstrap — worker pri štarte zaistí, že denný job existuje. */
export async function ensureMemoriesJob(): Promise<void> {
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, KIND), eq(jobs.status, 'pending')))
    .limit(1);
  if (pending.length === 0) {
    await enqueueJob(KIND, {}, { runAt: nextRun() });
  }
}

/** Registrácia job handlerov modulu do worker procesu (volá worker/index.ts). */
export function registerAlbumsJobs(
  register: (kind: string, handler: (payload: unknown) => Promise<void>) => void,
): void {
  register(KIND, async () => {
    try {
      await createTodaysMemory();
    } finally {
      // Preplánuj vždy — aj keď dnes nebolo čo pripomenúť / beh zlyhal.
      await enqueueJob(KIND, {}, { runAt: nextRun() });
    }
  });
}
