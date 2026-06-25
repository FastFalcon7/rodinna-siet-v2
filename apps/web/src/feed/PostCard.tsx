import { useState } from 'react';
import type { CommentPublic, PostPublic } from '@rodinna/shared-types';
import { ApiError, feedApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../shared/Avatar';
import { ReactionBar } from './ReactionBar';
import { CommentThread } from './CommentThread';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('sk-SK', { dateStyle: 'medium', timeStyle: 'short' });
}

interface PostCardProps {
  post: PostPublic;
  onChange: (post: PostPublic) => void;
  onDeleted: (id: string) => void;
}

/** Jeden príspevok vo feede: telo, médiá, reakcie a komentáre (lazy-loaded). */
export function PostCard({ post, onChange, onDeleted }: PostCardProps) {
  const { user } = useAuth();
  const [comments, setComments] = useState<CommentPublic[] | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState('');
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
    if (!confirm('Zmazať tento príspevok?')) return;
    await feedApi.deletePost(post.id);
    onDeleted(post.id);
  };

  return (
    <article className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6">
      <div className="flex items-start gap-3">
        <Avatar user={post.author} size={40} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{post.author.displayName}</p>
          <p className="text-xs text-neutral-500">
            {formatDate(post.createdAt)}
            {post.editedAt && ' · upravené'}
          </p>
        </div>
        {canManage && (
          <button type="button" onClick={remove} className="shrink-0 text-xs text-red-600 hover:underline">
            Zmazať
          </button>
        )}
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm">{post.bodyMd}</p>

      {post.media.length > 0 && (
        <div className={`mt-3 grid gap-2 ${post.media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {post.media.map((m) => (
            <img key={m.id} src={m.url} alt="" className="max-h-96 w-full rounded-xl object-cover" />
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <ReactionBar
          targetType="post"
          targetId={post.id}
          reactions={post.reactions}
          onChange={(reactions) => onChange({ ...post, reactions })}
        />
        <button type="button" onClick={loadComments} className="text-xs text-neutral-500 hover:underline">
          💬 {post.commentCount} {post.commentCount === 1 ? 'komentár' : 'komentárov'}
        </button>
      </div>

      {commentsOpen && (
        <div className="mt-3 border-t border-neutral-100 dark:border-neutral-800 pt-3">
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
              className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
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
    </article>
  );
}
