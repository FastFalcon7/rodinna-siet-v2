import { and, eq } from 'drizzle-orm';
import { db } from '../../core/db/client';
import { jobs } from '../../core/db/schema';
import { enqueueJob } from '../../core/jobs/queue';
import { feedsFromEnv, fetchNews } from './service';

/**
 * RSS aggregator job (M7): 2× denne (ráno pred denníkovými titulkami
 * v UI, podvečer pred nočným diary jobom). Self-rescheduling ako ostatné.
 */

const KIND = 'news.fetch';
const RUN_UTC_HOURS = [4, 16] as const;

function nextRun(after = new Date()): Date {
  for (const h of RUN_UTC_HOURS) {
    const candidate = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), h));
    if (candidate > after) return candidate;
  }
  const tomorrow = new Date(after);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), RUN_UTC_HOURS[0]));
}

/** Idempotentný bootstrap (volá worker pri štarte). */
export async function ensureNewsJob(): Promise<void> {
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
export function registerNewsJobs(
  register: (kind: string, handler: (payload: unknown) => Promise<void>) => void,
): void {
  register(KIND, async () => {
    try {
      const res = await fetchNews(feedsFromEnv());
      console.log(`news.fetch: ${res.stored} nových z ${res.fetched} položiek`);
    } finally {
      await enqueueJob(KIND, {}, { runAt: nextRun() });
    }
  });
}
