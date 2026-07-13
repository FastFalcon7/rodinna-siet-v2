import { and, asc, eq, inArray } from 'drizzle-orm';
import type { CreatePollInput, PollPublic, PostAuthor } from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import {
  feedCards,
  media,
  pollOptions,
  polls,
  pollVotes,
  users,
  type PollRow,
} from '../../core/db/schema';
import { APP_TOPIC } from '../../core/realtime';
import { publishCrossProcess } from '../../core/events';
import { enqueueJob } from '../../core/jobs/queue';
import { notifyUsers } from '../notifications/service';
import { toMediaPublic } from '../media/service';

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class BadRequestError extends Error {}

function isClosed(poll: PollRow, now = new Date()): boolean {
  if (poll.closedAt) return true;
  return poll.closesAt !== null && poll.closesAt <= now;
}

// ── Hydratácia ───────────────────────────────────────────────────────────────

async function getPollRow(pollId: string): Promise<PollRow> {
  const rows = await db.select().from(polls).where(eq(polls.id, pollId)).limit(1);
  if (!rows[0]) throw new NotFoundError('Anketa nenájdená');
  return rows[0];
}

export async function getPoll(pollId: string, viewerId: string): Promise<PollPublic> {
  return hydratePoll(await getPollRow(pollId), viewerId);
}

async function hydratePoll(poll: PollRow, viewerId: string): Promise<PollPublic> {
  const [authorRows, optionRows, voteRows] = await Promise.all([
    db
      .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, nameColor: users.nameColor })
      .from(users)
      .where(eq(users.id, poll.authorId)),
    db.select().from(pollOptions).where(eq(pollOptions.pollId, poll.id)).orderBy(asc(pollOptions.order)),
    db
      .select({
        optionId: pollVotes.optionId,
        userId: pollVotes.userId,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(pollVotes)
      .innerJoin(users, eq(pollVotes.userId, users.id))
      .where(eq(pollVotes.pollId, poll.id)),
  ]);

  const votesByOption = new Map<string, typeof voteRows>();
  for (const v of voteRows) {
    const list = votesByOption.get(v.optionId) ?? [];
    list.push(v);
    votesByOption.set(v.optionId, list);
  }

  // Fotky možností (ladenie 07/2026) — obrázkové ankety.
  const mediaIds = [...new Set(optionRows.map((o) => o.mediaId).filter((v): v is string => v !== null))];
  const mediaRows = mediaIds.length
    ? await db.select().from(media).where(inArray(media.id, mediaIds))
    : [];
  const mediaMap = new Map(mediaRows.map((m) => [m.id, toMediaPublic(m)]));

  return {
    id: poll.id,
    author: authorRows[0] ?? { id: poll.authorId, displayName: '—', avatarUrl: null },
    question: poll.question,
    kind: poll.kind,
    anonymous: poll.anonymous,
    closesAt: poll.closesAt?.toISOString() ?? null,
    closed: isClosed(poll),
    options: optionRows.map((o) => {
      const votes = votesByOption.get(o.id) ?? [];
      return {
        id: o.id,
        label: o.label,
        media: o.mediaId ? (mediaMap.get(o.mediaId) ?? null) : null,
        votes: votes.length,
        votedByMe: votes.some((v) => v.userId === viewerId),
        voters: poll.anonymous
          ? []
          : votes.map((v) => ({ id: v.userId, displayName: v.displayName, avatarUrl: v.avatarUrl })),
      };
    }),
    totalVoters: new Set(voteRows.map((v) => v.userId)).size,
    createdAt: poll.createdAt.toISOString(),
  };
}

// ── Operácie ─────────────────────────────────────────────────────────────────

export async function createPoll(author: PostAuthor, input: CreatePollInput): Promise<PollPublic> {
  const closesAt = input.closesAt ? new Date(input.closesAt) : null;
  if (closesAt && closesAt <= new Date()) {
    throw new BadRequestError('Deadline musí byť v budúcnosti');
  }

  // Fotky možností musia existovať (family-wide, ako albumy).
  const optMediaIds = [...new Set(input.options.map((o) => o.mediaId).filter((v): v is string => !!v))];
  if (optMediaIds.length > 0) {
    const found = await db.select({ id: media.id }).from(media).where(inArray(media.id, optMediaIds));
    if (found.length !== optMediaIds.length) {
      throw new BadRequestError('Niektoré fotky možností neexistujú');
    }
  }

  const inserted = await db
    .insert(polls)
    .values({
      authorId: author.id,
      question: input.question,
      kind: input.kind,
      anonymous: input.anonymous,
      closesAt,
    })
    .returning();
  const poll = inserted[0]!;

  await db
    .insert(pollOptions)
    .values(
      input.options.map((o, order) => ({ pollId: poll.id, label: o.label, mediaId: o.mediaId ?? null, order })),
    );

  if (input.toFeed) {
    await db.insert(feedCards).values({ module: 'polls', entityId: poll.id, authorId: author.id });
    await publishCrossProcess(APP_TOPIC, { t: 'feed:card', module: 'polls', entityId: poll.id });
  }

  // Auto-uzavretie po deadline (worker job) — notifikuje výsledok.
  if (closesAt) {
    await enqueueJob('polls.close', { pollId: poll.id }, { runAt: closesAt });
  }

  return hydratePoll(poll, author.id);
}

export async function vote(pollId: string, viewerId: string, optionIds: string[]): Promise<PollPublic> {
  const poll = await getPollRow(pollId);
  if (isClosed(poll)) throw new ForbiddenError('Anketa je už uzavretá');
  if (poll.kind === 'single' && optionIds.length > 1) {
    throw new BadRequestError('V tejto ankete môžeš vybrať len jednu možnosť');
  }

  if (optionIds.length > 0) {
    const valid = await db
      .select({ id: pollOptions.id })
      .from(pollOptions)
      .where(and(eq(pollOptions.pollId, pollId), inArray(pollOptions.id, optionIds)));
    if (valid.length !== new Set(optionIds).size) {
      throw new BadRequestError('Niektorá možnosť do tejto ankety nepatrí');
    }
  }

  // Hlas = kompletná množina mojich volieb → idempotentný replace.
  await db.transaction(async (tx) => {
    await tx.delete(pollVotes).where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, viewerId)));
    if (optionIds.length > 0) {
      await tx
        .insert(pollVotes)
        .values(optionIds.map((optionId) => ({ pollId, optionId, userId: viewerId })));
    }
  });

  await publishCrossProcess(APP_TOPIC, { t: 'poll:update', pollId });
  return hydratePoll(poll, viewerId);
}

export async function closePoll(pollId: string, userId: string): Promise<PollPublic> {
  const poll = await getPollRow(pollId);
  if (poll.authorId !== userId) throw new ForbiddenError('Anketu môže uzavrieť len jej autor');
  if (!isClosed(poll)) {
    await db.update(polls).set({ closedAt: new Date() }).where(eq(polls.id, pollId));
    await announceClosed(pollId);
  }
  return getPoll(pollId, userId);
}

/**
 * Uzavretie ankety (manuálne aj worker jobom): poll:update pre živé karty
 * + notifikácia s víťazom autorovi a hlasujúcim (kind polls.closed, K3).
 */
export async function announceClosed(pollId: string): Promise<void> {
  const poll = await getPollRow(pollId);
  const pub = await hydratePoll(poll, poll.authorId);

  await publishCrossProcess(APP_TOPIC, { t: 'poll:update', pollId });

  const top = [...pub.options].sort((a, b) => b.votes - a.votes);
  const winner = top[0];
  const tie = top.length > 1 && top[1]!.votes === winner?.votes && (winner?.votes ?? 0) > 0;
  const body =
    !winner || winner.votes === 0
      ? 'Nikto nehlasoval.'
      : tie
        ? `Remíza (${winner.votes} hlasov).`
        : `Vyhráva „${winner.label}" (${winner.votes} ${winner.votes === 1 ? 'hlas' : winner.votes < 5 ? 'hlasy' : 'hlasov'}).`;

  const voterIds = new Set<string>(poll.anonymous ? [] : pub.options.flatMap((o) => o.voters.map((v) => v.id)));
  if (poll.anonymous) {
    // Pri anonymnej ankete hydratácia voters nevracia — načítaj priamo.
    const rows = await db
      .selectDistinct({ userId: pollVotes.userId })
      .from(pollVotes)
      .where(eq(pollVotes.pollId, pollId));
    for (const r of rows) voterIds.add(r.userId);
  }
  voterIds.add(poll.authorId);

  await notifyUsers([...voterIds], 'polls.closed', {
    title: `Anketa skončila: ${poll.question}`,
    body,
    url: '/',
    tag: `poll-${pollId}`,
  });
}

/** Worker job 'polls.close' — uzavri po deadline, ak ju autor neuzavrel skôr. */
export async function closeByDeadline(pollId: string): Promise<void> {
  const poll = await getPollRow(pollId).catch(() => null);
  if (!poll || poll.closedAt) return;
  await db.update(polls).set({ closedAt: poll.closesAt ?? new Date() }).where(eq(polls.id, pollId));
  await announceClosed(pollId);
}
