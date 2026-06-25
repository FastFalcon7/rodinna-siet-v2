import { useEffect, useState } from 'react';
import type { PostPublic } from '@rodinna/shared-types';
import { ApiError, feedApi } from '../lib/api';
import { PostComposer } from './PostComposer';
import { PostCard } from './PostCard';

/** Feed (T4): nový príspevok, zoznam najnovších + "Načítať staršie" (cursor pagination). */
export function Feed() {
  const [posts, setPosts] = useState<PostPublic[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
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

  const updatePost = (next: PostPublic) =>
    setPosts((prev) => prev?.map((p) => (p.id === next.id ? next : p)) ?? null);
  const removePost = (id: string) => setPosts((prev) => prev?.filter((p) => p.id !== id) ?? null);

  return (
    <div className="space-y-4">
      <PostComposer onCreated={(post) => setPosts((prev) => [post, ...(prev ?? [])])} />

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!posts && !error && <p className="text-sm text-neutral-500">Načítavam feed…</p>}
      {posts?.length === 0 && (
        <p className="text-center text-sm text-neutral-500">Zatiaľ žiadne príspevky. Buď prvý!</p>
      )}

      {posts?.map((post) => (
        <PostCard key={post.id} post={post} onChange={updatePost} onDeleted={removePost} />
      ))}

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
        >
          {loadingMore ? 'Načítavam…' : 'Načítať staršie'}
        </button>
      )}
    </div>
  );
}
