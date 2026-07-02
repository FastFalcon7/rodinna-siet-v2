import type { ClientWsEvent, ServerWsEvent } from '@rodinna/shared-types';

type EventListener = (e: ServerWsEvent) => void;
type StatusListener = (connected: boolean) => void;

/** Adresa /ws na rovnakom origine (dev: Vite proxy ws:true, prod: Caddy). */
function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

/**
 * Tenký reconnecting WebSocket klient pre chat. Drží jedno spojenie počas behu
 * aplikácie, auto-reconnect s exponenciálnym backoffom (1→15 s), heartbeat ping.
 * Cookie session sa posiela automaticky (same-origin upgrade).
 */
export class ChatSocket {
  private ws: WebSocket | null = null;
  private events = new Set<EventListener>();
  private statuses = new Set<StatusListener>();
  private backoff = 1000;
  private stopped = false;
  private pingTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  connect(): void {
    this.stopped = false;
    this.open();
  }

  private open(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      this.emitStatus(true);
      this.startPing();
    };
    ws.onmessage = (ev) => {
      let parsed: ServerWsEvent;
      try {
        parsed = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      for (const l of this.events) l(parsed);
    };
    ws.onclose = () => {
      this.stopPing();
      this.emitStatus(false);
      if (!this.stopped) this.scheduleReconnect();
    };
    ws.onerror = () => {
      // close handler sa postará o reconnect.
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.open(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 15000);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 25000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  send(e: ClientWsEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(e));
    }
  }

  onEvent(l: EventListener): () => void {
    this.events.add(l);
    return () => this.events.delete(l);
  }

  onStatus(l: StatusListener): () => void {
    this.statuses.add(l);
    return () => this.statuses.delete(l);
  }

  private emitStatus(connected: boolean): void {
    for (const l of this.statuses) l(connected);
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }
}
