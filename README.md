# Rodinná Sieť v2

Privátna rodinná sociálna sieť (max 10 užívateľov), **100 % self-hosted** na
Synology DS925+. Architektonický návrh: [`ARCHITECTURE_V2.md`](./ARCHITECTURE_V2.md).

**Stack:** Bun + Hono + PostgreSQL/pgvector (backend) · Vite 7 + React 19 PWA
(frontend) · Caddy (TLS) · Docker Compose. Monorepo cez **Bun workspaces**.

> **Stav:** T2a — Auth (email + heslo). Monorepo skeleton, `/api/health`, Docker
> setup (T1) + DB (Drizzle/Postgres), session auth, invite-only registrácia,
> login/register UI. Passkey (T2b), Feed, Chat prichádzajú ďalej (`ARCHITECTURE_V2.md §13`).

## Auth (T2a)

- **Email + heslo** (argon2id, natívne v Bune), **invite-only** registrácia.
- **Session** = opaque token v HttpOnly cookie, hash v DB, sliding expirácia (bez JWT).
- **RBAC**: prvý registrovaný užívateľ = `admin`, ďalší = `member`.
- Endpointy: `POST /api/auth/{register,login,logout,invite}`, `GET /api/auth/me`.

### Prvé prihlásenie (bootstrap admina)

Registrovať sa dá len cez pozývací link. Prvú pozvánku vygeneruje admin z CLI
(v bežiacom api kontajneri, aby použil jeho `DATABASE_URL`):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api \
  bun apps/api/scripts/create-invite.ts ty@email.sk
```

Vypíše registračný link `…/register?token=…&email=…`. Otvor ho v prehliadači,
dokonči registráciu → si admin. Ďalších členov pozývaš rovnako (alebo neskôr
z UI). Migrácie sa aplikujú automaticky pri štarte api.

---

## Štruktúra

```
apps/
  api/            Bun + Hono backend (moduly + core, §5 architektúry)
  web/            Vite 7 + React 19 PWA shell
packages/
  shared-types/   Zod schémy zdieľané API ↔ web
  ui/             design tokens (OKLCH téma, §10)
infra/
  docker/         Dockerfiles (api / web+caddy / dev)
  caddy/          Caddyfile (parametrizovaný cez DOMAIN)
docker-compose.yml         base — produkcia na NAS
docker-compose.dev.yml     dev override — Vite HMR + bun --watch
```

## Vývoj

Potrebuješ **Bun ≥ 1.2**. Docker je voliteľný (odporúčaný pre paritu s NAS).

### A) Natívne (najrýchlejšie iterácie)

```bash
bun install
bun run dev          # spustí api (:3000) aj web (:5173) naraz
# alebo zvlášť: bun run dev:api / bun run dev:web
```

Web beží na http://localhost:5173, volania na `/api/*` proxuje na `:3000`.

### B) Cez Docker (parita s NAS)

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

- web (Vite HMR): http://localhost:5173
- api: http://localhost:3000/api/health
- postgres: localhost:5432
- `caddy` sa v dev **nespúšťa** (je v profile `edge`).

### Užitočné

```bash
bun run typecheck    # tsc cez všetky balíky
bun run build        # produkčný build
curl localhost:3000/api/health   # → {"status":"ok",...}
```

## Produkčné nasadenie (Synology DS925+)

Plný stack vrátane Caddy (auto-TLS) sa spúšťa s profilom `edge`:

```bash
cp .env.example .env     # nastav DOMAIN, POSTGRES_PASSWORD, atď.
docker compose --profile edge up -d --build
```

- `DOMAIN=localhost` → Caddy self-signed cert (lokálny test).
- `DOMAIN=rodinna.tvojmeno.synology.me` → Caddy auto Let's Encrypt.

> Synology DDNS doménu (`*.synology.me`, zadarmo) netreba hneď — stačí keď budeš
> testovať Web Push na iPhone / prístup z mobilnej siete (cca T5–T6). Zmena
> domény = úprava `DOMAIN` v `.env`, žiadny refactor.

## Roadmap

Pozri `ARCHITECTURE_V2.md §13`. Aktuálne: **T1 hotové.**
