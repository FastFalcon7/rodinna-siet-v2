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

const NAV_ITEMS: { value: Tab; label: string; icon: typeof HomeIcon }[] = [
  { value: 'feed', label: 'Feed', icon: HomeIcon },
  { value: 'chat', label: 'Chat', icon: ChatIcon },
  { value: 'profil', label: 'Profil', icon: UserIcon },
];

/**
 * App shell (DESIGN_REVIEW_FEED_CHAT.md §2): tenký app bar + bottom nav na
 * mobile, sidebar na desktope. Identita užívateľa žije v tabe Profil, nie
 * v hlavičke — obsah dostáva maximum viewportu.
 */
function HomeInner() {
  const { user, logout } = useAuth();
  const { totalUnread } = useChat();
  const [tab, setTab] = useState<Tab>('feed');
  if (!user) return null;

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-200 bg-white md:flex dark:border-neutral-800 dark:bg-neutral-900">
        <div className="px-5 py-4 text-lg font-semibold tracking-tight">Rodinná sieť</div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV_ITEMS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                tab === value
                  ? 'bg-accent/10 text-accent'
                  : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {value === 'chat' && <UnreadBadge count={totalUnread} />}
              </span>
              {label}
            </button>
          ))}
        </nav>
        <button
          onClick={() => setTab('profil')}
          className="mt-auto flex items-center gap-3 border-t border-neutral-200 px-5 py-3 text-left transition hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800"
        >
          <Avatar user={user} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.displayName}</span>
            <span className="block truncate text-xs text-neutral-500">{user.email}</span>
          </span>
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* App bar (mobil) — tenký, blur, bez identity */}
        <header
          className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-white/80 px-4 backdrop-blur-xl md:hidden dark:border-neutral-800 dark:bg-neutral-900/80"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="flex h-12 w-full items-center justify-between">
            <h1 className="text-base font-semibold tracking-tight">Rodinná sieť</h1>
            <button onClick={() => setTab('profil')} aria-label="Profil">
              <Avatar user={user} size={28} />
            </button>
          </div>
        </header>

        {/* Obsah — chat dostáva celú výšku, ostatné taby scrollujú vnútri */}
        <div className="min-h-0 flex-1">
          {tab === 'chat' ? (
            <div className="mx-auto h-full w-full max-w-5xl border-neutral-200 md:border-x dark:border-neutral-800">
              <Chat />
            </div>
          ) : tab === 'feed' ? (
            // Feed je edge-to-edge (Bluesky) — bez horizontálneho paddingu na mobile.
            <div className="h-full overflow-y-auto">
              <div className="mx-auto max-w-2xl pb-4 md:border-x md:border-neutral-200 dark:md:border-neutral-800">
                <Feed />
              </div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
                {tab === 'profil' && (
                  <>
                    <section className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
                      <Avatar user={user} size={56} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{user.displayName}</p>
                        <p className="truncate text-sm text-neutral-500">
                          {user.email} · {user.role === 'admin' ? 'admin' : 'člen'}
                        </p>
                      </div>
                      <button
                        onClick={() => logout()}
                        className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                      >
                        Odhlásiť
                      </button>
                    </section>
                    <ProfileCard />
                    {user.role === 'admin' && <InvitePanel />}
                    <MembersList />
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom nav (mobil) */}
        <nav
          className="flex shrink-0 border-t border-neutral-200 bg-white/90 backdrop-blur-xl md:hidden dark:border-neutral-800 dark:bg-neutral-900/90"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {NAV_ITEMS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 transition ${
                tab === value ? 'text-accent' : 'text-neutral-500 dark:text-neutral-400'
              }`}
            >
              <span className="relative">
                <Icon className="h-6 w-6" />
                {value === 'chat' && <UnreadBadge count={totalUnread} />}
              </span>
              <span className="text-[11px] font-medium">{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function Home() {
  return (
    <ChatProvider>
      <HomeInner />
    </ChatProvider>
  );
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.1-1L3 20l1.1-5A8.5 8.5 0 1 1 21 11.5Z" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
    </svg>
  );
}
