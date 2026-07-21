import { useEffect, useRef, useState } from 'react';
import type { ChatRoomPublic, UserPublic } from '@rodinna/shared-types';
import { ApiError, chatApi, mediaApi, usersApi } from '../lib/api';
import { Avatar } from '../shared/Avatar';
import { useAuth } from '../auth/AuthContext';
import { useChat } from './ChatProvider';

/**
 * Správa skupiny (ladenie 07/2026): premenovanie, avatar, členovia, zmazanie /
 * odchod. Rodinnú miestnosť smie premenovať/prefotiť len admin; členov nemení
 * (sú v nej všetci). Vlastnú skupinu spravuje jej zakladateľ alebo admin.
 */
export function RoomSettings({ room, onClose }: { room: ChatRoomPublic; onClose: () => void }) {
  const { user } = useAuth();
  const { upsertRoom } = useChat();
  const meId = user?.id ?? '';
  const iAmOwner = room.members.find((m) => m.id === meId)?.role === 'owner';
  const canManage = iAmOwner || user?.role === 'admin';

  const [title, setTitle] = useState(room.title ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(room.avatarUrl);
  const [members, setMembers] = useState(room.members);
  const [allUsers, setAllUsers] = useState<UserPublic[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usersApi.list().then((r) => setAllUsers(r.users)).catch(() => {});
  }, []);

  const dirty = title.trim() !== (room.title ?? '') || avatarUrl !== room.avatarUrl;

  const saveMeta = async () => {
    if (!canManage || busy || !dirty || title.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await chatApi.updateRoom(room.id, { title: title.trim(), avatarUrl });
      upsertRoom(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uloženie zlyhalo');
      setBusy(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const m = await mediaApi.upload(file);
      setAvatarUrl(m.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nahranie zlyhalo');
    } finally {
      setBusy(false);
    }
  };

  const addMember = async (id: string) => {
    setBusy(true);
    try {
      const updated = await chatApi.addRoomMembers(room.id, [id]);
      upsertRoom(updated);
      setMembers(updated.members);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pridanie zlyhalo');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (id: string) => {
    if (!confirm(id === meId ? 'Odísť zo skupiny?' : 'Odobrať člena zo skupiny?')) return;
    setBusy(true);
    try {
      await chatApi.removeRoomMember(room.id, id);
      if (id === meId) {
        onClose(); // odišiel som — WS room:remove zavrie konverzáciu
        return;
      }
      setMembers((cur) => cur.filter((m) => m.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Odobratie zlyhalo');
    } finally {
      setBusy(false);
    }
  };

  const deleteRoom = async () => {
    if (!confirm('Zmazať celú skupinu? Zmažú sa aj všetky správy.')) return;
    setBusy(true);
    try {
      await chatApi.deleteRoom(room.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Zmazanie zlyhalo');
      setBusy(false);
    }
  };

  const isFamily = room.kind === 'family';
  const notMembers = allUsers.filter((u) => !members.some((m) => m.id === u.id));

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 md:rounded-2xl dark:bg-neutral-900"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-neutral-300 md:hidden dark:bg-neutral-700" />
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{isFamily ? 'Rodinná miestnosť' : 'Nastavenia skupiny'}</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            ✕
          </button>
        </div>

        {/* Avatar + názov */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => canManage && fileRef.current?.click()}
            disabled={!canManage || busy}
            className="relative shrink-0"
            title={canManage ? 'Zmeniť fotku skupiny' : undefined}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="grid h-16 w-16 place-items-center rounded-full bg-accent-teal/20 text-2xl">
                {isFamily ? '🏡' : '👥'}
              </div>
            )}
            {canManage && (
              <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-accent text-xs text-white">
                📷
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void uploadAvatar(f);
            }}
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!canManage}
            maxLength={80}
            placeholder="Názov skupiny"
            className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60 dark:border-neutral-700"
          />
        </div>

        {avatarUrl && canManage && (
          <button onClick={() => setAvatarUrl(null)} className="text-xs text-neutral-500 underline underline-offset-2">
            Odstrániť fotku skupiny
          </button>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {canManage && dirty && (
          <button
            onClick={() => void saveMeta()}
            disabled={busy || title.trim().length === 0}
            className="w-full rounded-xl bg-accent py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? 'Ukladám…' : 'Uložiť zmeny'}
          </button>
        )}

        {/* Členovia */}
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-500">Členovia ({members.length})</p>
          <ul className="space-y-0.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                <Avatar user={m} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {m.displayName}
                  {m.id === meId && ' (ja)'}
                  {m.role === 'owner' && <span className="ml-1 text-xs text-neutral-400">· zakladateľ</span>}
                </span>
                {/* Odobrať: nie z rodiny; člena kick owner/admin, seba každý (odchod). */}
                {!isFamily && (m.id === meId || (canManage && m.role !== 'owner')) && (
                  <button
                    onClick={() => void removeMember(m.id)}
                    disabled={busy}
                    className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    {m.id === meId ? 'Odísť' : 'Odobrať'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Pridať člena (owner/admin, len skupina) */}
        {canManage && !isFamily && (
          <div>
            {adding ? (
              <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-neutral-200 p-1 dark:border-neutral-700">
                {notMembers.length === 0 && <li className="px-2 py-2 text-sm text-neutral-500">Všetci sú už v skupine.</li>}
                {notMembers.map((u) => (
                  <li key={u.id}>
                    <button
                      onClick={() => void addMember(u.id)}
                      disabled={busy}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <Avatar user={u} size={28} />
                      <span className="truncate">{u.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <button onClick={() => setAdding(true)} className="text-sm text-accent underline underline-offset-2">
                + Pridať člena
              </button>
            )}
          </div>
        )}

        {/* Zmazať skupinu (owner/admin) */}
        {canManage && !isFamily && (
          <button
            onClick={() => void deleteRoom()}
            disabled={busy}
            className="w-full rounded-xl border border-red-300 py-2 text-sm font-medium text-red-600 disabled:opacity-40 dark:border-red-900"
          >
            Zmazať skupinu
          </button>
        )}
      </div>
    </div>
  );
}
