import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pri dev volá web API cez /api → proxy na api kontajner (alebo localhost:3000).
// V produkcii ten istý origin obsluhuje Caddy, takže /api ostáva relatívne.
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
