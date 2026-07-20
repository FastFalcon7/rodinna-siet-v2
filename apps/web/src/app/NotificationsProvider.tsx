import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { NotificationKind, NotificationPublic } from '@rodinna/shared-types';
import { notificationsApi } from '../lib/api';
import { useChat } from '../chat/ChatProvider';

/**
 * Neprečítané in-app notifikácie → puntíky na ikonkách modulov (ladenie
 * 07/2026): Chat mal ako jediný badge (unread správy), novinky vo Feede,
 * Albumoch, Zoznamoch či Kalendári neboli po otvorení appky nikde vidno.
 *
 * Model: každý druh notifikácie patrí modulu (KIND_MODULE). Otvorenie modulu
 * jeho notifikácie označí prečítané (badge zhasne); súčet všetkých
 * neprečítaných + unread chat = puntík na ikone appky (rovnaký výpočet ako
 * server pri push — badgeCountFor).
 */

/** Ktorému modulu (tabu) patrí druh notifikácie — kvôli badge aj mazaniu. */
const KIND_MODULE: Record<NotificationKind, string> = {
  'chat.message': 'chat', // in-app sa nezapisuje (inApp:false), len pre úplnosť
  'feed.post': 'feed',
  'polls.closed': 'feed',
  'albums.created': 'albums',
  'notes.shared': 'notes',
  'events.created': 'calendar',
  'events.reminder': 'calendar',
  'events.birthday': 'calendar',
  'diary.draft': 'diary',
  'quiz.ready': 'quiz',
  'games.turn': 'chat', // hra žije ako karta v chate
};

interface NotificationsState {
  /** Počet neprečítaných notifikácií pre modul (ikonka v navigácii). */
  moduleUnread: (module: string) => number;
  /** Súčet všetkých neprečítaných — vstupuje do puntíka na ikone appky. */
  unreadTotal: number;
  /** Označí notifikácie modulu prečítané (volá sa pri otvorení modulu). */
  markModuleRead: (module: string) => void;
}

const Ctx = createContext<NotificationsState>({
  moduleUnread: () => 0,
  unreadTotal: 0,
  markModuleRead: () => {},
});

export function useNotifications(): NotificationsState {
  return useContext(Ctx);
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useChat();
  const [unread, setUnread] = useState<NotificationPublic[]>([]);

  useEffect(() => {
    void notificationsApi
      .list()
      .then((r) => setUnread(r.notifications.filter((n) => !n.readAt)))
      .catch(() => {});
    // Real-time: nová notifikácia príde WS eventom na user:{id} topic.
    const off = subscribe((e) => {
      if (e.t === 'notification:new') setUnread((cur) => [e.notification, ...cur]);
    });
    return off;
  }, [subscribe]);

  const markModuleRead = useCallback((module: string) => {
    setUnread((cur) => {
      const ids = cur.filter((n) => KIND_MODULE[n.kind] === module).map((n) => n.id);
      if (ids.length === 0) return cur;
      void notificationsApi.markRead(ids).catch(() => {});
      return cur.filter((n) => !ids.includes(n.id));
    });
  }, []);

  const value = useMemo<NotificationsState>(
    () => ({
      moduleUnread: (module) => unread.filter((n) => KIND_MODULE[n.kind] === module).length,
      unreadTotal: unread.length,
      markModuleRead,
    }),
    [unread, markModuleRead],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
