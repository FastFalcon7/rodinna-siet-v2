import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { jobs, type JobRow } from '../db/schema';

/**
 * DB-based job queue (§6): enqueue z API, claim + spracovanie vo worker
 * procese. Claim je race-safe cez FOR UPDATE SKIP LOCKED, takže aj keby
 * bežalo workerov viac, job dostane práve jeden.
 */

export interface EnqueueOptions {
  /** Kedy najskôr spustiť (default hneď). */
  runAt?: Date;
  maxAttempts?: number;
}

export async function enqueueJob(
  kind: string,
  payload: unknown,
  opts: EnqueueOptions = {},
): Promise<string> {
  const inserted = await db
    .insert(jobs)
    .values({
      kind,
      payload: payload ?? {},
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 3,
    })
    .returning({ id: jobs.id });
  return inserted[0]!.id;
}

/**
 * Atomicky claimne najstarší splatný pending job (alebo null). Subselect
 * s SKIP LOCKED preskočí joby držané inou transakciou.
 */
export async function claimNextJob(): Promise<JobRow | null> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_at <= now()
      ORDER BY run_at, created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload, status, run_at AS "runAt", attempts,
              max_attempts AS "maxAttempts", last_error AS "lastError",
              created_at AS "createdAt", updated_at AS "updatedAt"
  `);
  const row = rows[0];
  if (!row) return null;
  // Raw execute obchádza Drizzle mappery — timestampy prídu ako string.
  return {
    ...(row as unknown as JobRow),
    runAt: new Date(row.runAt as string),
    createdAt: new Date(row.createdAt as string),
    updatedAt: new Date(row.updatedAt as string),
  };
}

export async function completeJob(id: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'done', lastError: null, updatedAt: new Date() })
    .where(eq(jobs.id, id));
}

/** Zlyhaný pokus: retry s kvadratickým backoffom, po vyčerpaní pokusov 'failed'. */
export async function failJob(job: JobRow, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const exhausted = job.attempts >= job.maxAttempts;
  const backoffMs = job.attempts * job.attempts * 30_000; // 30 s, 2 min, 4,5 min…
  await db
    .update(jobs)
    .set({
      status: exhausted ? 'failed' : 'pending',
      lastError: message.slice(0, 2000),
      updatedAt: new Date(),
      // Pri finálnom zlyhaní runAt nemeníme (failed sa už neplánuje).
      ...(exhausted ? {} : { runAt: new Date(Date.now() + backoffMs) }),
    })
    .where(eq(jobs.id, job.id));
}

/** Údržba: zmaž hotové joby po 7 dňoch a zlyhané po 30 (nech tabuľka nerastie). */
export async function pruneJobs(): Promise<void> {
  const day = 24 * 60 * 60 * 1000;
  await db
    .delete(jobs)
    .where(and(eq(jobs.status, 'done'), lt(jobs.updatedAt, new Date(Date.now() - 7 * day))));
  await db
    .delete(jobs)
    .where(and(eq(jobs.status, 'failed'), lt(jobs.updatedAt, new Date(Date.now() - 30 * day))));
}
