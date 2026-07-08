import { useEffect, useState } from 'react';
import type { PollPublic } from '@rodinna/shared-types';
import { pollsApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useChat } from '../chat/ChatProvider';
import type { EntityCardProps } from '../app/cards';

/**
 * Živá karta ankety (M1, kontrakty K1/K2): renderuje sa vo Feede aj v chat
 * bubline (`app://polls/<id>`), hlasuje sa priamo v karte a stav sa mení
 * real-time — WS event `poll:update` spustí refetch (viewer-specific dáta).
 */

/** „Končí o 2 h" / „Končí o 35 min" — hrubé, stačí na orientáciu. */
function closesIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'ukončená';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `končí o ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `končí o ${h} h`;
  return `končí o ${Math.round(h / 24)} d`;
}

function votersLabel(voters: PollPublic['options'][number]['voters']): string {
  if (voters.length === 0) return '';
  const names = voters.map((v) => v.displayName.split(' ')[0]);
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
}

export function PollCard({ entityId, compact }: EntityCardProps) {
  const { user } = useAuth();
  const { subscribe } = useChat();
  const [poll, setPoll] = useState<PollPublic | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      pollsApi
        .get(entityId)
        .then((p) => alive && setPoll(p))
        .catch(() => alive && setError(true));
    void load();
    // Live update: hlas/uzavretie kdekoľvek → refetch tejto karty.
    const off = subscribe((e) => {
      if (e.t === 'poll:update' && e.pollId === entityId) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [entityId, subscribe]);

  if (error) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700">
        Anketu sa nepodarilo načítať.
      </div>
    );
  }
  if (!poll) {
    return (
      <div className="animate-pulse rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-neutral-900">
        <div className="h-4 w-2/3 rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="mt-3 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-800" />
        <div className="mt-1.5 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-800" />
      </div>
    );
  }

  const meId = user?.id ?? '';
  const maxVotes = Math.max(...poll.options.map((o) => o.votes), 0);

  const toggle = async (optionId: string) => {
    if (busy || poll.closed) return;
    const mine = new Set(poll.options.filter((o) => o.votedByMe).map((o) => o.id));
    let next: string[];
    if (poll.kind === 'single') {
      next = mine.has(optionId) ? [] : [optionId];
    } else {
      if (mine.has(optionId)) mine.delete(optionId);
      else mine.add(optionId);
      next = [...mine];
    }
    setBusy(true);
    try {
      setPoll(await pollsApi.vote(poll.id, next));
    } catch {
      /* poll:update refetch to zosynchronizuje */
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!confirm('Ukončiť anketu? Hlasovanie sa zastaví.')) return;
    setBusy(true);
    try {
      setPoll(await pollsApi.close(poll.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-xl border border-black/10 bg-white text-left shadow-sm dark:border-white/10 dark:bg-neutral-900 ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          📊 {poll.question}
        </p>
        {!poll.closed && poll.author.id === meId && (
          <button
            onClick={close}
            disabled={busy}
            className="shrink-0 text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-600"
          >
            Ukončiť
          </button>
        )}
      </div>

      <ul className={`mt-2 ${compact ? 'space-y-1' : 'space-y-1.5'}`}>
        {poll.options.map((o) => {
          const pct = poll.totalVoters > 0 ? Math.round((o.votes / poll.totalVoters) * 100) : 0;
          const winner = poll.closed && o.votes > 0 && o.votes === maxVotes;
          return (
            <li key={o.id}>
              <button
                onClick={() => void toggle(o.id)}
                disabled={busy || poll.closed}
                // Explicitná farba textu — v coral bubline by inak dedil bielu.
                className={`relative block w-full overflow-hidden rounded-lg border px-2.5 py-1.5 text-left text-sm text-neutral-800 transition dark:text-neutral-100 ${
                  o.votedByMe
                    ? 'border-accent/60'
                    : 'border-neutral-200 dark:border-neutral-700'
                } ${poll.closed ? 'cursor-default' : 'hover:border-accent/60'}`}
              >
                {/* Progress výplň pod textom */}
                <span
                  className={`absolute inset-y-0 left-0 ${o.votedByMe || winner ? 'bg-accent/15' : 'bg-neutral-100 dark:bg-neutral-800'}`}
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
                <span className="relative flex items-center justify-between gap-2">
                  <span className={`min-w-0 truncate ${winner ? 'font-semibold' : ''}`}>
                    {winner && '🏆 '}
                    {o.votedByMe && '✓ '}
                    {o.label}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                    {o.votes > 0 && !poll.anonymous && (
                      <span className="mr-1.5 hidden sm:inline">{votersLabel(o.voters)} ·</span>
                    )}
                    {o.votes}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-1.5 text-xs text-neutral-400">
        {poll.totalVoters === 0
          ? 'Zatiaľ nikto nehlasoval'
          : `${poll.totalVoters} ${poll.totalVoters === 1 ? 'hlasujúci' : 'hlasujúci'}`}
        {poll.kind === 'multi' && ' · viac možností'}
        {poll.anonymous && ' · anonymná'}
        {poll.closed ? ' · ukončená' : poll.closesAt ? ` · ${closesIn(poll.closesAt)}` : ''}
      </p>
    </div>
  );
}
