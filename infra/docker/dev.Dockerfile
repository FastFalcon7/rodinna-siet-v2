# ── Rodinná Sieť v2 — DEV image ──────────────────────────────────────────────
# Spoločný image pre api aj web v dev režime: nainštaluje VŠETKY workspace
# závislosti (vrátane dev). Zdroják sa nekopíruje — pripája sa bind-mountom
# z docker-compose.dev.yml, takže `bun --watch` / Vite HMR reaguje na zmeny.

# glibc (Debian slim), nie Alpine/musl — `sharp` (libvips) je na glibc spoľahlivejší.
FROM oven/bun:1.2
WORKDIR /app
COPY package.json bun.lock* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/ui/package.json ./packages/ui/
RUN bun install --frozen-lockfile || bun install
