import { useState } from 'react';
import type { CommentPublic } from '@rodinna/shared-types';
import { MAX_COMMENT_DEPTH } from '@rodinna/shared-types';
import { ApiError, feedApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../shared/Avatar';
import { ReactionBar } from './ReactionBar';

interface CommentThreadProps {
  postId: string;
  comments: CommentPublic[];
  onChange: (comments: CommentPublic[]) => void;
}

function CommentNode({
  comment,
  childComments,
  postId,
  comments,
  onChange,
}: {
  comment: CommentPublic;
  childComments: CommentPublic[];
  postId: string;
  comments: CommentPublic[];
  onChange: (comments: CommentPublic[]) => void;
}) {
  const { user } = useAuth();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;

  const canDelete = comment.author.id === user.id || user.role === 'admin';
  const canReply = comment.depth < MAX_COMMENT_DEPTH;

  const submitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await feedApi.createComment(postId, { bodyMd: trimmed, parentCommentId: comment.id });
      onChange([...comments, created]);
      setText('');
      setReplying(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Odpoveď sa nepodarilo uložiť');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Zmazať tento komentár?')) return;
    await feedApi.deleteComment(comment.id);
    onChange(comments.filter((c) => c.id !== comment.id));
  };

  return (
    <li>
      <div className="flex gap-2.5">
        <Avatar user={comment.author} size={28} />
        <div className="flex-1">
          <div className="rounded-2xl bg-neutral-100 dark:bg-neutral-800 px-3 py-2">
            <p className="text-sm font-medium">{comment.author.displayName}</p>
            <p className="text-sm whitespace-pre-wrap">{comment.bodyMd}</p>
          </div>
          <div className="mt-1 flex items-center gap-3 px-1">
            <ReactionBar
              targetType="comment"
              targetId={comment.id}
              reactions={comment.reactions}
              onChange={(reactions) =>
                onChange(comments.map((c) => (c.id === comment.id ? { ...c, reactions } : c)))
              }
            />
            {canReply && (
              <button type="button" onClick={() => setReplying((r) => !r)} className="text-xs text-neutral-500 hover:underline">
                Odpovedať
              </button>
            )}
            {canDelete && (
              <button type="button" onClick={remove} className="text-xs text-red-600 hover:underline">
                Zmazať
              </button>
            )}
          </div>
          {error && <p className="mt-1 px-1 text-xs text-red-600">{error}</p>}
          {replying && (
            <form onSubmit={submitReply} className="mt-2 flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={2000}
                autoFocus
                placeholder="Tvoja odpoveď…"
                className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={busy || !text.trim()}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Odoslať
              </button>
            </form>
          )}
          {childComments.length > 0 && (
            <ul className="mt-2 space-y-2.5 border-l border-neutral-200 dark:border-neutral-700 pl-3">
              {childComments.map((child) => (
                <CommentNode
                  key={child.id}
                  comment={child}
                  childComments={comments.filter((c) => c.parentCommentId === child.id)}
                  postId={postId}
                  comments={comments}
                  onChange={onChange}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

/** Vykreslí plochý zoznam komentárov ako strom (max hĺbka 3, depth 0-2). */
export function CommentThread({ postId, comments, onChange }: CommentThreadProps) {
  const roots = comments.filter((c) => c.parentCommentId === null);
  if (roots.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2.5">
      {roots.map((root) => (
        <CommentNode
          key={root.id}
          comment={root}
          childComments={comments.filter((c) => c.parentCommentId === root.id)}
          postId={postId}
          comments={comments}
          onChange={onChange}
        />
      ))}
    </ul>
  );
}
