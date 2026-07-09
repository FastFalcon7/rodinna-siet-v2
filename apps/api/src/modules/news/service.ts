import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { NEWS_CATEGORIES, type NewsCategory, type NewsItemPublic } from '@rodinna/shared-types';
import { db } from '../../core/db/client';
import { newsItems, userNewsPrefs, type NewsItemRow } from '../../core/db/schema';
import { env } from '../../config/env';

/**
 * Svet okolo (§15.3): RSS aggregator bez LLM — čisto sieťový fetch
 * kurátorovaných verejných feedov. Ukladá LEN titulok + snippet (1–2 vety)
 * + link + dátum (rovnaká prax ako FreshRSS). Beží vo worker jobe 2× denne;
 * fetchujú sa len kategórie, ktoré má niekto zapnuté (šetrí NAS aj zdroje).
 *
 * Firewall pozn.: jediná výstupná HTTPS komunikácia appky okrem push — na
 * NAS-e treba povoliť prístup k doménam nižšie (LLM_BASE_URL je interný).
 */

/** Kurátorované feedy per kategória — uprav podľa chuti rodiny. */
export const NEWS_FEEDS: Record<NewsCategory, string[]> = {
  spravy: ['https://www.aktuality.sk/rss/', 'https://dennikn.sk/feed/'],
  sport: ['https://sport.aktuality.sk/rss/'],
  technologie: ['https://zive.aktuality.sk/rss/', 'https://touchit.sk/feed/'],
  kultura: ['https://dennikn.sk/kultura/feed/'],
  veda: ['https://dennikn.sk/veda/feed/'],
};

const FETCH_TIMEOUT_MS = 10_000;
const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS_PER_FEED = 15;
const SNIPPET_LEN = 220;
const PRUNE_AFTER_DAYS = 7;

function toPublic(row: NewsItemRow): NewsItemPublic {
  return {
    id: row.id,
    category: row.category as NewsCategory,
    title: row.title,
    snippet: row.snippet,
    source: row.source,
    url: row.url,
    publishedAt: row.publishedAt.toISOString(),
  };
}

// ── Preferencie ──────────────────────────────────────────────────────────────

export async function getPrefs(userId: string): Promise<NewsCategory[]> {
  const rows = await db
    .select({ category: userNewsPrefs.category })
    .from(userNewsPrefs)
    .where(eq(userNewsPrefs.userId, userId));
  return rows.map((r) => r.category as NewsCategory);
}

export async function setPrefs(userId: string, categories: NewsCategory[]): Promise<NewsCategory[]> {
  const unique = [...new Set(categories)];
  await db.delete(userNewsPrefs).where(eq(userNewsPrefs.userId, userId));
  if (unique.length > 0) {
    await db.insert(userNewsPrefs).values(unique.map((category) => ({ userId, category })));
  }
  return unique;
}

// ── Čítanie ──────────────────────────────────────────────────────────────────

/** Dnešné titulky pre dané kategórie (max `limit`, najnovšie prvé). */
export async function todaysItems(categories: NewsCategory[], limit = 10): Promise<NewsItemPublic[]> {
  if (categories.length === 0) return [];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(newsItems)
    .where(and(inArray(newsItems.category, categories), gte(newsItems.publishedAt, since)))
    .orderBy(desc(newsItems.publishedAt))
    .limit(limit);
  return rows.map(toPublic);
}

// ── RSS parser (bez závislostí — RSS 2.0 aj Atom v miere, akú feedy vyžadujú) ─

/** Nedeliteľná medzera (aj &#160;/&#xA0;) sa normalizuje na bežnú medzeru. */
const NBSP_CODEPOINTS = new Set([160]);

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    // Všeobecné numerické entity (&#160; aj &#xA0;/&#XA0;) — feedy z aktuality.sk/
    // dennikn.sk kódujú nedeliteľnú medzeru takto namiesto &nbsp;.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return NBSP_CODEPOINTS.has(code) ? ' ' : String.fromCodePoint(code);
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = parseInt(dec, 10);
      return NBSP_CODEPOINTS.has(code) ? ' ' : String.fromCodePoint(code);
    });
}

function stripTags(s: string): string {
  return decodeEntities(
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    // Tagy nahradené medzerou nechajú „slovo ." — prilep interpunkciu späť.
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1]!.trim() : null;
}

export interface ParsedItem {
  title: string;
  url: string;
  snippet: string;
  publishedAt: Date;
}

export function parseRss(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks.slice(0, MAX_ITEMS_PER_FEED)) {
    const title = stripTags(tag(block, 'title') ?? '');
    // Atom: <link href="…"/>; RSS: <link>…</link>.
    const linkRaw =
      tag(block, 'link') || /<link[^>]*href="([^"]+)"/i.exec(block)?.[1] || tag(block, 'guid') || '';
    const url = stripTags(linkRaw);
    const desc = stripTags(tag(block, 'description') ?? tag(block, 'summary') ?? '');
    const dateRaw = tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated');
    const publishedAt = dateRaw ? new Date(stripTags(dateRaw)) : new Date();
    if (!title || !url.startsWith('http') || Number.isNaN(publishedAt.getTime())) continue;
    items.push({
      title: title.slice(0, 300),
      url: url.slice(0, 1000),
      snippet: desc.length > SNIPPET_LEN ? `${desc.slice(0, SNIPPET_LEN)}…` : desc,
      publishedAt,
    });
  }
  return items;
}

// ── Fetch job ────────────────────────────────────────────────────────────────

async function fetchFeed(url: string): Promise<ParsedItem[]> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'RodinnaSiet/1.0 (rss reader)', accept: 'application/rss+xml, application/xml, text/xml' },
  });
  if (!res.ok) throw new Error(`RSS ${url}: ${res.status}`);
  const xml = (await res.text()).slice(0, MAX_XML_BYTES);
  return parseRss(xml);
}

/** Kategórie, ktoré má aspoň jeden člen zapnuté. */
async function subscribedCategories(): Promise<NewsCategory[]> {
  const rows = await db.selectDistinct({ category: userNewsPrefs.category }).from(userNewsPrefs);
  return rows
    .map((r) => r.category as NewsCategory)
    .filter((c) => (NEWS_CATEGORIES as readonly string[]).includes(c));
}

/**
 * Worker job 'news.fetch' (2× denne): stiahni feedy odoberaných kategórií,
 * ulož nové položky (dedupe cez unique url), premaž staršie ako 7 dní.
 * Jeden mŕtvy feed nezhodí beh — chyby sa len logujú.
 */
export async function fetchNews(
  feeds: Record<NewsCategory, string[]> = NEWS_FEEDS,
): Promise<{ fetched: number; stored: number }> {
  const categories = await subscribedCategories();
  const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  let fetched = 0;
  let stored = 0;

  for (const category of categories) {
    for (const feedUrl of feeds[category] ?? []) {
      try {
        const items = await fetchFeed(feedUrl);
        fetched += items.length;
        const source = new URL(feedUrl).hostname.replace(/^www\./, '');
        for (const it of items) {
          // Staršie ako retencia rovno preskoč (inak by sa po prune vracali).
          if (it.publishedAt < cutoff) continue;
          const inserted = await db
            .insert(newsItems)
            .values({
              category,
              title: it.title,
              snippet: it.snippet,
              source,
              url: it.url,
              publishedAt: it.publishedAt,
            })
            .onConflictDoNothing()
            .returning({ id: newsItems.id });
          if (inserted[0]) stored++;
        }
      } catch (err) {
        console.error(`news.fetch ${feedUrl} zlyhal:`, err instanceof Error ? err.message : err);
      }
    }
  }

  await db
    .delete(newsItems)
    .where(lt(newsItems.publishedAt, new Date(Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000)));
  return { fetched, stored };
}

/** Titulky do denníkového promptu (volá diary.generateEntry). */
export async function headlinesForUser(userId: string, limit = 8): Promise<NewsItemPublic[]> {
  return todaysItems(await getPrefs(userId), limit);
}

/** Feedy sa dajú v testoch podvrhnúť cez env (mock server). */
export function feedsFromEnv(): Record<NewsCategory, string[]> {
  if (!env.NEWS_FEEDS_JSON) return NEWS_FEEDS;
  try {
    return { ...NEWS_FEEDS, ...(JSON.parse(env.NEWS_FEEDS_JSON) as Partial<Record<NewsCategory, string[]>>) };
  } catch {
    return NEWS_FEEDS;
  }
}
