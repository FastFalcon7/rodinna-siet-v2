/**
 * Jednoduchý in-memory rate limiter (§9: login 5/min/IP).
 * Pre 10 užívateľov netreba Redis. Sliding window cez timestampy.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false; // limit prekročený
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

// Periodické čistenie starých záznamov.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, hits] of buckets) {
      const fresh = hits.filter((t) => now - t < 60_000);
      if (fresh.length === 0) buckets.delete(key);
      else buckets.set(key, fresh);
    }
  },
  5 * 60 * 1000,
).unref?.();
