import { eq } from 'drizzle-orm';
import type { LinkPreviewPublic } from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import { linkPreviews, type LinkPreviewRow } from '../../core/db/schema';
import { sha256Hex } from '../auth/crypto';
import { createImageMedia } from '../media/service';

/** Negatívna cache: zlyhaný fetch sa skúsi znova až po hodine. */
const RETRY_FAILED_AFTER_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'RodinnaSiet/1.0 (link-preview bot)';

/**
 * SSRF guard (§9): len http/https na štandardných portoch, žiadne IP literály
 * (privátne rozsahy, loopback, IPv6), žiadne lokálne doménové prípony.
 * Pozn.: DNS rebinding týmto nepokryjeme — pre rodinnú appku s 10 užívateľmi
 * a rate limitom je to akceptované reziduálne riziko.
 */
export function isUrlAllowed(u: URL): boolean {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.port !== '' && u.port !== '80' && u.port !== '443') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literál
  if (host.startsWith('[') || host.includes(':')) return false; // IPv6 literál
  if (/\.(local|localdomain|internal|lan|home|corp)$/.test(host)) return false;
  if (!host.includes('.')) return false; // holé hostname (intranet)
  return true;
}

/** Fetch s manuálnym sledovaním redirectov — každý hop prechádza SSRF guardom. */
async function guardedFetch(url: URL, accept: string): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isUrlAllowed(current)) return null;
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT, accept },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current);
      continue;
    }
    return res.ok ? res : null;
  }
  return null;
}

/** Načíta body streamu s tvrdým limitom bajtov (ochrana pamäte NAS). */
async function readLimited(res: Response, maxBytes: number): Promise<Buffer | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      // HTML stačí orezané (meta tagy sú v <head>); pri obrázku je oríznutie fatálne.
      return res.headers.get('content-type')?.includes('text/html')
        ? Buffer.concat([...chunks, value])
        : null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Vytiahne obsah meta tagu (og:* / name=) — atribúty v ľubovoľnom poradí. */
function metaContent(html: string, key: string): string | null {
  const tag = new RegExp(
    `<meta\\s[^>]*(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
    'i',
  ).exec(html)?.[0];
  if (!tag) return null;
  const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
  return content ? decodeEntities(content).trim() || null : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

interface ParsedOg {
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
}

export function parseOg(html: string): ParsedOg {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return {
    title: metaContent(html, 'og:title') ?? (titleTag ? decodeEntities(titleTag).trim() || null : null),
    description: metaContent(html, 'og:description') ?? metaContent(html, 'description'),
    siteName: metaContent(html, 'og:site_name'),
    imageUrl: metaContent(html, 'og:image') ?? metaContent(html, 'og:image:url'),
  };
}

function toPublic(row: LinkPreviewRow): LinkPreviewPublic {
  return {
    url: row.url,
    ok: row.ok,
    title: row.title,
    description: row.description,
    siteName: row.siteName,
    imageUrl: row.imageMediaId ? `/api/media/${row.imageMediaId}` : null,
  };
}

/**
 * Vráti preview z cache; pri prvom dopyte (alebo po vypršaní negatívnej cache)
 * URL stiahne, sparsuje OG metadáta a og:image uloží zmenšený do media
 * (vlastník = užívateľ, ktorý preview vyžiadal ako prvý). CSP povoľuje len
 * `img-src 'self'`, preto sa obrázok nikdy nehotlinkuje.
 */
export async function getOrFetchPreview(url: URL, requesterId: string): Promise<LinkPreviewPublic> {
  const normalized = url.toString();
  const urlHash = sha256Hex(normalized);

  const cached = await db
    .select()
    .from(linkPreviews)
    .where(eq(linkPreviews.urlHash, urlHash))
    .limit(1)
    .then((r) => r[0]);

  if (cached && (cached.ok || Date.now() - cached.fetchedAt.getTime() < RETRY_FAILED_AFTER_MS)) {
    return toPublic(cached);
  }

  const fetched = await fetchPreview(url, requesterId);

  const values = {
    urlHash,
    url: normalized,
    ok: fetched.ok,
    title: fetched.og?.title ?? null,
    description: fetched.og?.description?.slice(0, 500) ?? null,
    siteName: fetched.og?.siteName ?? null,
    imageMediaId: fetched.imageMediaId,
    fetchedAt: new Date(),
  };

  // Súbežný dopyt na tú istú URL mohol riadok medzitým vložiť → upsert.
  const rows = await db
    .insert(linkPreviews)
    .values(values)
    .onConflictDoUpdate({ target: linkPreviews.urlHash, set: values })
    .returning();
  return toPublic(rows[0]!);
}

async function fetchPreview(
  url: URL,
  requesterId: string,
): Promise<{ ok: boolean; og: ParsedOg | null; imageMediaId: string | null }> {
  try {
    const res = await guardedFetch(url, 'text/html,application/xhtml+xml');
    if (!res || !res.headers.get('content-type')?.includes('text/html')) {
      return { ok: false, og: null, imageMediaId: null };
    }
    const body = await readLimited(res, MAX_HTML_BYTES);
    if (!body) return { ok: false, og: null, imageMediaId: null };

    const og = parseOg(body.toString('utf-8'));
    if (!og.title && !og.description && !og.imageUrl) {
      return { ok: false, og: null, imageMediaId: null };
    }

    let imageMediaId: string | null = null;
    if (og.imageUrl) {
      try {
        const imgUrl = new URL(og.imageUrl, res.url || url);
        const imgRes = await guardedFetch(imgUrl, 'image/*');
        const imgBytes = imgRes ? await readLimited(imgRes, MAX_IMAGE_BYTES) : null;
        if (imgBytes) {
          const row = await createImageMedia(requesterId, imgBytes, { maxDim: 1024, quality: 75 });
          imageMediaId = row.id;
        }
      } catch {
        // preview bez obrázka je stále užitočné
      }
    }
    return { ok: true, og, imageMediaId };
  } catch {
    return { ok: false, og: null, imageMediaId: null };
  }
}
