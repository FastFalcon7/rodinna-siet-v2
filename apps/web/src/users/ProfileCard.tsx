import { useRef, useState } from 'react';
import { NAME_COLORS, type NameColor } from '@rodinna/shared-types';
import { ApiError } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../shared/Avatar';

/** Karta vlastného profilu: zmena avatara (upload) a zobrazovaného mena. */
export function ProfileCard() {
  const { user, updateProfile, uploadAvatar } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user?.displayName ?? '');
  const [birthday, setBirthday] = useState(user?.birthday ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!user) return null;

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // umožni znova vybrať ten istý súbor
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadAvatar(file);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nahranie avatara zlyhalo');
    } finally {
      setBusy(false);
    }
  };

  const dirty = name.trim() !== user?.displayName || (birthday || null) !== (user?.birthday ?? null);

  /** Farba mena sa uloží hneď po kliknutí (nie cez „Uložiť" formulár). */
  const pickColor = async (color: NameColor | null) => {
    if (color === (user?.nameColor ?? null) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ nameColor: color });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Zmena farby zlyhala');
    } finally {
      setBusy(false);
    }
  };

  const onSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !dirty) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile({ displayName: trimmed, birthday: birthday || null });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uloženie zlyhalo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6">
      <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
        Môj profil
      </h2>

      <div className="mt-4 flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="relative shrink-0 rounded-full transition hover:opacity-80 disabled:opacity-50"
          title="Zmeniť avatar"
        >
          <Avatar user={user} size={72} />
          <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-accent text-white text-xs shadow">
            ✎
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={onPickAvatar}
        />
        <div className="text-sm text-neutral-500 dark:text-neutral-400">
          Klikni na avatar pre nahranie fotky.
          <br />
          JPEG, PNG, WebP alebo GIF.
        </div>
      </div>

      <form onSubmit={onSaveName} className="mt-5 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-48 text-sm">
          <span className="text-neutral-600 dark:text-neutral-300">Zobrazované meno</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            maxLength={80}
            className="mt-1 w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:border-accent"
          />
        </label>
        <label className="min-w-40 text-sm">
          <span className="text-neutral-600 dark:text-neutral-300">Dátum narodenia 🎂</span>
          <input
            type="date"
            value={birthday}
            onChange={(e) => {
              setBirthday(e.target.value);
              setSaved(false);
            }}
            className="mt-1 w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:border-accent"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !name.trim() || !dirty}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          Uložiť
        </button>
        {saved && <span className="text-sm text-emerald-600">Uložené ✓</span>}
      </form>

      <div className="mt-5">
        <span className="text-sm text-neutral-600 dark:text-neutral-300">Farba môjho mena</span>
        <p className="mt-0.5 text-xs text-neutral-500">
          Ukáž sa vo feede a chate:{' '}
          <span className="font-semibold" style={user.nameColor ? { color: user.nameColor } : undefined}>
            {name.trim() || user.displayName}
          </span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {NAME_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => void pickColor(c)}
              disabled={busy}
              title="Nastaviť túto farbu"
              className={`h-8 w-8 rounded-full transition disabled:opacity-50 ${
                user.nameColor === c ? 'ring-2 ring-offset-2 ring-neutral-400 dark:ring-offset-neutral-900' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          <button
            type="button"
            onClick={() => void pickColor(null)}
            disabled={busy}
            title="Bez farby (predvolená)"
            className={`grid h-8 w-8 place-items-center rounded-full border border-neutral-300 text-xs text-neutral-500 transition disabled:opacity-50 dark:border-neutral-600 ${
              !user.nameColor ? 'ring-2 ring-offset-2 ring-neutral-400 dark:ring-offset-neutral-900' : ''
            }`}
          >
            ✕
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}
