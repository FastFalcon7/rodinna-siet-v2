import { useEffect, useState } from 'react';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  type NotificationKind,
  type NotificationPrefs,
} from '@rodinna/shared-types';
import { notificationsApi } from '../lib/api';
import { usePushSubscription } from '../shared/usePushSubscription';

/**
 * Nastavenia notifikácií (M0): zapnutie push na tomto zariadení + per-druh
 * preferencie (integračný kontrakt K3 — druhy registrujú moduly).
 */
export function NotificationSettings() {
  const { status, busy, enable, disable } = usePushSubscription();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => {
    void notificationsApi
      .getPrefs()
      .then((r) => setPrefs(r.prefs))
      .catch(() => setPrefs({}));
  }, []);

  async function toggleKind(kind: NotificationKind) {
    if (!prefs) return;
    const next = { ...prefs, [kind]: prefs[kind] === false };
    setPrefs(next); // optimisticky
    try {
      const r = await notificationsApi.setPrefs(next);
      setPrefs(r.prefs);
    } catch {
      setPrefs(prefs);
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-1 font-semibold">Notifikácie</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Push notifikácie prídu na zamknutú obrazovku, keď appku nemáš otvorenú.
      </p>

      {status === 'loading' ? (
        <p className="text-sm text-neutral-400">Zisťujem stav…</p>
      ) : status === 'needs-install' ? (
        <p className="rounded-xl bg-neutral-100 p-3 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          Na iPhone/iPade najprv pridaj appku na plochu: <strong>Zdieľať → Pridať na plochu</strong>.
          Push notifikácie potom zapneš tu.
        </p>
      ) : status === 'unsupported' ? (
        <p className="text-sm text-neutral-500">Tento prehliadač push notifikácie nepodporuje.</p>
      ) : status === 'server-off' ? (
        <p className="text-sm text-neutral-500">
          Server nemá nastavené push kľúče (VAPID) — požiadaj admina.
        </p>
      ) : status === 'denied' ? (
        <p className="text-sm text-neutral-500">
          Notifikácie sú pre túto stránku zablokované — povoľ ich v nastaveniach prehliadača.
        </p>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Push na tomto zariadení</span>
          <button
            onClick={() => void (status === 'on' ? disable() : enable())}
            disabled={busy}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
              status === 'on'
                ? 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                : 'bg-accent text-white hover:opacity-90'
            }`}
          >
            {busy ? '…' : status === 'on' ? 'Vypnúť' : 'Zapnúť'}
          </button>
        </div>
      )}

      {prefs && (
        <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <h3 className="mb-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
            Čo ti má chodiť
          </h3>
          <ul className="space-y-2">
            {NOTIFICATION_KINDS.map((kind) => {
              const enabled = prefs[kind] !== false;
              return (
                <li key={kind} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{NOTIFICATION_KIND_LABELS[kind]}</span>
                  <button
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => void toggleKind(kind)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                      enabled ? 'bg-accent' : 'bg-neutral-300 dark:bg-neutral-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${
                        enabled ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
