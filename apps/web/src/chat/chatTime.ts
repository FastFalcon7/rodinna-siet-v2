/** Formátovanie času/dátumu pre chat (slovenské, ľahké, bez závislostí). */

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function sameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/** "14:05" */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
}

/** Oddeľovač dní v konverzácii: Dnes / Včera / 25. 6. 2026. */
export function formatDayLabel(iso: string): string {
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(iso));
  if (day === today) return 'Dnes';
  if (day === today - DAY_MS) return 'Včera';
  return new Date(iso).toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

/** Čas v zozname miestností: dnes → 14:05, včera → Včera, inak 25. 6. */
export function formatRoomTime(iso: string): string {
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(iso));
  if (day === today) return formatTime(iso);
  if (day === today - DAY_MS) return 'Včera';
  return new Date(iso).toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' });
}

/** "naposledy aktívny dnes o 14:05" / "… 25. 6." */
export function formatLastSeen(iso: string | null): string {
  if (!iso) return 'offline';
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(iso));
  if (day === today) return `naposledy dnes o ${formatTime(iso)}`;
  if (day === today - DAY_MS) return `naposledy včera o ${formatTime(iso)}`;
  return `naposledy ${new Date(iso).toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' })}`;
}
