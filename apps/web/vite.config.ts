import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Pri dev volá web API cez /api → proxy na api kontajner (alebo localhost:3000).
// V produkcii ten istý origin obsluhuje Caddy, takže /api ostáva relatívne.
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

/**
 * Vite pridáva do <script>/<link> atribút `crossorigin` (CORS mód). Appku
 * servíruje vlastný server na tom istom origine, takže crossorigin nič
 * neprináša — a láme offline PWA shell: service worker vracia z cache `basic`
 * response, ktorý crossorigin modulový script odmietne (net::ERR_FAILED).
 * Odstránením atribútu sa assety načítajú z cache aj offline.
 */
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(?:="[^"]*")?/g, '');
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stripCrossorigin()],
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
