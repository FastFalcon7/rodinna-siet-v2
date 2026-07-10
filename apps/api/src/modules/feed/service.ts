import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  MAX_COMMENT_DEPTH,
  type CommentPublic,
  type CreateCommentInput,
  type CreatePostInput,
  type FeedPage,
  type PostAuthor,
  type PostPublic,
  type ReactionSummary,
  type ReactionTargetType,
} from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import {
  commentMedia,
  comments,
  feedCards,
  media,
  postMedia,
  posts,
  reactions,
  users,
  type CommentRow,
  type FeedCardRow,
  type PostRow,
} from '../../core/db/schema';
import { toMediaPublic } from '../media/service';
import { decodeCursor, encodeCursor, type Cursor } from './cursor';

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class DepthExceededError extends Error {}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

async function fetchAuthors(userIds: string[]): Promise<Map<string, PostAuthor>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, userIds));
  return new Map(rows.map((r) => [r.id, r]));
}

async function fetchReactionSummaries(
  targetType: ReactionTargetType,
  targetIds: string[],
  viewerId: string,
): Promise<Map<string, ReactionSummary[]>> {
  if (targetIds.length === 0) return new Map();
  const rows = await db
    .select({
      targetId: reactions.targetId,
      emoji: reactions.emoji,
      count: sql<number>`count(*)::int`,
      reactedByMe: sql<boolean>`bool_or(${reactions.userId} = ${viewerId})`,
    })
    .from(reactions)
    .where(and(eq(reactions.targetType, targetType), inArray(reactions.targetId, targetIds)))
    .groupBy(reactions.targetId, reactions.emoji);

  const map = new Map<string, ReactionSummary[]>();
  for (const r of rows) {
    const list = map.get(r.targetId) ?? [];
    list.push({ emoji: r.emoji, count: r.count, reactedByMe: r.reactedByMe });
    map.set(r.targetId, list);
  }
  return map;
}

/**
 * Agregát reakcií CELÉHO vlákna (post + jeho komentáre) — ladenie 07/2026,
 * bod 2: počítadlo pod hlavným príspevkom zahŕňa aj emotikony z komentárov
 * (ako bublina komentárov počíta celé vlákno). `reactedByMe` je zámerne len
 * z reakcií priamo na poste — riadi zvýraznenie mojej reakcie v palete.
 */
async function fetchThreadReactionSummaries(
  postIds: string[],
  viewerId: string,
): Promise<Map<string, ReactionSummary[]>> {
  if (postIds.length === 0) return new Map();
  const idList = sql.join(
    postIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await db.execute<{ post_id: string; emoji: string; count: number; reacted_by_me: boolean }>(sql`
    SELECT COALESCE(c.post_id, r.target_id) AS post_id,
           r.emoji,
           count(*)::int AS count,
           bool_or(r.user_id = ${viewerId} AND r.target_type = 'post') AS reacted_by_me
    FROM reactions r
    LEFT JOIN comments c
      ON r.target_type = 'comment' AND c.id = r.target_id AND c.deleted_at IS NULL
    WHERE (r.target_type = 'post' AND r.target_id IN (${idList}))
       OR (r.target_type = 'comment' AND c.post_id IN (${idList}))
    GROUP BY 1, r.emoji
  `);

  const map = new Map<string, ReactionSummary[]>();
  for (const r of rows) {
    const list = map.get(r.post_id) ?? [];
    list.push({ emoji: r.emoji, count: r.count, reactedByMe: r.reacted_by_me });
    map.set(r.post_id, list);
  }
  return map;
}

async function fetchCommentCounts(postIds: string[]): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map();
  const rows = await db
    .select({ postId: comments.postId, count: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(inArray(comments.postId, postIds), isNull(comments.deletedAt)))
    .groupBy(comments.postId);
  return new Map(rows.map((r) => [r.postId, r.count]));
}

async function fetchMediaForPosts(postIds: string[]) {
  if (postIds.length === 0) return new Map<string, ReturnType<typeof toMediaPublic>[]>();
  const rows = await db
    .select({ postId: postMedia.postId, media })
    .from(postMedia)
    .innerJoin(media, eq(postMedia.mediaId, media.id))
    .where(inArray(postMedia.postId, postIds))
    .orderBy(asc(postMedia.postId), asc(postMedia.order));

  const map = new Map<string, ReturnType<typeof toMediaPublic>[]>();
  for (const r of rows) {
    const list = map.get(r.postId) ?? [];
    list.push(toMediaPublic(r.media));
    map.set(r.postId, list);
  }
  return map;
}

async function hydratePosts(rows: PostRow[], viewerId: string): Promise<PostPublic[]> {
  if (rows.length === 0) return [];
  const postIds = rows.map((r) => r.id);
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const [authors, mediaMap, commentCounts, reactionMap] = await Promise.all([
    fetchAuthors(authorIds),
    fetchMediaForPosts(postIds),
    fetchCommentCounts(postIds),
    fetchThreadReactionSummaries(postIds, viewerId),
  ]);
  return rows.map((row) => ({
    id: row.id,
    author: authors.get(row.authorId)!,
    bodyMd: row.bodyMd,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    media: mediaMap.get(row.id) ?? [],
    commentCount: commentCounts.get(row.id) ?? 0,
    reactions: reactionMap.get(row.id) ?? [],
  }));
}

async function fetchMediaForComments(commentIds: string[]) {
  if (commentIds.length === 0) return new Map<string, ReturnType<typeof toMediaPublic>[]>();
  const rows = await db
    .select({ commentId: commentMedia.commentId, media })
    .from(commentMedia)
    .innerJoin(media, eq(commentMedia.mediaId, media.id))
    .where(inArray(commentMedia.commentId, commentIds))
    .orderBy(asc(commentMedia.commentId), asc(commentMedia.order));

  const map = new Map<string, ReturnType<typeof toMediaPublic>[]>();
  for (const r of rows) {
    const list = map.get(r.commentId) ?? [];
    list.push(toMediaPublic(r.media));
    map.set(r.commentId, list);
  }
  return map;
}

async function hydrateComments(rows: CommentRow[], viewerId: string): Promise<CommentPublic[]> {
  if (rows.length === 0) return [];
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const commentIds = rows.map((r) => r.id);
  const [authors, mediaMap, reactionMap] = await Promise.all([
    fetchAuthors(authorIds),
    fetchMediaForComments(commentIds),
    fetchReactionSummaries('comment', commentIds, viewerId),
  ]);
  return rows.map((row) => ({
    id: row.id,
    postId: row.postId,
    parentCommentId: row.parentCommentId,
    author: authors.get(row.authorId)!,
    bodyMd: row.bodyMd,
    depth: row.depth,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    media: mediaMap.get(row.id) ?? [],
    reactions: reactionMap.get(row.id) ?? [],
  }));
}

async function hydrateCards(rows: FeedCardRow[]): Promise<Map<string, FeedPage['items'][number]>> {
  const map = new Map<string, FeedPage['items'][number]>();
  if (rows.length === 0) return map;
  const authors = await fetchAuthors([...new Set(rows.map((r) => r.authorId))]);
  for (const row of rows) {
    map.set(row.id, {
      type: 'card',
      card: {
        id: row.id,
        module: row.module,
        entityId: row.entityId,
        author: authors.get(row.authorId)!,
        createdAt: row.createdAt.toISOString(),
      },
    });
  }
  return map;
}

/**
 * Cursor-based (keyset) pagination — stabilná aj keď medzitým pribudnú nové
 * položky. Feed je od M1 UNION postov a živých kariet modulov (K1): obe
 * strany zdieľajú kurzor (createdAt, id), merge sa robí v aplikácii —
 * načíta sa limit+1 z oboch a zoberie sa najnovších `limit`.
 */
export async function listFeed(
  viewerId: string,
  opts: { limit?: number; cursorRaw?: string | null },
): Promise<FeedPage> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor: Cursor | null = opts.cursorRaw ? decodeCursor(opts.cursorRaw) : null;
  const cAt = cursor ? new Date(cursor.createdAt) : null;

  const postWhere = [isNull(posts.deletedAt)];
  const cardWhere = [isNull(feedCards.deletedAt)];
  if (cursor && cAt) {
    postWhere.push(
      or(lt(posts.createdAt, cAt), and(eq(posts.createdAt, cAt), lt(posts.id, cursor.id)))!,
    );
    cardWhere.push(
      or(lt(feedCards.createdAt, cAt), and(eq(feedCards.createdAt, cAt), lt(feedCards.id, cursor.id)))!,
    );
  }

  const [postRows, cardRows] = await Promise.all([
    db
      .select()
      .from(posts)
      .where(and(...postWhere))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit + 1),
    db
      .select()
      .from(feedCards)
      .where(and(...cardWhere))
      .orderBy(desc(feedCards.createdAt), desc(feedCards.id))
      .limit(limit + 1),
  ]);

  // Merge podľa (createdAt, id) desc a orez na limit(+1 na hasMore).
  type Ref = { kind: 'post' | 'card'; createdAt: Date; id: string };
  const refs: Ref[] = [
    ...postRows.map((r) => ({ kind: 'post' as const, createdAt: r.createdAt, id: r.id })),
    ...cardRows.map((r) => ({ kind: 'card' as const, createdAt: r.createdAt, id: r.id })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));

  const hasMore = refs.length > limit;
  const pageRefs = refs.slice(0, limit);

  const pagePosts = new Set(pageRefs.filter((r) => r.kind === 'post').map((r) => r.id));
  const pageCards = new Set(pageRefs.filter((r) => r.kind === 'card').map((r) => r.id));
  const [hydratedPosts, cardMap] = await Promise.all([
    hydratePosts(postRows.filter((r) => pagePosts.has(r.id)), viewerId),
    hydrateCards(cardRows.filter((r) => pageCards.has(r.id))),
  ]);
  const postMap = new Map(hydratedPosts.map((p) => [p.id, p]));

  const items: FeedPage['items'] = pageRefs.map((ref) =>
    ref.kind === 'post' ? { type: 'post', post: postMap.get(ref.id)! } : cardMap.get(ref.id)!,
  );

  const last = pageRefs[pageRefs.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { items, nextCursor };
}

export async function createPost(authorId: string, input: CreatePostInput, viewerId: string): Promise<PostPublic> {
  if (input.mediaIds.length > 0) {
    const owned = await db
      .select({ id: media.id })
      .from(media)
      .where(and(inArray(media.id, input.mediaIds), eq(media.ownerId, authorId)));
    if (owned.length !== input.mediaIds.length) {
      throw new ForbiddenError('Niektoré médiá neexistujú alebo nie sú tvoje');
    }
  }

  const inserted = await db.insert(posts).values({ authorId, bodyMd: input.bodyMd }).returning();
  const post = inserted[0]!;

  if (input.mediaIds.length > 0) {
    await db.insert(postMedia).values(input.mediaIds.map((mediaId, order) => ({ postId: post.id, mediaId, order })));
  }

  const [hydrated] = await hydratePosts([post], viewerId);
  return hydrated!;
}

async function getOwnPost(postId: string): Promise<PostRow | null> {
  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updatePost(postId: string, userId: string, bodyMd: string, viewerId: string): Promise<PostPublic> {
  const post = await getOwnPost(postId);
  if (!post) throw new NotFoundError('Príspevok nenájdený');
  if (post.authorId !== userId) throw new ForbiddenError('Môžeš upraviť len svoj príspevok');

  const updated = await db
    .update(posts)
    .set({ bodyMd, editedAt: new Date() })
    .where(eq(posts.id, postId))
    .returning();
  const [hydrated] = await hydratePosts([updated[0]!], viewerId);
  return hydrated!;
}

export async function deletePost(postId: string, userId: string, isAdmin: boolean): Promise<void> {
  const post = await getOwnPost(postId);
  if (!post) throw new NotFoundError('Príspevok nenájdený');
  if (post.authorId !== userId && !isAdmin) throw new ForbiddenError('Nemáš oprávnenie zmazať tento príspevok');
  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId));
}

export async function listComments(postId: string, viewerId: string): Promise<CommentPublic[]> {
  const post = await getOwnPost(postId);
  if (!post) throw new NotFoundError('Príspevok nenájdený');

  const rows = await db
    .select()
    .from(comments)
    .where(and(eq(comments.postId, postId), isNull(comments.deletedAt)))
    .orderBy(asc(comments.createdAt));
  return hydrateComments(rows, viewerId);
}

export async function createComment(
  postId: string,
  author: PostAuthor,
  input: CreateCommentInput,
  viewerId: string,
): Promise<CommentPublic> {
  const post = await getOwnPost(postId);
  if (!post) throw new NotFoundError('Príspevok nenájdený');

  // Rovnaké pravidlo ako pri poste: prílohy musia existovať a patriť autorovi.
  if (input.mediaIds.length > 0) {
    const owned = await db
      .select({ id: media.id })
      .from(media)
      .where(and(inArray(media.id, input.mediaIds), eq(media.ownerId, author.id)));
    if (owned.length !== input.mediaIds.length) {
      throw new ForbiddenError('Niektoré médiá neexistujú alebo nie sú tvoje');
    }
  }

  let depth = 0;
  if (input.parentCommentId) {
    const parentRows = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, input.parentCommentId), eq(comments.postId, postId), isNull(comments.deletedAt)))
      .limit(1);
    const parent = parentRows[0];
    if (!parent) throw new NotFoundError('Rodičovský komentár nenájdený');
    depth = parent.depth + 1;
    if (depth > MAX_COMMENT_DEPTH) {
      throw new DepthExceededError(`Komentáre môžu byť vnorené max. do hĺbky ${MAX_COMMENT_DEPTH + 1}`);
    }
  }

  const inserted = await db
    .insert(comments)
    .values({
      postId,
      parentCommentId: input.parentCommentId ?? null,
      authorId: author.id,
      bodyMd: input.bodyMd,
      depth,
    })
    .returning();
  const comment = inserted[0]!;

  if (input.mediaIds.length > 0) {
    await db
      .insert(commentMedia)
      .values(input.mediaIds.map((mediaId, order) => ({ commentId: comment.id, mediaId, order })));
  }

  const [hydrated] = await hydrateComments([comment], viewerId);
  return hydrated!;
}

export async function deleteComment(commentId: string, userId: string, isAdmin: boolean): Promise<void> {
  const rows = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
    .limit(1);
  const comment = rows[0];
  if (!comment) throw new NotFoundError('Komentár nenájdený');
  if (comment.authorId !== userId && !isAdmin) throw new ForbiddenError('Nemáš oprávnenie zmazať tento komentár');
  await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
}

export interface ReactionResult {
  /** Súhrn cieľa reakcie — post: agregát vlákna, komentár: len jeho reakcie. */
  reactions: ReactionSummary[];
  /** Agregát vlákna príspevku (počítadlo pod hlavným postom) — vždy. */
  postReactions: ReactionSummary[];
}

/**
 * Toggle reakcia: nová emoji nahradí starú, rovnaká emoji = unreact.
 * Na vlastný obsah sa nereaguje (ladenie 07/2026, bod 2) → ForbiddenError.
 */
export async function setReaction(
  targetType: ReactionTargetType,
  targetId: string,
  userId: string,
  emoji: string,
): Promise<ReactionResult> {
  // Cieľ + jeho autor a post vlákna jedným lookupom.
  let authorId: string;
  let postId: string;
  if (targetType === 'post') {
    const post = await getOwnPost(targetId);
    if (!post) throw new NotFoundError('Cieľ reakcie nenájdený');
    authorId = post.authorId;
    postId = post.id;
  } else {
    const rows = await db
      .select({ authorId: comments.authorId, postId: comments.postId })
      .from(comments)
      .where(and(eq(comments.id, targetId), isNull(comments.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundError('Cieľ reakcie nenájdený');
    authorId = rows[0].authorId;
    postId = rows[0].postId;
  }
  if (authorId === userId) {
    throw new ForbiddenError('Na vlastný príspevok či komentár sa nereaguje 🙂');
  }

  const existingRows = await db
    .select()
    .from(reactions)
    .where(and(eq(reactions.targetType, targetType), eq(reactions.targetId, targetId), eq(reactions.userId, userId)))
    .limit(1);
  const existing = existingRows[0];

  if (existing && existing.emoji === emoji) {
    await db.delete(reactions).where(eq(reactions.id, existing.id));
  } else if (existing) {
    await db.update(reactions).set({ emoji }).where(eq(reactions.id, existing.id));
  } else {
    await db.insert(reactions).values({ targetType, targetId, userId, emoji });
  }

  const threadMap = await fetchThreadReactionSummaries([postId], userId);
  const postReactions = threadMap.get(postId) ?? [];
  if (targetType === 'post') {
    return { reactions: postReactions, postReactions };
  }
  const map = await fetchReactionSummaries('comment', [targetId], userId);
  return { reactions: map.get(targetId) ?? [], postReactions };
}
