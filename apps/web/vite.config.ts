import net from 'node:net';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Bun (na NAS aj lokálne `bun run dev`) ešte nemá `Socket#destroySoon` v node:net
// polyfille — Vite-ov bundlovaný http-proxy ho volá pri ukončení proxovanej
// odpovede a bez tohto patchu to zhodí celý dev server (SIGILL/segfault) pri
// prvom requeste cez /api alebo /ws. Vite Node.js implementácia: end() + destroy
// po dopísaní streamu. Týka sa len dev servera, produkcia ide cez Caddy bez proxy.
type SocketWithDestroySoon = net.Socket & { destroySoon?: () => void };
const socketProto = net.Socket.prototype as SocketWithDestroySoon;
if (typeof socketProto.destroySoon !== 'function') {
  socketProto.destroySoon = function destroySoon(this: net.Socket) {
    if (this.writable) this.end();
    if (this.writableFinished) this.destroy();
    else this.once('finish', () => this.destroy());
  };
}

// Pri dev volá web API cez /api → proxy na api kontajner (alebo localhost:3000).
// V produkcii ten istý origin obsluhuje Caddy, takže /api ostáva relatívne.
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // Povolí prístup cez IP NAS / hostname (inak Vite 7 blokne neznámy host).
    allowedHosts: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      // WebSocket chatu — proxy s ws:true (prod rieši Caddy: @api path /ws).
      '/ws': {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
