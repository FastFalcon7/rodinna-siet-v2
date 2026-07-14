import { useState, type FormEvent } from 'react';
import { LoginInputSchema, RegisterInputSchema } from '@rodinna/shared-types';
import { useAuth } from './AuthContext';
import { ApiError } from '../lib/api';

type Mode = 'login' | 'register';

// Predvyplnenie z pozývacieho linku /register?token=...&email=...
const params = new URLSearchParams(window.location.search);
const inviteToken = params.get('token') ?? '';
const inviteEmail = params.get('email') ?? '';

const inputClass =
  'w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 transition';

export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>(inviteToken ? 'register' : 'login');
  const [email, setEmail] = useState(inviteEmail);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed =
      mode === 'login'
        ? LoginInputSchema.safeParse({ email, password })
        : RegisterInputSchema.safeParse({ token: inviteToken, email, displayName, password });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Neplatné údaje');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') await login({ email, password });
      else await register({ token: inviteToken, email, displayName, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Niečo sa pokazilo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Naša rodina</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {mode === 'login' ? 'Prihlás sa' : 'Dokonči registráciu'}
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-sm"
        >
          {mode === 'register' && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Meno</span>
              <input
                className={inputClass}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                placeholder="Tvoje meno"
              />
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Email</span>
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="ty@example.com"
              readOnly={mode === 'register' && !!inviteEmail}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Heslo</span>
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'register' ? 'Aspoň 10 znakov' : '••••••••'}
            />
          </label>

          {error && (
            <p className="text-sm text-[var(--color-accent)]" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[var(--color-accent)] py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Moment…' : mode === 'login' ? 'Prihlásiť sa' : 'Zaregistrovať sa'}
          </button>
        </form>

        {/* Bez pozvánky sa registrovať nedá → prepínač ukáž len ak nie je invite. */}
        {!inviteToken && (
          <p className="mt-4 text-center text-xs text-neutral-500">
            {mode === 'login'
              ? 'Registrácia je možná len cez pozývací link od admina.'
              : 'Už máš účet?'}{' '}
            {mode === 'register' && (
              <button className="underline" onClick={() => setMode('login')}>
                Prihlásiť sa
              </button>
            )}
          </p>
        )}
      </div>
    </main>
  );
}
