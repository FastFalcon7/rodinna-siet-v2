import { useState } from 'react';
import type { InviteResponse, Role } from '@rodinna/shared-types';
import { authApi, ApiError } from '../lib/api';

/** Admin panel: vygeneruje pozývací link pre nového člena. */
export function InvitePanel() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await authApi.invite({ email: email.trim(), role });
      setResult(r);
      setEmail('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vytvorenie pozvánky zlyhalo');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6">
      <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
        Pozvať člena
      </h2>

      <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-48 text-sm">
          <span className="text-neutral-600 dark:text-neutral-300">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="clen@email.sk"
            className="mt-1 w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:border-accent"
          />
        </label>
        <label className="text-sm">
          <span className="text-neutral-600 dark:text-neutral-300">Rola</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="mt-1 block rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none focus:border-accent"
          >
            <option value="member">člen</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          Vygenerovať link
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 p-3">
          <p className="text-xs text-neutral-500">
            Pozvánka pre <strong>{result.email}</strong> ({result.role}). Pošli tento link:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-neutral-100 dark:bg-neutral-900 px-2 py-1.5 text-xs">
              {result.url}
            </code>
            <button
              onClick={copy}
              className="shrink-0 rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {copied ? 'Skopírované ✓' : 'Kopírovať'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
