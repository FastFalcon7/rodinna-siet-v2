# ── Rodinná Sieť v2 — Web + Caddy image ──────────────────────────────────────
# Stage 1: zostaví statický web (Vite build).
# Stage 2: Caddy obsluhuje statiku z /srv/web a reverse-proxuje /api → api:3000.
# Toto je "edge" kontajner (TLS, static, proxy) — beží len v produkcii na NAS.

FROM oven/bun:1.2-alpine AS build
WORKDIR /app
COPY package.json bun.lock* ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/ui/package.json ./packages/ui/
RUN bun install --frozen-lockfile || bun install
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# Relatívne /api (rovnaký origin za Caddy).
ENV VITE_API_URL=/api
RUN bun run --filter @rodinna/web build

FROM caddy:2-alpine AS runtime
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv/web
EXPOSE 80 443
