import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type {
  CreateFragmentInput,
  DiaryEntryPublic,
  DiaryFragmentPublic,
  DiarySearchResponse,
} from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import {
  diaryEmbeddings,
  diaryEntries,
  diaryFragments,
  media,
  messages,
  posts,
  type DiaryEntryRow,
} from '../../core/db/schema';
import { publishCrossProcess } from '../../core/events';
import { enqueueJob } from '../../core/jobs/queue';
import { chatCompletion, embedText } from '../../core/llm';
import { toMediaPublic } from '../media/service';

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}

/** Hranice dňa (UTC — NAS beží v UTC kontajneri; drobný posun je akceptovaný). */
function dayRange(dateIso: string): { from: Date; to: Date } {
  const from = new Date(`${dateIso}T00:00:00Z`);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

function toEntryPublic(row: DiaryEntryRow): DiaryEntryPublic {
  return {
    id: row.id,
    date: row.date,
    bodyMd: row.bodyMd,
    status: row.status,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Fragmenty (quick capture) ────────────────────────────────────────────────

export async function createFragment(userId: string, input: CreateFragmentInput): Promise<DiaryFragmentPublic> {
  const inserted = await db
    .insert(diaryFragments)
    .values({ userId, body: input.body, mood: input.mood ?? null, mediaId: input.mediaId ?? null })
    .returning();
  const [pub] = await hydrateFragments([inserted[0]!.id], userId);
  return pub!;
}

async function hydrateFragments(ids: string[], userId: string): Promise<DiaryFragmentPublic[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ frag: diaryFragments, media })
    .from(diaryFragments)
    .leftJoin(media, eq(diaryFragments.mediaId, media.id))
    .where(and(eq(diaryFragments.userId, userId), inArray(diaryFragments.id, ids)))
    .orderBy(desc(diaryFragments.createdAt));
  return rows.map((r) => ({
    id: r.frag.id,
    body: r.frag.body,
    mood: (r.frag.mood as DiaryFragmentPublic['mood']) ?? null,
    media: r.media ? toMediaPublic(r.media) : null,
    createdAt: r.frag.createdAt.toISOString(),
  }));
}

export async function listFragments(userId: string, dateIso: string): Promise<DiaryFragmentPublic[]> {
  const { from, to } = dayRange(dateIso);
  const rows = await db
    .select({ id: diaryFragments.id })
    .from(diaryFragments)
    .where(
      and(eq(diaryFragments.userId, userId), gte(diaryFragments.createdAt, from), lt(diaryFragments.createdAt, to)),
    );
  return hydrateFragments(rows.map((r) => r.id), userId);
}

export async function deleteFragment(fragmentId: string, userId: string): Promise<void> {
  const res = await db
    .delete(diaryFragments)
    .where(and(eq(diaryFragments.id, fragmentId), eq(diaryFragments.userId, userId)))
    .returning({ id: diaryFragments.id });
  if (res.length === 0) throw new NotFoundError('Fragment nenájdený');
}

// ── Zápisy ───────────────────────────────────────────────────────────────────

export async function listEntries(userId: string, limit = 60): Promise<DiaryEntryPublic[]> {
  const rows = await db
    .select()
    .from(diaryEntries)
    .where(eq(diaryEntries.userId, userId))
    .orderBy(desc(diaryEntries.date))
    .limit(limit);
  return rows.map(toEntryPublic);
}

async function getOwnEntry(entryId: string, userId: string): Promise<DiaryEntryRow> {
  const rows = await db
    .select()
    .from(diaryEntries)
    .where(and(eq(diaryEntries.id, entryId), eq(diaryEntries.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Zápis nenájdený');
  return rows[0];
}

export async function updateEntry(entryId: string, userId: string, bodyMd: string): Promise<DiaryEntryPublic> {
  const entry = await getOwnEntry(entryId, userId);
  const updated = await db
    .update(diaryEntries)
    .set({ bodyMd })
    .where(eq(diaryEntries.id, entryId))
    .returning();
  // Upravený potvrdený zápis → prepočítať embedding.
  if (entry.status === 'confirmed') {
    await enqueueJob('diary.embed', { entryId, userId });
  }
  await publishCrossProcess(`user:${userId}`, { t: 'diary:update', date: entry.date });
  return toEntryPublic(updated[0]!);
}

export async function confirmEntry(entryId: string, userId: string): Promise<DiaryEntryPublic> {
  const entry = await getOwnEntry(entryId, userId);
  if (entry.status === 'confirmed') return toEntryPublic(entry);
  const updated = await db
    .update(diaryEntries)
    .set({ status: 'confirmed', confirmedAt: new Date() })
    .where(eq(diaryEntries.id, entryId))
    .returning();
  // Embedding až po potvrdení (§15.2) — draft môže byť halucinácia.
  await enqueueJob('diary.embed', { entryId, userId });
  await publishCrossProcess(`user:${userId}`, { t: 'diary:update', date: entry.date });
  return toEntryPublic(updated[0]!);
}

export async function deleteEntry(entryId: string, userId: string): Promise<void> {
  const entry = await getOwnEntry(entryId, userId);
  await db.delete(diaryEntries).where(eq(diaryEntries.id, entryId));
  await publishCrossProcess(`user:${userId}`, { t: 'diary:update', date: entry.date });
}

// ── Generovanie draftu (LLM, worker job) ────────────────────────────────────

/** Surové podklady dňa: fragmenty + VLASTNÉ posty + VLASTNÉ odoslané správy (§15.2 privacy). */
async function collectDayMaterial(userId: string, dateIso: string): Promise<string[]> {
  const { from, to } = dayRange(dateIso);
  const lines: string[] = [];

  const frags = await db
    .select()
    .from(diaryFragments)
    .where(
      and(eq(diaryFragments.userId, userId), gte(diaryFragments.createdAt, from), lt(diaryFragments.createdAt, to)),
    )
    .orderBy(diaryFragments.createdAt);
  for (const f of frags) {
    const mood = f.mood ? ` (nálada ${f.mood})` : '';
    if (f.body || f.mood) lines.push(`- [poznámka${mood}] ${f.body || '(len nálada)'}`);
    else if (f.mediaId) lines.push('- [poznámka] pridal/a som fotku');
  }

  const ownPosts = await db
    .select({ bodyMd: posts.bodyMd })
    .from(posts)
    .where(and(eq(posts.authorId, userId), gte(posts.createdAt, from), lt(posts.createdAt, to), sql`${posts.deletedAt} IS NULL`))
    .orderBy(posts.createdAt);
  for (const p of ownPosts) if (p.bodyMd.trim()) lines.push(`- [môj príspevok] ${p.bodyMd}`);

  const ownMessages = await db
    .select({ bodyMd: messages.bodyMd })
    .from(messages)
    .where(
      and(eq(messages.authorId, userId), gte(messages.createdAt, from), lt(messages.createdAt, to), sql`${messages.deletedAt} IS NULL`),
    )
    .orderBy(messages.createdAt);
  for (const m of ownMessages) {
    const text = m.bodyMd.trim();
    // app:// karty a prázdne správy do denníka nepatria.
    if (text && !text.startsWith('app://')) lines.push(`- [moja správa] ${text}`);
  }

  return lines;
}

/**
 * Worker job 'diary.generate': poskladá podklady dňa a nechá LLM napísať
 * súvislý zápis v 1. osobe. Výsledok je VŽDY draft (human-in-the-loop).
 * Prázdny deň alebo existujúci zápis → nič (žiadne vymýšľanie z ničoho).
 */
export async function generateEntry(userId: string, dateIso: string): Promise<string | null> {
  const existing = await db
    .select({ id: diaryEntries.id })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.userId, userId), eq(diaryEntries.date, dateIso)))
    .limit(1);
  if (existing[0]) return null;

  const material = await collectDayMaterial(userId, dateIso);
  if (material.length === 0) return null;

  const bodyMd = await chatCompletion(
    [
      {
        role: 'system',
        content:
          'Si pomocník na písanie osobného denníka. Z poskytnutých surových poznámok ' +
          'a aktivity jedného človeka za deň napíš súvislý text osobného denníka ' +
          'v 1. osobe, po slovensky, teplý a osobný tón, 1–3 odseky. ' +
          'Píš LEN o tom, čo je v podkladoch — nepridávaj žiadne fakty, mená ani ' +
          'udalosti, ktoré tam nie sú. Neuvádzaj dátum ani nadpis.',
      },
      { role: 'user', content: `Podklady za deň ${dateIso}:\n${material.join('\n')}` },
    ],
    { temperature: 0.6 },
  );

  const inserted = await db
    .insert(diaryEntries)
    .values({ userId, date: dateIso, bodyMd: bodyMd.trim(), status: 'draft' })
    .onConflictDoNothing()
    .returning();
  if (!inserted[0]) return null;

  await publishCrossProcess(`user:${userId}`, { t: 'diary:update', date: dateIso });
  return inserted[0].id;
}

/** Ranná notifikácia o hotovom drafte (worker job 'diary.notify'). */
export async function notifyDraft(userId: string, dateIso: string): Promise<void> {
  const rows = await db
    .select({ status: diaryEntries.status })
    .from(diaryEntries)
    .where(and(eq(diaryEntries.userId, userId), eq(diaryEntries.date, dateIso)))
    .limit(1);
  if (rows[0]?.status !== 'draft') return; // medzitým potvrdený/zmazaný
  const { notifyUsers } = await import('../notifications/service');
  await notifyUsers([userId], 'diary.draft', {
    title: 'Tvoj včerajšok je pripravený ✍️',
    body: 'Prečítaj si návrh zápisu do denníka a potvrď ho.',
    url: '/',
    tag: `diary-${dateIso}`,
  });
}

// ── Embeddings + sémantické hľadanie ────────────────────────────────────────

/** Worker job 'diary.embed' — počíta sa len pre potvrdené zápisy. */
export async function embedEntry(entryId: string, userId: string): Promise<void> {
  const entry = await getOwnEntry(entryId, userId).catch(() => null);
  if (!entry || entry.status !== 'confirmed') return;
  const embedding = await embedText(entry.bodyMd);
  await db
    .insert(diaryEmbeddings)
    .values({ entryId, userId, embedding })
    .onConflictDoUpdate({ target: diaryEmbeddings.entryId, set: { embedding } });
}

export async function searchEntries(userId: string, query: string): Promise<DiarySearchResponse> {
  const qVec = await embedText(query);
  const vecLiteral = `[${qVec.join(',')}]`;
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT e.id, e.date, e.body_md AS "bodyMd", e.status,
           e.confirmed_at AS "confirmedAt", e.created_at AS "createdAt",
           1 - (emb.embedding <=> ${vecLiteral}::vector) AS similarity
    FROM diary_embeddings emb
    JOIN diary_entries e ON e.id = emb.entry_id
    WHERE emb.user_id = ${userId}
    ORDER BY emb.embedding <=> ${vecLiteral}::vector
    LIMIT 5
  `);
  return {
    results: rows.map((r) => ({
      id: r.id as string,
      date: r.date as string,
      bodyMd: r.bodyMd as string,
      status: r.status as 'draft' | 'confirmed',
      confirmedAt: r.confirmedAt ? new Date(r.confirmedAt as string).toISOString() : null,
      createdAt: new Date(r.createdAt as string).toISOString(),
      similarity: Number(r.similarity),
    })),
  };
}

// ── Nočný beh (worker) ──────────────────────────────────────────────────────

/**
 * O ~23:30 vygeneruj draft za dnešok každému, kto má podklady, a ráno
 * o 6:00 UTC mu príde push (job 'diary.notify' s odloženým runAt).
 */
export async function runNightly(now = new Date()): Promise<void> {
  const dateIso = now.toISOString().slice(0, 10);
  const { users } = await import('../../core/db/schema');
  const all = await db.select({ id: users.id }).from(users);
  const morning = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6));
  morning.setUTCDate(morning.getUTCDate() + 1);

  for (const u of all) {
    try {
      const created = await generateEntry(u.id, dateIso);
      if (created) {
        await enqueueJob('diary.notify', { userId: u.id, date: dateIso }, { runAt: morning });
      }
    } catch (err) {
      // Jeden zlyhaný užívateľ nesmie zhodiť celý beh.
      console.error(`diary.daily pre ${u.id} zlyhal:`, err);
    }
  }
}
