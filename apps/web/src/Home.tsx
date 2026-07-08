import { useState } from 'react';
import { useAuth } from './auth/AuthContext';
import { Avatar } from './shared/Avatar';
import { peekRoomParam } from './shared/deepLink';
import { ChatProvider } from './chat/ChatProvider';
import { More } from './more/More';
import { MoreIcon, webModules, type WebModule } from './app/registry';

/**
 * App shell (DESIGN_REVIEW_FEED_CHAT.md §2, plán M0-3): tenký app bar +
 * bottom nav na mobile, sidebar na desktope. Navigácia sa skladá z modulov
 * registrovaných v app/registry.tsx (slot 'bar') + fixného „Viac" — Phase 2
 * modul sa pridá záznamom v registry, bez zásahu sem.
 */

const MORE_TAB = '__more__';

function NavBadge({ module }: { module: WebModule }) {
  const count = module.useBadge?.() ?? 0;
  if (count <= 0) return null;
  return (
    <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function HomeInner() {
  const { user } = useAuth();
  // Deep link z push notifikácie (/?room=…) → štart rovno v chate.
  const [tab, setTab] = useState<string>(() => (peekRoomParam() ? 'chat' : webModules[0]!.name));
  if (!user) return null;

  const barModules = webModules.filter((m) => m.slot === 'bar');
  const active = webModules.find((m) => m.name === tab) ?? null;

  const navButton = (
    key: string,
    label: string,
    Icon: WebModule['icon'],
    module: WebModule | null,
    variant: 'side' | 'bottom',
  ) => {
    const isActive = tab === key;
    if (variant === 'side') {
      return (
        <button
          key={key}
          onClick={() => setTab(key)}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
            isActive
              ? 'bg-accent/10 text-accent'
              : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
          }`}
        >
          <span className="relative">
            <Icon className="h-5 w-5" />
            {module && <NavBadge module={module} />}
          </span>
          {label}
        </button>
      );
    }
    return (
      <button
        key={key}
        onClick={() => setTab(key)}
        className={`flex flex-1 flex-col items-center gap-0.5 py-2 transition ${
          isActive ? 'text-accent' : 'text-neutral-500 dark:text-neutral-400'
        }`}
      >
        <span className="relative">
          <Icon className="h-6 w-6" />
          {module && <NavBadge module={module} />}
        </span>
        <span className="text-[11px] font-medium">{label}</span>
      </button>
    );
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-200 bg-white md:flex dark:border-neutral-800 dark:bg-neutral-900">
        <div className="px-5 py-4 text-lg font-semibold tracking-tight">Rodinná sieť</div>
        <nav className="flex flex-col gap-1 px-3">
          {barModules.map((m) => navButton(m.name, m.label, m.icon, m, 'side'))}
          {navButton(MORE_TAB, 'Viac', MoreIcon, null, 'side')}
        </nav>
        <button
          onClick={() => setTab(MORE_TAB)}
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
            <button onClick={() => setTab(MORE_TAB)} aria-label="Viac">
              <Avatar user={user} size={28} />
            </button>
          </div>
        </header>

        {/* Obsah — 'full' moduly (chat) dostávajú celú výšku, 'scroll' scrollujú vnútri */}
        <div className="min-h-0 flex-1">
          {active?.layout === 'full' ? (
            <div className="mx-auto h-full w-full max-w-5xl border-neutral-200 md:border-x dark:border-neutral-800">
              <active.Component />
            </div>
          ) : active ? (
            // 'scroll' moduly sú edge-to-edge (Bluesky) — bez horizontálneho paddingu na mobile.
            <div className="h-full overflow-y-auto">
              <div className="mx-auto max-w-2xl pb-4 md:border-x md:border-neutral-200 dark:md:border-neutral-800">
                <active.Component />
              </div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
                <More onOpenModule={(name) => setTab(name)} />
              </div>
            </div>
          )}
        </div>

        {/* Bottom nav (mobil) */}
        <nav
          className="flex shrink-0 border-t border-neutral-200 bg-white/90 backdrop-blur-xl md:hidden dark:border-neutral-800 dark:bg-neutral-900/90"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {barModules.map((m) => navButton(m.name, m.label, m.icon, m, 'bottom'))}
          {navButton(MORE_TAB, 'Viac', MoreIcon, null, 'bottom')}
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
