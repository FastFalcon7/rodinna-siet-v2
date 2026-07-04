import { useEffect, useState } from 'react';
import type { LinkPreviewPublic } from '@rodinna/shared-types';
import { linkPreviewApi } from '../lib/api';

/** In-memory dedup — jedna URL sa v rámci session dopytuje len raz. */
const cache = new Map<string, Promise<LinkPreviewPublic>>();

function load(url: string): Promise<LinkPreviewPublic> {
  let p = cache.get(url);
  if (!p) {
    p = linkPreviewApi.get(url);
    p.catch(() => cache.delete(url)); // chybu necachuj — ďalší render skúsi znova
    cache.set(url, p);
  }
  return p;
}

/**
 * OG karta linku (§3.3): obrázok + titulok + popis + doména. Načítava sa
 * lazy pri renderi; kým nie je hotová (alebo fetch zlyhal), nerenderuje nič —
 * text s linkom je viditeľný vždy.
 */
export function LinkPreviewCard({ url, compact = false }: { url: string; compact?: boolean }) {
  const [data, setData] = useState<LinkPreviewPublic | null>(null);

  useEffect(() => {
    let alive = true;
    load(url)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [url]);

  if (!data?.ok || (!data.title && !data.imageUrl)) return null;

  let domain = '';
  try {
    domain = new URL(data.url).hostname.replace(/^www\./, '');
  } catch {
    /* nechaj prázdne */
  }

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="block overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
    >
      {data.imageUrl && !compact && (
        <img src={data.imageUrl} alt="" loading="lazy" className="max-h-64 w-full object-cover" />
      )}
      <div className="flex items-center gap-2.5 px-3 py-2">
        {data.imageUrl && compact && (
          <img
            src={data.imageUrl}
            alt=""
            loading="lazy"
            className="h-12 w-12 shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0">
          {data.title && (
            <div className="line-clamp-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {data.title}
            </div>
          )}
          {data.description && !compact && (
            <div className="line-clamp-2 text-xs text-neutral-500">{data.description}</div>
          )}
          <div className="mt-0.5 truncate text-xs text-neutral-400">
            {data.siteName ?? domain}
          </div>
        </div>
      </div>
    </a>
  );
}
