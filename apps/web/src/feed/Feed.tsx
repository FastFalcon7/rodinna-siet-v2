import { useEffect, useState } from 'react';
import type { PostPublic } from '@rodinna/shared-types';
import { ApiError, feedApi } from '../lib/api';
import { PostComposer } from './PostComposer';
import { PostCard } from './PostCard';

/**
 * Feed à la Bluesky: edge-to-edge zoznam s hairline deličmi. Composer je
 * na desktope inline karta, na mobile FAB ✏️ + compose sheet
 * (DESIGN_REVIEW_FEED_CHAT.md §3.1).
 */
export function Feed() {
  const [posts, setPosts] = useState<PostPublic[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [compose, setCompose] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    feedApi
      .list()
      .then((page) => {
        setPosts(page.posts);
        setCursor(page.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Načítanie feedu zlyhalo'));
  }, []);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await feedApi.list(cursor);
      setPosts((prev) => [...(prev ?? []), ...page.posts]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Načítanie ďalších príspevkov zlyhalo');
    } finally {
      setLoadingMore(false);
    }
  };

  const prepend = (post: PostPublic) => {
    setPosts((prev) => [post, ...(prev ?? [])]);
    setCompose(false);
  };
  const updatePost = (next: PostPublic) =>
    setPosts((prev) => prev?.map((p) => (p.id === next.id ? next : p)) ?? null);
  const removePost = (id: string) => setPosts((prev) => prev?.filter((p) => p.id !== id) ?? null);

  return (
    <div>
      {/* Desktop: inline composer nad feedom. Mobil má FAB nižšie. */}
      <div className="hidden px-4 pt-4 md:block">
        <PostComposer onCreated={prepend} />
      </div>

      {error && <p className="px-4 py-3 text-sm text-red-600">{error}</p>}
      {!posts && !error && <p className="px-4 py-6 text-sm text-neutral-500">Načítavam feed…</p>}
      {posts?.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-neutral-500">
          Zatiaľ žiadne príspevky. Buď prvý!
        </p>
      )}

      <div className="divide-y divide-neutral-200 md:mt-4 md:border-t dark:divide-neutral-800 dark:md:border-neutral-800 md:border-neutral-200">
        {posts?.map((post) => (
          <PostCard key={post.id} post={post} onChange={updatePost} onDeleted={removePost} />
        ))}
      </div>

      {cursor && (
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {loadingMore ? 'Načítavam…' : 'Načítať staršie'}
          </button>
        </div>
      )}

      {/* FAB — nový príspevok (len mobil; nad bottom navom + safe area). */}
      <button
        type="button"
        onClick={() => setCompose(true)}
        aria-label="Nový príspevok"
        className="fixed right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-accent text-white shadow-lg transition active:scale-95 md:hidden"
        style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
      >
        <PencilIcon />
      </button>

      {compose && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setCompose(false)}>
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-4 dark:bg-neutral-900"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
            <PostComposer variant="sheet" autoFocus onCreated={prepend} />
          </div>
        </div>
      )}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
      aria-hidden
    >
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}
