/** Relatívny čas pre feed (Bluesky štýl): teraz / 5 m / 3 h / 2 d / dátum. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffS = Math.max(0, (Date.now() - then) / 1000);
  if (diffS < 60) return 'teraz';
  if (diffS < 3600) return `${Math.floor(diffS / 60)} m`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)} h`;
  if (diffS < 7 * 86400) return `${Math.floor(diffS / 86400)} d`;
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('sk-SK', {
    day: 'numeric',
    month: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Plný dátum a čas — do `title` tooltipov pri relatívnom čase. */
export function fullDateTime(iso: string): string {
  return new Date(iso).toLocaleString('sk-SK', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
