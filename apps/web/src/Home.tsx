import { useState } from 'react';
import { useAuth } from './auth/AuthContext';
import { Avatar } from './shared/Avatar';
import { ProfileCard } from './users/ProfileCard';
import { MembersList } from './users/MembersList';
import { InvitePanel } from './users/InvitePanel';
import { Feed } from './feed/Feed';
import { ChatProvider, useChat } from './chat/ChatProvider';
import { Chat } from './chat/Chat';

type Tab = 'feed' | 'chat' | 'profil';

/** Domovská obrazovka: tab navigácia Feed ↔ Chat ↔ Profil (bez routera, max 10 užívateľov). */
function HomeInner() {
  const { user, logout } = useAuth();
  const { totalUnread } = useChat();
  const [tab, setTab] = useState<Tab>('feed');
  if (!user) return null;

  return (
    <main className="min-h-dvh px-4 py-10">
      <div className={`mx-auto space-y-6 ${tab === 'chat' ? 'max-w-5xl' : 'max-w-2xl'}`}>
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
              ['chat', 'Chat'],
              ['profil', 'Profil a rodina'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`relative flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab === value
                  ? 'bg-accent text-white'
                  : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {label}
              {value === 'chat' && totalUnread > 0 && (
                <span
                  className={`ml-1.5 inline-grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold ${
                    tab === 'chat' ? 'bg-white/25 text-white' : 'bg-accent text-white'
                  }`}
                >
                  {totalUnread}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* ChatProvider (socket + unread badge) žije nad všetkými tabmi, takže
            badge sa aktualizuje stále. Samotný Chat mountujeme len keď je aktívny
            — inak by sa otvorená konverzácia označovala ako prečítaná na pozadí. */}
        {tab === 'chat' && <Chat />}
        {tab === 'feed' && <Feed />}
        {tab === 'profil' && (
          <>
            <ProfileCard />
            {user.role === 'admin' && <InvitePanel />}
            <MembersList />
          </>
        )}
      </div>
    </main>
  );
}

export function Home() {
  return (
    <ChatProvider>
      <HomeInner />
    </ChatProvider>
  );
}
