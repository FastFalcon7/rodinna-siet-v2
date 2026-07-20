import { useState } from 'react';
import { ApiError, chatApi, feedApi } from '../lib/api';
import { useChat } from '../chat/ChatProvider';
import { useAuth } from '../auth/AuthContext';
import { roomLabel } from './VisibilityPicker';

/**
 * Preposlanie vybraných fotiek (ladenie 07/2026): „Do Feedu" = nový príspevok
 * s voliteľným textom, „Do chatu" = výber miestnosti a odoslanie ako správa.
 * Rovnaký vzor ako AlbumPicker/NotePicker/EventPicker dialógy.
 */

export function FeedShareDialog({ mediaIds, onClose }: { mediaIds: string[]; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await feedApi.createPost({ bodyMd: text.trim(), mediaIds });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Príspevok sa nepodarilo uverejniť');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <h3 className="font-semibold">
          Do Feedu ({mediaIds.length} {mediaIds.length === 1 ? 'fotka' : mediaIds.length < 5 ? 'fotky' : 'fotiek'})
        </h3>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={4000}
          autoFocus
          placeholder="Text k príspevku (voliteľné)"
          className="w-full resize-none rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-neutral-500">
            Zrušiť
          </button>
          <button
            onClick={() => void publish()}
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? 'Uverejňujem…' : 'Uverejniť'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatShareDialog({ mediaIds, onClose }: { mediaIds: string[]; onClose: () => void }) {
  const { rooms } = useChat();
  const { user } = useAuth();
  const meId = user?.id ?? '';
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (roomId: string) => {
    if (busy) return;
    setBusy(roomId);
    setError(null);
    try {
      await chatApi.sendMessage(roomId, { bodyMd: '', mediaIds });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Fotky sa nepodarilo poslať');
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <h3 className="mb-2 font-semibold">
          Poslať do chatu ({mediaIds.length} {mediaIds.length === 1 ? 'fotka' : mediaIds.length < 5 ? 'fotky' : 'fotiek'})
        </h3>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {rooms.length === 0 && <li className="px-2 py-3 text-sm text-neutral-500">Žiadne konverzácie.</li>}
          {rooms.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => void send(r.id)}
                disabled={busy !== null}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
              >
                <span>{r.kind === 'dm' ? '💬' : '👥'}</span>
                <span className="min-w-0 truncate">{roomLabel(r, meId)}</span>
                {busy === r.id && <span className="ml-auto text-xs text-neutral-400">Posielam…</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-end">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-neutral-500">
            Zrušiť
          </button>
        </div>
      </div>
    </div>
  );
}
