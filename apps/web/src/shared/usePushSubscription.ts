import { useCallback, useEffect, useState } from 'react';
import { notificationsApi } from '../lib/api';

/**
 * Web Push subscription hook (M0). Registruje /sw.js a spravuje subscription
 * tohto zariadenia. iOS ≥16.4 podporuje push len v nainštalovanej PWA —
 * `needsInstall` nech UI vie zobraziť návod namiesto nefunkčného tlačidla.
 */

export type PushStatus =
  | 'unsupported' // prehliadač nevie SW/Push
  | 'server-off' // server nemá VAPID kľúče
  | 'needs-install' // iOS Safari mimo nainštalovanej PWA
  | 'denied' // užívateľ notifikácie zablokoval
  | 'off' // podporované, nezapnuté
  | 'on'
  | 'loading';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIosSafariOutsidePwa(): boolean {
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return iOS && !standalone;
}

/** Registrácia SW — volá sa raz pri štarte appky (main.tsx). Idempotentné. */
export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setStatus(isIosSafariOutsidePwa() ? 'needs-install' : 'unsupported');
        return;
      }
      try {
        const { publicKey } = await notificationsApi.pushKey();
        if (cancelled) return;
        if (!publicKey) return setStatus('server-off');
        if (Notification.permission === 'denied') return setStatus('denied');
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setStatus(sub ? 'on' : 'off');
      } catch {
        if (!cancelled) setStatus('unsupported');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const { publicKey } = await notificationsApi.pushKey();
      if (!publicKey) return setStatus('server-off');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setStatus('denied');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      await notificationsApi.subscribe({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
        deviceLabel: navigator.userAgent.slice(0, 120),
      });
      setStatus('on');
    } catch {
      setStatus('off');
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await notificationsApi.unsubscribe(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
      setStatus('off');
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, enable, disable };
}
