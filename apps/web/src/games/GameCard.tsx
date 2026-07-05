import { useEffect, useRef, useState } from 'react';
import type { GamePublic } from '@rodinna/shared-types';
import { ApiError, gamesApi, mediaApi } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useChat } from '../chat/ChatProvider';
import type { EntityCardProps } from '../app/cards';

/**
 * Živá karta hry (M6): piškvorky v chate (join, ťahy real-time, odveta),
 * denná rodinná otázka a foto výzva vo Feede. Stav live cez WS game:update.
 */
export function GameCard({ entityId, compact }: EntityCardProps) {
  const { user } = useAuth();
  const { subscribe } = useChat();
  const [game, setGame] = useState<GamePublic | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      gamesApi
        .get(entityId)
        .then((g) => alive && setGame(g))
        .catch(() => alive && setGone(true));
    void load();
    const off = subscribe((e) => {
      if (e.t === 'game:update' && e.gameId === entityId) void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [entityId, subscribe]);

  if (gone) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700">
        Hra už neexistuje.
      </div>
    );
  }
  if (!game || !user) {
    return <div className="h-28 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;
  }

  const act = async (fn: () => Promise<GamePublic>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setGame(await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nepodarilo sa');
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div
      className={`rounded-xl border border-black/10 bg-white text-left shadow-sm dark:border-white/10 dark:bg-neutral-900 ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );

  // ── Piškvorky ──────────────────────────────────────────────────────────────
  if (game.kind === 'tictactoe' && game.board && game.players) {
    const meId = user.id;
    const myMark = game.players.x.id === meId ? 'x' : game.players.o?.id === meId ? 'o' : null;
    const myTurn = game.status === 'active' && myMark !== null && game.turn === myMark;
    const canJoin = game.status === 'open' && game.players.x.id !== meId;

    const statusText =
      game.status === 'open'
        ? canJoin
          ? 'Výzva čaká — prijmeš?'
          : 'Čaká sa na súpera…'
        : game.status === 'active'
          ? myTurn
            ? 'Si na ťahu!'
            : `Na ťahu: ${game.turn === 'x' ? game.players.x.displayName : game.players.o?.displayName}`
          : game.winner === 'draw'
            ? 'Remíza 🤝'
            : `🏆 Vyhral/a ${game.winner === 'x' ? game.players.x.displayName : game.players.o?.displayName}`;

    return shell(
      <>
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          ⭕ Piškvorky · {game.players.x.displayName.split(' ')[0]} (✕)
          {game.players.o ? ` vs ${game.players.o.displayName.split(' ')[0]} (◯)` : ''}
        </p>
        <div className="mx-auto mt-2 grid w-fit grid-cols-3 gap-1">
          {game.board.map((cell, i) => (
            <button
              key={i}
              onClick={() => myTurn && cell === null && void act(() => gamesApi.move(game.id, i))}
              disabled={busy || !myTurn || cell !== null}
              aria-label={`Políčko ${i + 1}`}
              className={`grid h-11 w-11 place-items-center rounded-lg border text-xl font-bold transition ${
                cell === null && myTurn
                  ? 'border-accent/40 hover:bg-accent/10'
                  : 'border-neutral-200 dark:border-neutral-700'
              } ${cell === 'x' ? 'text-accent' : 'text-neutral-600 dark:text-neutral-300'}`}
            >
              {cell === 'x' ? '✕' : cell === 'o' ? '◯' : ''}
            </button>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-neutral-500">{statusText}</p>
        <div className="mt-1.5 flex justify-center gap-2">
          {canJoin && (
            <button
              onClick={() => void act(() => gamesApi.join(game.id))}
              disabled={busy}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Prijať výzvu
            </button>
          )}
          {game.status === 'finished' && myMark && !game.rematchId && (
            <button
              onClick={() => void act(() => gamesApi.rematch(game.id))}
              disabled={busy}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              🔄 Odveta
            </button>
          )}
          {game.rematchId && <p className="text-xs text-neutral-400">Odveta už beží ↓</p>}
        </div>
      </>,
    );
  }

  // ── Denná otázka / foto výzva ──────────────────────────────────────────────
  return shell(
    <QuestCard game={game} busy={busy} act={act} />,
  );
}

function QuestCard({
  game,
  busy,
  act,
}: {
  game: GamePublic;
  busy: boolean;
  act: (fn: () => Promise<GamePublic>) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isPhoto = game.kind === 'photo';

  const submitPhoto = async (file: File) => {
    setUploading(true);
    try {
      const m = await mediaApi.upload(file);
      await act(() => gamesApi.answer(game.id, { text: '', mediaId: m.id }));
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {isPhoto ? '📸 Foto výzva týždňa' : '💬 Otázka dňa'}
      </p>
      <p className="mt-0.5 text-sm text-neutral-700 dark:text-neutral-200">{game.question}</p>

      {!game.myAnswered && game.status !== 'finished' && (
        <div className="mt-2">
          {isPhoto ? (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy || uploading}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {uploading ? 'Nahrávam…' : '📷 Pridať fotku'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void submitPhoto(f);
                }}
              />
            </>
          ) : (
            <div className="flex gap-1.5">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && text.trim() && void act(() => gamesApi.answer(game.id, { text: text.trim() }))
                }
                maxLength={500}
                placeholder="Tvoja odpoveď…"
                className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm text-neutral-800 outline-none focus:border-accent dark:border-neutral-700 dark:text-neutral-100"
              />
              <button
                onClick={() => void act(() => gamesApi.answer(game.id, { text: text.trim() }))}
                disabled={busy || !text.trim()}
                className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Odpovedať
              </button>
            </div>
          )}
          {!isPhoto && (game.answersCount ?? 0) > 0 && (
            <p className="mt-1 text-xs text-neutral-400">
              {game.answersCount} už odpovedali — odpovede uvidíš po svojej 😉
            </p>
          )}
        </div>
      )}

      {(game.answers?.length ?? 0) > 0 && (
        isPhoto ? (
          <div className="mt-2 grid grid-cols-3 gap-1 overflow-hidden rounded-lg">
            {game.answers!.map((a, i) =>
              a.media ? (
                <figure key={i} className="relative">
                  <img src={a.media.url} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                  <figcaption className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 text-[10px] text-white">
                    {a.author.displayName.split(' ')[0]}
                  </figcaption>
                </figure>
              ) : null,
            )}
          </div>
        ) : (
          <ul className="mt-2 space-y-1">
            {game.answers!.map((a, i) => (
              <li key={i} className="rounded-lg bg-neutral-50 px-2.5 py-1.5 text-sm dark:bg-neutral-800">
                <span className="font-medium">{a.author.displayName.split(' ')[0]}:</span>{' '}
                <span className="text-neutral-700 dark:text-neutral-200">{a.text}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </>
  );
}
