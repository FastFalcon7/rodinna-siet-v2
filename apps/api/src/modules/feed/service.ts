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
  comments,
  media,
  postMedia,
  posts,
  reactions,
  users,
  type CommentRow,
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
    fetchReactionSummaries('post', postIds, viewerId),
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

async function hydrateComments(rows: CommentRow[], viewerId: string): Promise<CommentPublic[]> {
  if (rows.length === 0) return [];
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const commentIds = rows.map((r) => r.id);
  const [authors, reactionMap] = await Promise.all([
    fetchAuthors(authorIds),
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
    reactions: reactionMap.get(row.id) ?? [],
  }));
}

/** Cursor-based (keyset) pagination — stabilná aj keď medzitým pribudnú nové posty. */
export async function listFeed(
  viewerId: string,
  opts: { limit?: number; cursorRaw?: string | null },
): Promise<FeedPage> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor: Cursor | null = opts.cursorRaw ? decodeCursor(opts.cursorRaw) : null;

  const where = [isNull(posts.deletedAt)];
  if (cursor) {
    const cAt = new Date(cursor.createdAt);
    where.push(or(lt(posts.createdAt, cAt), and(eq(posts.createdAt, cAt), lt(posts.id, cursor.id)))!);
  }

  const rows = await db
    .select()
    .from(posts)
    .where(and(...where))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const hydrated = await hydratePosts(pageRows, viewerId);
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
  return { posts: hydrated, nextCursor };
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

  const [hydrated] = await hydrateComments([inserted[0]!], viewerId);
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

/** Overí, že target (post/comment) existuje a nie je zmazaný. */
async function targetExists(targetType: ReactionTargetType, targetId: string): Promise<boolean> {
  if (targetType === 'post') {
    return (await getOwnPost(targetId)) !== null;
  }
  const rows = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(eq(comments.id, targetId), isNull(comments.deletedAt)))
    .limit(1);
  return rows.length > 0;
}

/** Toggle reakcia: nová emoji nahradí starú, rovnaká emoji = unreact. Vráti aktuálny súhrn na targete. */
export async function setReaction(
  targetType: ReactionTargetType,
  targetId: string,
  userId: string,
  emoji: string,
): Promise<ReactionSummary[]> {
  if (!(await targetExists(targetType, targetId))) {
    throw new NotFoundError('Cieľ reakcie nenájdený');
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

  const map = await fetchReactionSummaries(targetType, [targetId], userId);
  return map.get(targetId) ?? [];
}
