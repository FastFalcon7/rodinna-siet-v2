import { useCallback, useEffect, useState } from 'react';

/**
 * Install prompt (T8, PWA polish). Dva svety:
 *   • Chrome/Edge/Android: prehliadač pošle `beforeinstallprompt`, ktorý
 *     odchytíme a spustíme na kliknutie („Nainštalovať"),
 *   • iOS Safari: žiadny event — ukážeme návod Zdieľať → Pridať na plochu.
 * Keď appka už beží ako nainštalovaná (standalone), stav je 'installed'.
 */

export type InstallStatus =
  | 'installed' // beží ako PWA (standalone)
  | 'available' // beforeinstallprompt k dispozícii → tlačidlo Nainštalovať
  | 'ios' // iOS Safari → manuálny návod
  | 'unavailable'; // desktop bez podpory / už nainštalované inde

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [status, setStatus] = useState<InstallStatus>(() => {
    if (isStandalone()) return 'installed';
    if (isIos()) return 'ios';
    return 'unavailable';
  });

  useEffect(() => {
    if (isStandalone()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // nech si prehliadač neukáže vlastný mini-infobar
      setDeferred(e as BeforeInstallPromptEvent);
      setStatus('available');
    };
    const onInstalled = () => {
      setDeferred(null);
      setStatus('installed');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === 'accepted') setStatus('installed');
  }, [deferred]);

  return { status, promptInstall };
}
