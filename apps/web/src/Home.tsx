import { useAuth } from './auth/AuthContext';

/**
 * Dočasná domovská obrazovka po prihlásení (T2a).
 * Skutočný app shell (nav, Feed, Chat moduly) pribudne od T4.
 */
export function Home() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <main className="min-h-dvh px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Ahoj, {user.displayName} 👋
            </h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {user.email} · rola: <span className="font-medium">{user.role}</span>
            </p>
          </div>
          <button
            onClick={() => logout()}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Odhlásiť
          </button>
        </header>

        <section className="mt-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            ✅ Prihlásenie funguje. Toto je zatiaľ prázdna domovská obrazovka.
          </p>
          <p className="mt-2 text-sm text-neutral-500">
            Ďalej príde <strong>Feed</strong> (T4–5) a <strong>Chat</strong> (T6–7).
            {user.role === 'admin' && ' Ako admin budeš môcť pozývať ďalších členov.'}
          </p>
        </section>
      </div>
    </main>
  );
}
