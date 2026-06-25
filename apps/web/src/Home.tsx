import { useState } from 'react';
import { useAuth } from './auth/AuthContext';
import { Avatar } from './shared/Avatar';
import { ProfileCard } from './users/ProfileCard';
import { MembersList } from './users/MembersList';
import { InvitePanel } from './users/InvitePanel';
import { Feed } from './feed/Feed';

type Tab = 'feed' | 'profil';

/** Domovská obrazovka: jednoduchá tab navigácia Feed ↔ Profil (bez routera, max 10 užívateľov). */
export function Home() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('feed');
  if (!user) return null;

  return (
    <main className="min-h-dvh px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-center gap-3">
          <Avatar user={user} size={48} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              Ahoj, {user.displayName} 👋
            </h1>
            <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">
              {user.email} · rola: <span className="font-medium">{user.role}</span>
            </p>
          </div>
          <button
            onClick={() => logout()}
            className="ml-auto shrink-0 rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Odhlásiť
          </button>
        </header>

        <nav className="flex gap-1 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-1">
          {(
            [
              ['feed', 'Feed'],
              ['profil', 'Profil a rodina'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab === value
                  ? 'bg-accent text-white'
                  : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === 'feed' && <Feed />}
        {tab === 'profil' && (
          <>
            <ProfileCard />
            {user.role === 'admin' && <InvitePanel />}
            <MembersList />
          </>
        )}

        <p className="text-center text-xs text-neutral-400">
          Ďalej príde <strong>Chat</strong> (T6–7).
        </p>
      </div>
    </main>
  );
}
