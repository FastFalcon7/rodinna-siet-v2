import { app, modules } from './core/rpc/app';
import { env, isDev } from './config/env';

const server = Bun.serve({
  port: env.API_PORT,
  hostname: '0.0.0.0',
  fetch: app.fetch,
});

console.log(
  `🟢 rodinna-api beží na http://${server.hostname}:${server.port} ` +
    `(${env.NODE_ENV}) — moduly: ${modules.map((m) => m.name).join(', ')}`,
);

if (isDev) {
  console.log(`   health: http://localhost:${server.port}/api/health`);
}
