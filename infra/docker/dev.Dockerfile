# ── Rodinná Sieť v2 — DEV image ──────────────────────────────────────────────
# Spoločný image pre api aj web v dev režime: nainštaluje VŠETKY workspace
# závislosti (vrátane dev). Zdroják sa nekopíruje — pripája sa bind-mountom
# z docker-compose.dev.yml, takže `bun --watch` / Vite HMR reaguje na zmeny.

# glibc (Debian slim), nie Alpine/musl — `sharp` (libvips) je na glibc spoľahlivejší.
FROM oven/bun:1.2
WORKDIR /app

# Node.js pre Vite dev server: Bunov node:net polyfill (1.2.x) nemá Socket#destroySoon,
# ktoré Vite-ov bundlovaný http-proxy volá pri ukončení proxovanej odpovede — bez
# reálneho Node-u to zhodí celý dev server (SIGILL) pri prvom requeste cez /api alebo
# /ws. `api` ostáva na Bune (touto cestou kódu neprechádza).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg ffmpeg \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/ui/package.json ./packages/ui/
RUN bun install --frozen-lockfile || bun install
