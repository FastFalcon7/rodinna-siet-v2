import { useEffect, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import { Avatar } from './shared/Avatar';
import { nameStyle } from './shared/nameColor';
import { onAppNavigate, MORE_TAB } from './app/navigate';
import { peekRoomParam } from './shared/deepLink';
import { ChatProvider, useChat } from './chat/ChatProvider';
import { More } from './more/More';
import { CommandPalette } from './app/CommandPalette';
import { MoreIcon, webModules, type WebModule } from './app/registry';
import { useSwipeBack } from './shared/useSwipeBack';
import { useAppBadge } from './shared/useAppBadge';
import { useKeyboardScroll } from './shared/useKeyboardScroll';
import { NotificationsProvider, useNotifications } from './app/NotificationsProvider';

/**
 * App shell (DESIGN_REVIEW_FEED_CHAT.md §2, plán M0-3): tenký app bar +
 * bottom nav na mobile, sidebar na desktope. Navigácia sa skladá z modulov
 * registrovaných v app/registry.tsx (slot 'bar') + fixného „Viac" — Phase 2
 * modul sa pridá záznamom v registry, bez zásahu sem.
 */

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
  const { unreadTotal, markModuleRead } = useNotifications();
  // Puntík na ikone appky — neprečítaný chat + neprečítané notifikácie
  // (rovnaký výpočet ako server pri push); pri 0 puntík zmizne.
  useAppBadge(useChat().totalUnread + unreadTotal);
  // iOS: prvé zaostrenie poľa po studenom štarte neposunie pole nad klávesnicu.
  useKeyboardScroll();
  // Deep link z push notifikácie (/?room=…) → štart rovno v chate.
  const [tab, setTab] = useState<string>(() => (peekRoomParam() ? 'chat' : webModules[0]!.name));

  // Navigácia z živých kariet (napr. karta albumu vo Feede → modul Albumy).
  useEffect(() => onAppNavigate((req) => setTab(req.module)), []);

  // Otvorený modul = jeho novinky videné → puntík na jeho ikonke zhasne.
  // Beží aj pri zmene unreadTotal — novinka doručená počas pozerania modulu
  // sa označí hneď.
  useEffect(() => {
    markModuleRead(tab);
  }, [tab, unreadTotal, markModuleRead]);

  if (!user) return null;

  const barModules = webModules.filter((m) => m.slot === 'bar');
  const active = webModules.find((m) => m.name === tab) ?? null;
  // Swipe doprava = späť do „Viac" pre moduly otvorené z neho (Kalendár,
  // Zoznamy…). Root taby (Feed/Chat/Albumy) späť nemajú.
  const swipeBackToMore = useSwipeBack(() => setTab(MORE_TAB));

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
    // Bottom nav (ladenie 07/2026): 6 položiek, len ikony — texty by sa nezmestili.
    return (
      <button
        key={key}
        onClick={() => setTab(key)}
        title={label}
        aria-label={label}
        className={`flex flex-1 flex-col items-center py-2.5 transition ${
          isActive ? 'text-accent' : 'text-neutral-500 dark:text-neutral-400'
        }`}
      >
        <span className="relative">
          <Icon className="h-6 w-6" />
          {module && <NavBadge module={module} />}
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      <CommandPalette />
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-200 bg-white md:flex dark:border-neutral-800 dark:bg-neutral-900">
        <div className="px-5 py-4 text-lg font-semibold tracking-tight">Naša rodina</div>
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
            <span className="block truncate text-sm font-medium" style={nameStyle(user)}>
              {user.displayName}
            </span>
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
            <h1 className="text-base font-semibold tracking-tight">Naša rodina</h1>
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
            <div className="h-full overflow-y-auto" {...(active.slot === 'more' ? swipeBackToMore : {})}>
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
      {/* Notifikácie potrebujú WS eventy z ChatProvider (subscribe). */}
      <NotificationsProvider>
        <HomeInner />
      </NotificationsProvider>
    </ChatProvider>
  );
}
