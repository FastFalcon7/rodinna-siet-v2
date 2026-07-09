import { useState } from 'react';
import { ApiError, gamesApi } from '../lib/api';
import { GameCard } from './GameCard';

/**
 * Súkromná praktika piškvoriek proti počítaču (M6 doplnok) — mimo chatu,
 * `roomId: null`, vidí len autor (server to vynucuje aj v `requireAccess`).
 * Hranie proti človeku ostáva výlučne v chate (chat [+] → Piškvorky).
 */
export function Practice() {
  const [gameId, setGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startNew = async () => {
    setLoading(true);
    setError(null);
    try {
      const g = await gamesApi.createTictactoe(null);
      setGameId(g.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Hru sa nepodarilo založiť');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <h2 className="text-lg font-semibold">⭕ Piškvorky proti počítaču</h2>
        <p className="text-sm text-neutral-500">
          Súkromná praktika — nikto iný v rodine túto hru nevidí. Proti človeku sa hrá v chate (
          <span className="font-medium">+</span> → Piškvorky).
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!gameId ? (
        <button
          onClick={() => void startNew()}
          disabled={loading}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {loading ? 'Zakladám…' : 'Nová hra'}
        </button>
      ) : (
        <div className="space-y-2">
          <GameCard entityId={gameId} onRematch={setGameId} />
          <button
            onClick={() => void startNew()}
            disabled={loading}
            className="text-xs text-neutral-500 underline decoration-dotted hover:text-neutral-700 disabled:opacity-40 dark:hover:text-neutral-300"
          >
            {loading ? 'Zakladám…' : 'Začať úplne odznova'}
          </button>
        </div>
      )}
    </div>
  );
}
