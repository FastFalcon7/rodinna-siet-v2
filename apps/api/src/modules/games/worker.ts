import { and, eq } from 'drizzle-orm';
import { db } from '../../core/db/client';
import { gameSessions, jobs, users } from '../../core/db/schema';
import { enqueueJob } from '../../core/jobs/queue';
import { llmEnabled } from '../../config/env';
import { chatCompletion } from '../../core/llm';
import { createQuest } from './service';

/**
 * Denný beh hier (M6, self-rescheduling ~08:00 CEST): ranná rodinná otázka
 * (karta vo Feede, odpovede sa ukážu až po vlastnej) a v pondelok navyše
 * foto výzva týždňa. Max 1 systémová karta denne per druh (plán §6 riziká).
 * S LLM sa občas vygeneruje čerstvá otázka, banka je fallback.
 */

const KIND = 'games.daily';
const RUN_UTC_HOUR = 6;

const QUESTIONS = [
  'Aké jedlo by si vedel/a jesť každý deň?',
  'Najlepší film, čo si videl/a tento rok?',
  'Keby si mohol/mohla cestovať kamkoľvek, kam by to bolo?',
  'Čo ťa dnes potešilo?',
  'Aká pesnička ti teraz hrá v hlave?',
  'Keby si vyhral/a milión, čo prvé urobíš?',
  'Aké je tvoje najobľúbenejšie miesto u nás doma?',
  'Čo by si robil/a, keby zajtra nebola škola ani práca?',
  'Aká je tvoja najstaršia spomienka?',
  'Keby si mal/a superschopnosť, ktorú by si chcel/a?',
  'Čo nové si sa tento týždeň naučil/a?',
  'Aké jedlo z detstva ti najviac chýba?',
  'S kým slávnym by si chcel/a večerať?',
  'Aký je tvoj recept na zlý deň?',
  'Čo by sme mali ako rodina vyskúšať?',
  'Aká rozprávka ťa v detstve najviac bavila?',
  'Keby si mohol/mohla mať akékoľvek zviera, ktoré?',
  'Čo je lepšie: more alebo hory? Prečo?',
  'Aký darček ťa najviac potešil v živote?',
  'Keby si mohol/mohla stráviť deň s hocikým z rodiny v minulosti, s kým?',
] as const;

const PHOTO_PROMPTS = [
  'Odfoť niečo žlté 💛',
  'Odfoť svoj dnešný výhľad 🪟',
  'Odfoť niečo, čo ťa dnes rozosmialo 😄',
  'Odfoť svoje raňajky 🍳',
  'Odfoť niečo staré viac ako ty 🕰',
  'Odfoť svoje obľúbené miesto doma 🛋',
  'Odfoť oblohu práve teraz ☁️',
  'Odfoť niečo maličké 🔍',
  'Odfoť, čo máš práve v ruke ✋',
  'Odfoť niečo zelené 🌿',
] as const;

function nextRun(after = new Date()): Date {
  const next = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), RUN_UTC_HOUR));
  if (next <= after) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** „Systémové" karty píše najstarší admin (rodina nemá service účet). */
async function systemAuthor(): Promise<string | null> {
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  return admins[0]?.id ?? null;
}

async function pickQuestion(dateIso: string): Promise<string> {
  // S LLM skús čerstvú otázku (fallback banka pri chybe/vypnutí).
  if (llmEnabled) {
    try {
      const q = await chatCompletion(
        [
          {
            role: 'user',
            content:
              'Vymysli JEDNU krátku zábavnú otázku dňa pre rodinný chat v slovenčine ' +
              '(icebreaker, vhodná pre deti aj starých rodičov). Odpovedz len otázkou.',
          },
        ],
        { temperature: 1.0, maxTokens: 60 },
      );
      const line = q.trim().split('\n')[0]?.trim();
      if (line && line.length >= 10 && line.length <= 160) return line;
    } catch {
      /* fallback nižšie */
    }
  }
  // Deterministický výber z banky podľa dátumu (žiadne opakovanie za sebou).
  const seed = Number(dateIso.replaceAll('-', ''));
  return QUESTIONS[seed % QUESTIONS.length]!;
}

export async function runGamesDaily(now = new Date()): Promise<void> {
  // Ladenie 07/2026: otázka dňa/týždňa je AI funkcia — bez zapnutia admina nič.
  const { getAiEnabled } = await import('../settings/service');
  if (!(await getAiEnabled())) return;
  const author = await systemAuthor();
  if (!author) return;
  const dateIso = now.toISOString().slice(0, 10);

  // Max jedna denná otázka na deň (idempotencia pri opakovanom behu).
  const existing = await db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(and(eq(gameSessions.kind, 'daily'), eq(gameSessions.status, 'active')));
  const already = await db.execute<{ n: number }>(
    // stateJson->>'date' = dnešok
    (await import('drizzle-orm')).sql`SELECT count(*)::int AS n FROM game_sessions WHERE kind = 'daily' AND state_json->>'date' = ${dateIso}`,
  );
  if ((already[0]?.n ?? 0) === 0) {
    // Staršie otvorené otázky ukonči (feed nech neponúka hlasovanie do minulosti).
    for (const e of existing) {
      await db.update(gameSessions).set({ status: 'finished' }).where(eq(gameSessions.id, e.id));
    }
    await createQuest('daily', await pickQuestion(dateIso), author, dateIso);
  }

  // Pondelok: foto výzva týždňa.
  if (now.getUTCDay() === 1) {
    const photoAlready = await db.execute<{ n: number }>(
      (await import('drizzle-orm')).sql`SELECT count(*)::int AS n FROM game_sessions WHERE kind = 'photo' AND state_json->>'date' = ${dateIso}`,
    );
    if ((photoAlready[0]?.n ?? 0) === 0) {
      const week = Math.floor(now.getTime() / (7 * 24 * 3600 * 1000));
      await createQuest('photo', PHOTO_PROMPTS[week % PHOTO_PROMPTS.length]!, author, dateIso);
    }
  }
}

/** Idempotentný bootstrap (volá worker pri štarte). */
export async function ensureGamesJob(): Promise<void> {
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
export function registerGamesJobs(
  register: (kind: string, handler: (payload: unknown) => Promise<void>) => void,
): void {
  register(KIND, async () => {
    try {
      await runGamesDaily();
    } finally {
      await enqueueJob(KIND, {}, { runAt: nextRun() });
    }
  });
}
