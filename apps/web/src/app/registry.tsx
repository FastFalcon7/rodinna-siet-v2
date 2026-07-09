import { useMemo, type ComponentType } from 'react';
import { Feed } from '../feed/Feed';
import { Chat } from '../chat/Chat';
import { useChat } from '../chat/ChatProvider';
import { Albums } from '../albums/Albums';
import { Notes } from '../notes/Notes';
import { Calendar } from '../events/Calendar';
import { Diary } from '../diary/Diary';
import { Practice } from '../games/Practice';
import { consumeRoomParam } from '../shared/deepLink';
import { consumePendingNav } from './navigate';

/**
 * Frontend plugin kontrakt (ARCHITECTURE_V2.md §5, plán M0-3 / K4).
 * Modul = obrazovka + položka v navigácii:
 *   slot 'bar'  — vlastný slot v bottom nave / sidebari (max ~3),
 *   slot 'more' — položka v obrazovke „Viac".
 * Phase 2 modul (Ankety, Albumy…) sa pridá jedným záznamom vo `webModules`
 * — bez zásahu do Home.tsx.
 */

export interface WebModule {
  name: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  slot: 'bar' | 'more';
  /**
   * Layout obrazovky v shelli: 'scroll' = obsah scrolluje v strednom stĺpci
   * (max-w-2xl, edge-to-edge na mobile), 'full' = modul dostane celú výšku
   * a scroll si rieši sám (chat).
   */
  layout: 'scroll' | 'full';
  Component: ComponentType;
  /** Voliteľný badge na ikone (napr. neprečítané správy). Hook — navigácia
   *  ho volá pri renderi, poradie modulov je stabilné. */
  useBadge?: () => number;
}

function FeedScreen() {
  return <Feed />;
}

function ChatScreen() {
  // Deep link z push notifikácie (/?room=…) alebo z inej časti appky
  // (napr. „Napísať gratuláciu" na narodeninovej karte) — raz pri mounte.
  const initialRoomId = useMemo(
    () => consumeRoomParam() ?? consumePendingNav('chat')?.entityId ?? null,
    [],
  );
  return <Chat initialRoomId={initialRoomId} />;
}

function useChatBadge(): number {
  return useChat().totalUnread;
}

export const webModules: WebModule[] = [
  {
    name: 'feed',
    label: 'Feed',
    icon: HomeIcon,
    slot: 'bar',
    layout: 'scroll',
    Component: FeedScreen,
  },
  {
    name: 'chat',
    label: 'Chat',
    icon: ChatIcon,
    slot: 'bar',
    layout: 'full',
    Component: ChatScreen,
    useBadge: useChatBadge,
  },
  {
    name: 'albums',
    label: 'Albumy',
    icon: PhotoIcon,
    slot: 'bar',
    layout: 'scroll',
    Component: Albums,
  },
  // Slot 'more': bottom nav má 4 sloty plné — Zoznamy a Kalendár žijú vo „Viac".
  {
    name: 'notes',
    label: 'Zoznamy a poznámky',
    icon: ChecklistIcon,
    slot: 'more',
    layout: 'scroll',
    Component: Notes,
  },
  {
    name: 'calendar',
    label: 'Kalendár',
    icon: CalendarIcon,
    slot: 'more',
    layout: 'scroll',
    Component: Calendar,
  },
  {
    name: 'diary',
    label: 'Denník',
    icon: BookIcon,
    slot: 'more',
    layout: 'scroll',
    Component: Diary,
  },
  {
    name: 'games-practice',
    label: 'Piškvorky proti počítaču',
    icon: GameIcon,
    slot: 'more',
    layout: 'scroll',
    Component: Practice,
  },
];

export function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </svg>
  );
}

export function ChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.1-1L3 20l1.1-5A8.5 8.5 0 1 1 21 11.5Z" />
    </svg>
  );
}

export function BookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4.5 4.5A2 2 0 0 1 6.5 3H19v16H6.5a2 2 0 0 0-2 2Z" />
      <path d="M4.5 4.5V21M19 19v2H6.5" />
    </svg>
  );
}

export function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChecklistIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="m3.5 6 1.5 1.5L8 4.5" />
      <path d="m3.5 12.5 1.5 1.5L8 11" />
      <path d="m3.5 19 1.5 1.5L8 17.5" />
      <path d="M11 6.5h9.5M11 13h9.5M11 19.5h9.5" />
    </svg>
  );
}

export function PhotoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.7" />
      <path d="m5 18 5-5 3 3 3.5-3.5L21 17" />
    </svg>
  );
}

export function GameIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" />
    </svg>
  );
}

export function MoreIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}
