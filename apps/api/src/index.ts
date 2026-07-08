import { app, modules } from './core/rpc/app';
import { env, isDev } from './config/env';
import { runMigrations } from './core/db/migrate';
import { chatWebSocket, handleChatUpgrade, setServer } from './modules/chat/realtime';

// Pred štartom servera aplikuj čakajúce migrácie (idempotentné).
await runMigrations();

const server = Bun.serve({
  port: env.API_PORT,
  hostname: '0.0.0.0',
  async fetch(req, srv) {
    // WebSocket upgrade na /ws (Caddy sem routuje /ws). Auth cez session cookie.
    if (new URL(req.url).pathname === '/ws') {
      if (await handleChatUpgrade(req, srv)) return undefined;
      return new Response('Unauthorized', { status: 401 });
    }
    return app.fetch(req, srv);
  },
  websocket: chatWebSocket,
});

// Sprístupní server pub/sub REST vrstve (broadcast nových správ, presence…).
setServer(server);

// Cross-process WS most: eventy z workera (NOTIFY) sa republishnú do socketov.
const { startWsBridge } = await import('./core/events');
await startWsBridge();

console.log(
  `🟢 rodinna-api beží na http://${server.hostname}:${server.port} ` +
    `(${env.NODE_ENV}) — moduly: ${modules.map((m) => m.name).join(', ')}`,
);

if (isDev) {
  console.log(`   health: http://localhost:${server.port}/api/health`);
  console.log(`   ws:     ws://localhost:${server.port}/ws`);
}
