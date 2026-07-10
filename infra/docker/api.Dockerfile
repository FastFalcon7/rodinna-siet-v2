# ── Rodinná Sieť v2 — API image (Bun) ────────────────────────────────────────
# Bun spúšťa TypeScript natívne, takže v produkcii netreba build krok — len
# nainštalované závislosti + zdroják. Multi-stage kvôli čistému prod node_modules.
#
# Pozn.: build prebieha na NAS/devcontaineri s plným internetom. V cloud sandboxe
# s reštriktívnym proxy sa image nepullne (to je očakávané, netestuje sa tu).

# glibc (Debian slim), nie Alpine/musl — `sharp` (libvips) je na glibc spoľahlivejší.
FROM oven/bun:1.2 AS deps
WORKDIR /app
# Najprv len manifesty kvôli docker layer cache.
COPY package.json bun.lock* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/ui/package.json ./packages/ui/
RUN bun install --frozen-lockfile --production || bun install --production

FROM oven/bun:1.2 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg pre worker job media.transcode (video normalizácia na H.264 + poster).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

EXPOSE 3000
# Healthcheck volá vlastný /api/health endpoint. Cez bun (Debian slim nemá wget/curl).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "apps/api/src/index.ts"]
