import { useState } from 'react';
import type { CommentPublic, ReactionSummary } from '@rodinna/shared-types';
import { MAX_COMMENT_DEPTH } from '@rodinna/shared-types';
import { feedApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../shared/Avatar';
import { nameStyle } from '../shared/nameColor';
import { MediaItem } from '../shared/MediaItem';
import { ReactionBar } from './ReactionBar';
import { CommentComposer } from './CommentComposer';
import { PhotoGallery } from '../shared/PhotoGallery';

interface CommentThreadProps {
  postId: string;
  comments: CommentPublic[];
  onChange: (comments: CommentPublic[]) => void;
  /** Reakcia na komentár mení aj agregované počítadlo pod hlavným postom. */
  onPostReactions?: (reactions: ReactionSummary[]) => void;
}

function CommentNode({
  comment,
  childComments,
  postId,
  comments,
  onChange,
  onPostReactions,
}: {
  comment: CommentPublic;
  childComments: CommentPublic[];
  postId: string;
  comments: CommentPublic[];
  onChange: (comments: CommentPublic[]) => void;
  onPostReactions?: (reactions: ReactionSummary[]) => void;
}) {
  const { user } = useAuth();
  const [replying, setReplying] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  if (!user) return null;

  const canDelete = comment.author.id === user.id || user.role === 'admin';
  const canReply = comment.depth < MAX_COMMENT_DEPTH;

  const images = comment.media.filter((m) => m.kind === 'image' || m.kind === 'video');
  const rest = comment.media.filter((m) => m.kind === 'file');

  const submitReply = async (input: { bodyMd: string; mediaIds: string[] }) => {
    const created = await feedApi.createComment(postId, { ...input, parentCommentId: comment.id });
    onChange([...comments, created]);
    setReplying(false);
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
            <p className="text-sm font-medium" style={nameStyle(comment.author)}>
              {comment.author.displayName}
            </p>
            {comment.bodyMd && <p className="text-sm whitespace-pre-wrap">{comment.bodyMd}</p>}
          </div>
          {comment.media.length > 0 && (
            <div className="mt-1.5 max-w-xs space-y-1.5">
              <PhotoGallery images={images} compact />
              {rest.map((m) => (
                <MediaItem key={m.id} media={m} />
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center gap-3 px-1">
            <ReactionBar
              targetType="comment"
              targetId={comment.id}
              reactions={comment.reactions}
              canReact={comment.author.id !== user.id}
              onChange={(reactions, postReactions) => {
                onChange(comments.map((c) => (c.id === comment.id ? { ...c, reactions } : c)));
                onPostReactions?.(postReactions);
              }}
              open={reactOpen}
              onOpenChange={setReactOpen}
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
          {replying && (
            <div className="mt-2">
              <CommentComposer placeholder="Tvoja odpoveď…" autoFocus onSubmit={submitReply} />
            </div>
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
                  onPostReactions={onPostReactions}
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
export function CommentThread({ postId, comments, onChange, onPostReactions }: CommentThreadProps) {
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
          onPostReactions={onPostReactions}
        />
      ))}
    </ul>
  );
}
