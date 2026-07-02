import { z } from 'zod';
import { MediaPublicSchema } from './media';

/** Autor postu/komentára — odľahčený výrez z UserPublic (bez emailu). */
export const PostAuthorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type PostAuthor = z.infer<typeof PostAuthorSchema>;

/** Fixná sada reakcií (§10 — emoji-mart je Phase 2 polish, zatiaľ stačí toto). */
export const ALLOWED_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export const ReactionEmojiSchema = z.enum(ALLOWED_REACTION_EMOJIS);
export type ReactionEmoji = z.infer<typeof ReactionEmojiSchema>;

export const ReactionTargetTypeSchema = z.enum(['post', 'comment', 'message']);
export type ReactionTargetType = z.infer<typeof ReactionTargetTypeSchema>;

/** Agregovaný súhrn reakcií na jednom targete (zoskupené podľa emoji). */
export const ReactionSummarySchema = z.object({
  emoji: z.string(),
  count: z.number().int().positive(),
  reactedByMe: z.boolean(),
});
export type ReactionSummary = z.infer<typeof ReactionSummarySchema>;

export const SetReactionInputSchema = z.object({
  targetType: ReactionTargetTypeSchema,
  targetId: z.string().uuid(),
  emoji: ReactionEmojiSchema,
});
export type SetReactionInput = z.infer<typeof SetReactionInputSchema>;

/** Vnorené komentáre max do hĺbky 3 (depth 0,1,2) — §11. */
export const MAX_COMMENT_DEPTH = 2;

export const CreatePostInputSchema = z.object({
  bodyMd: z.string().trim().min(1, 'Príspevok nemôže byť prázdny').max(4000),
  mediaIds: z.array(z.string().uuid()).max(10).default([]),
});
export type CreatePostInput = z.infer<typeof CreatePostInputSchema>;

export const UpdatePostInputSchema = z.object({
  bodyMd: z.string().trim().min(1, 'Príspevok nemôže byť prázdny').max(4000),
});
export type UpdatePostInput = z.infer<typeof UpdatePostInputSchema>;

export const PostPublicSchema = z.object({
  id: z.string().uuid(),
  author: PostAuthorSchema,
  bodyMd: z.string(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  media: z.array(MediaPublicSchema),
  commentCount: z.number().int(),
  reactions: z.array(ReactionSummarySchema),
});
export type PostPublic = z.infer<typeof PostPublicSchema>;

export const FeedPageSchema = z.object({
  posts: z.array(PostPublicSchema),
  nextCursor: z.string().nullable(),
});
export type FeedPage = z.infer<typeof FeedPageSchema>;

export const CreateCommentInputSchema = z.object({
  bodyMd: z.string().trim().min(1, 'Komentár nemôže byť prázdny').max(2000),
  parentCommentId: z.string().uuid().nullable().optional(),
});
export type CreateCommentInput = z.infer<typeof CreateCommentInputSchema>;

export const CommentPublicSchema = z.object({
  id: z.string().uuid(),
  postId: z.string().uuid(),
  parentCommentId: z.string().uuid().nullable(),
  author: PostAuthorSchema,
  bodyMd: z.string(),
  depth: z.number().int(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  reactions: z.array(ReactionSummarySchema),
});
export type CommentPublic = z.infer<typeof CommentPublicSchema>;

export const CommentsResponseSchema = z.object({
  comments: z.array(CommentPublicSchema),
});
export type CommentsResponse = z.infer<typeof CommentsResponseSchema>;
