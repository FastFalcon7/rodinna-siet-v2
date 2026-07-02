import { useEffect, useState } from 'react';
import type { UserPublic } from '@rodinna/shared-types';
import { chatApi, usersApi, ApiError } from '../lib/api';
import { Avatar } from '../shared/Avatar';
import { useChat } from './ChatProvider';

interface NewChatDialogProps {
  meId: string;
  onClose: () => void;
  onCreated: (roomId: string) => void;
}

export function NewChatDialog({ meId, onClose, onCreated }: NewChatDialogProps) {
  const { upsertRoom } = useChat();
  const [mode, setMode] = useState<'dm' | 'group'>('dm');
  const [members, setMembers] = useState<UserPublic[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    usersApi
      .list()
      .then((r) => setMembers(r.users.filter((u) => u.id !== meId)))
      .catch(() => setError('Nepodarilo sa načítať členov'));
  }, [meId]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async (memberIds: string[]) => {
    if (busy || memberIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const room =
        mode === 'dm'
          ? await chatApi.createRoom({ kind: 'dm', memberIds: [memberIds[0]!] })
          : await chatApi.createRoom({ kind: 'group', memberIds, title: title.trim() });
      upsertRoom(room);
      onCreated(room.id);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Vytvorenie zlyhalo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Nová konverzácia</h3>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            ✕
          </button>
        </div>

        <div className="mb-3 flex gap-1 rounded-xl border border-neutral-200 p-1 dark:border-neutral-800">
          {(['dm', 'group'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setSelected(new Set());
              }}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                mode === m ? 'bg-accent text-white' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              {m === 'dm' ? 'Priama správa' : 'Skupina'}
            </button>
          ))}
        </div>

        {mode === 'group' && (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Názov skupiny"
            maxLength={80}
            className="mb-3 w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-accent dark:border-neutral-700 dark:bg-neutral-800"
          />
        )}

        {error && <p className="mb-2 text-sm text-red-500">{error}</p>}

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {members.length === 0 && <p className="py-4 text-center text-sm text-neutral-400">Žiadni ďalší členovia</p>}
          {members.map((u) => {
            const sel = selected.has(u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => (mode === 'dm' ? create([u.id]) : toggle(u.id))}
                className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition ${
                  sel ? 'bg-accent/10' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                <Avatar user={u} size={40} />
                <span className="flex-1 truncate font-medium">{u.displayName}</span>
                {mode === 'group' && (
                  <span
                    className={`grid h-5 w-5 place-items-center rounded-full border text-xs ${
                      sel ? 'border-accent bg-accent text-white' : 'border-neutral-300 dark:border-neutral-600'
                    }`}
                  >
                    {sel ? '✓' : ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {mode === 'group' && (
          <button
            type="button"
            disabled={busy || selected.size === 0 || title.trim().length === 0}
            onClick={() => create([...selected])}
            className="mt-3 w-full rounded-xl bg-accent py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          >
            Vytvoriť skupinu ({selected.size})
          </button>
        )}
      </div>
    </div>
  );
}
