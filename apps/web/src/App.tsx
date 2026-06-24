import { useEffect, useState } from 'react';
import { HealthResponseSchema, type HealthResponse } from '@rodinna/shared-types';

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

type Status =
  | { kind: 'loading' }
  | { kind: 'ok'; data: HealthResponse }
  | { kind: 'error'; message: string };

/**
 * T1 shell: overuje, že web vie dosiahnuť API a že zdieľaný kontrakt sedí.
 * Validujeme odpoveď tou istou Zod schémou ako backend (@rodinna/shared-types).
 * Skutočný app shell (router, auth, layout) pribudne od T2.
 */
export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((json) => {
        const parsed = HealthResponseSchema.parse(json);
        if (!cancelled) setStatus({ kind: 'ok', data: parsed });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <h1>Rodinná Sieť v2</h1>
      <p className="muted">Phase 1 skeleton — Login · Feed · Chat (čoskoro)</p>

      <section className="card" aria-live="polite">
        {status.kind === 'loading' && <span>Kontrolujem API…</span>}
        {status.kind === 'ok' && (
          <span className="ok">
            ✅ API <strong>{status.data.service}</strong> v{status.data.version} — {status.data.status}
          </span>
        )}
        {status.kind === 'error' && (
          <span className="err">⚠️ API nedostupné: {status.message}</span>
        )}
      </section>
    </main>
  );
}
