import { useState } from 'react';
import type { CommentPublic, PostPublic } from '@rodinna/shared-types';
import { ApiError, feedApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../shared/Avatar';
import { MediaItem } from '../shared/MediaItem';
import { fullDateTime, relativeTime } from '../shared/time';
import { ReactionBar } from './ReactionBar';
import { CommentThread } from './CommentThread';

interface PostCardProps {
  post: PostPublic;
  onChange: (post: PostPublic) => void;
  onDeleted: (id: string) => void;
}

/**
 * Príspevok vo feede à la Bluesky (DESIGN_REVIEW_FEED_CHAT.md §3.1):
 * edge-to-edge, avatar vľavo, relatívny čas, akcie v ⋯ menu, action row dole.
 */
export function PostCard({ post, onChange, onDeleted }: PostCardProps) {
  const { user } = useAuth();
  const [comments, setComments] = useState<CommentPublic[] | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;

  const canManage = post.author.id === user.id || user.role === 'admin';

  const loadComments = async () => {
    setCommentsOpen((open) => !open);
    if (comments === null) {
      const r = await feedApi.listComments(post.id);
      setComments(r.comments);
    }
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await feedApi.createComment(post.id, { bodyMd: trimmed });
      setComments((prev) => [...(prev ?? []), created]);
      onChange({ ...post, commentCount: post.commentCount + 1 });
      setCommentText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Komentár sa nepodarilo uložiť');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setMenuOpen(false);
    if (!confirm('Zmazať tento príspevok?')) return;
    await feedApi.deletePost(post.id);
    onDeleted(post.id);
  };

  // Obrázky do mriežky, video a súbory pod nimi na plnú šírku.
  const images = post.media.filter((m) => m.kind === 'image');
  const rest = post.media.filter((m) => m.kind !== 'image');

  return (
    <article className="px-4 py-3">
      <div className="flex gap-3">
        <Avatar user={post.author} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{post.author.displayName}</span>
            <span
              className="shrink-0 text-sm text-neutral-500"
              title={fullDateTime(post.createdAt)}
            >
              · {relativeTime(post.createdAt)}
            </span>
            {post.editedAt && <span className="shrink-0 text-xs text-neutral-400">· upravené</span>}
            {canManage && (
              <div className="relative ml-auto">
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  className="grid h-8 w-8 place-items-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                  aria-label="Možnosti príspevku"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                      <button
                        type="button"
                        onClick={remove}
                        className="w-full px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        🗑 Zmazať
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {post.bodyMd && (
            <p className="mt-1 whitespace-pre-wrap text-[15px] leading-[1.55] [overflow-wrap:anywhere]">
              {post.bodyMd}
            </p>
          )}

          {post.media.length > 0 && (
            <div className="mt-2 space-y-2">
              {images.length > 0 && (
                <div
                  className={`grid gap-0.5 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 ${
                    images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                  }`}
                >
                  {images.map((m) => (
                    <MediaItem key={m.id} media={m} className="rounded-none" />
                  ))}
                </div>
              )}
              {rest.map((m) => (
                <MediaItem key={m.id} media={m} />
              ))}
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={loadComments}
              className="flex min-h-8 items-center gap-1 rounded-full px-2 text-sm text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
              title="Komentáre"
            >
              <CommentIcon />
              {post.commentCount > 0 && post.commentCount}
            </button>
            <ReactionBar
              targetType="post"
              targetId={post.id}
              reactions={post.reactions}
              onChange={(reactions) => onChange({ ...post, reactions })}
            />
          </div>

          {commentsOpen && (
            <div className="mt-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              {comments === null && <p className="text-sm text-neutral-500">Načítavam…</p>}
              {comments && (
                <CommentThread
                  postId={post.id}
                  comments={comments}
                  onChange={(next) => {
                    setComments(next);
                    onChange({ ...post, commentCount: next.length });
                  }}
                />
              )}
              <form onSubmit={submitComment} className="mt-3 flex gap-2">
                <Avatar user={user} size={28} />
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  maxLength={2000}
                  placeholder="Napíš komentár…"
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent dark:border-neutral-700"
                />
                <button
                  type="submit"
                  disabled={busy || !commentText.trim()}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Odoslať
                </button>
              </form>
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function CommentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden
    >
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.1-1L3 20l1.1-5A8.5 8.5 0 1 1 21 11.5Z" />
    </svg>
  );
}
