import { useRef, useState } from 'react';
import type { InviteResponse, Role } from '@rodinna/shared-types';
import { authApi, ApiError } from '../lib/api';

/**
 * Skopíruje text do schránky. `navigator.clipboard` je dostupné len v secure
 * contexte (HTTPS / localhost) — na NAS cez `http://<LAN-IP>` chýba, preto
 * fallback cez skryté `<textarea>` + `execCommand('copy')`.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // padáme do fallbacku nižšie
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Admin panel: vygeneruje pozývací link pre nového člena (admin ho zdieľa ručne). */
export function InvitePanel() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    setCopied(null);
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
    // Ako poistka aj označíme text v poli, nech ho ide skopírovať aj ručne (Ctrl+C).
    linkRef.current?.select();
    const ok = await copyToClipboard(result.url);
    setCopied(ok ? 'ok' : 'fail');
    setTimeout(() => setCopied(null), 3000);
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
            Pozvánka pre <strong>{result.email}</strong> ({result.role}). Pošli tento link
            novému členovi (cez správu, WhatsApp, …):
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              ref={linkRef}
              type="text"
              readOnly
              value={result.url}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 rounded bg-neutral-100 dark:bg-neutral-900 px-2 py-1.5 font-mono text-xs outline-none focus:ring-2 focus:ring-accent/40"
            />
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {copied === 'ok' ? 'Skopírované ✓' : copied === 'fail' ? 'Označené – Ctrl+C' : 'Kopírovať'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-neutral-400">
            Link je platný 7 dní. Klikni do poľa pre označenie a skopíruj ho aj ručne (Ctrl+C / dlhé podržanie).
          </p>
        </div>
      )}
    </section>
  );
}
