import { useEffect } from 'react';

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * Puntík na ikone appky na ploche (ladenie 07/2026, bod 4) cez Badging API.
 * Kým je appka otvorená, drží presný počet neprečítaného; pri 0 puntík zmaže
 * (aj ten, čo nahodil service worker pri push notifikácii počas zavretej appky).
 *
 * Podpora: nainštalovaná PWA (na iPhone 16.4+ po „Pridať na plochu"). Kde API
 * nie je, hook ticho nič nerobí.
 */
export function useAppBadge(count: number): void {
  useEffect(() => {
    const nav = navigator as BadgeNavigator;
    if (!nav.setAppBadge) return;
    if (count > 0) void nav.setAppBadge(count).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
  }, [count]);
}
