# Rodinná Sieť v2

Privátna rodinná sociálna sieť (max 10 užívateľov), **100 % self-hosted** na
Synology DS925+. Architektonický návrh: [`ARCHITECTURE_V2.md`](./ARCHITECTURE_V2.md).

**Stack:** Bun + Hono + PostgreSQL/pgvector (backend) · Vite 7 + React 19 PWA
(frontend) · Caddy (TLS) · Docker Compose. Monorepo cez **Bun workspaces**.

> **Stav:** Phase 1 (T1–T9) aj celá Phase 2 (moduly M0–M8) sú **implementované a
> nasadené** na produkčnom NAS-e. Jadro: monorepo, auth (email+heslo,
> invite-only), profily/média, rodinný Feed, real-time Chat (WhatsApp-úroveň:
> push, typing, read receipts, reakcie, prílohy), PWA (offline shell, install
> prompt). Nad tým Phase 2 moduly: Ankety, Albumy, Zoznamy/Poznámky, Kalendár
> (+ ICS), Denník (LLM), Hry (piškvorky 10×10 + AI súper, denná otázka, foto
> výzva), Svet okolo (RSS), Kvízy (LLM). Detail per modul:
> [`docs/MODULES_PLAN_PHASE2.md`](./docs/MODULES_PLAN_PHASE2.md). Otvorené:
> Passkey (T2b), feed virtualizácia, kvalita LLM obsahu — pozri
> `ARCHITECTURE_V2.md §13` (Odchýlky) a [`docs/DEPLOY_RUNBOOK.md` §9](./docs/DEPLOY_RUNBOOK.md).

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
dokonči registráciu → si admin. **Ďalších členov už pozývaš priamo z UI**
(po prihlásení ako admin → „Pozvať člena" → skopíruj vygenerovaný link).
Migrácie sa aplikujú automaticky pri štarte api.

## Users + Media (T3)

- **Profil**: úprava zobrazovaného mena, nahranie **avatara** (štvorcový 512×512).
- **Upload obrázkov**: `sharp` re-encode do WebP, **EXIF/GPS strip** (§9), `blurhash`
  placeholder, magic-byte kontrola (`file-type`), limit `MAX_IMAGE_MB` (default 50).
- **Úložisko**: lokálny FS pod `MEDIA_HOST_PATH` (na NAS napr. `/volume1/rodinna/media`),
  v DB len metadáta. Serve cez `GET /api/media/:id` (auth-gated, privátna sieť).
- Endpointy: `GET /api/users`, `GET /api/users/:id`, `PATCH /api/users/me`,
  `POST /api/users/me/avatar`, `POST /api/media`, `GET /api/media/:id`.

## Feed (T4)

- **Príspevky**: text (Markdown-ready) + až 10 fotiek, úprava/zmazanie (autor alebo admin).
- **Komentáre**: vnorené odpovede max do hĺbky 3 (depth 0–2), mazanie autor/admin.
- **Reakcie**: 6 emoji (👍❤️😂😮😢🙏), jedna reakcia na užívateľa/cieľ — klik na inú
  emoji ju nahradí, klik na rovnakú ju zruší (toggle).
- **Stránkovanie**: keyset (cursor) pagination, najnovšie prvé, tlačidlo „Načítať staršie".
- Rate limit: 20 príspevkov / 30 komentárov za minútu na užívateľa.
- Endpointy: `GET/POST /api/feed`, `PATCH/DELETE /api/feed/:id`,
  `GET/POST /api/feed/:id/comments`, `DELETE /api/feed/comments/:id`,
  `PUT /api/feed/reactions`.

## Chat (T6 — real-time jadro)

- **Real-time** cez natívne **Bun WebSockets** (pub/sub) na `/ws`, autentifikácia
  cez tú istú session cookie. Auto-reconnect klient (exp. backoff + heartbeat).
- **Miestnosti**: priame správy (DM, idempotentné — 1 na pár), skupiny a jedna
  spoločná „Rodina" (všetci členovia, zakladá sa automaticky).
- **Správy**: text + foto prílohy, **odpovede (reply)**, úprava/zmazanie (autor/admin,
  soft delete), **reakcie** (zdieľané so feedom), cursor pagination histórie.
- **Live signály**: typing indikátor, **online presence**, **read receipts** (✓✓ videné),
  neprečítané (badge), to všetko cez WS eventy.
- Rate limit: 60 správ / 20 miestností za minútu na užívateľa.
- Endpointy: `GET/POST /api/chat/rooms`, `GET /api/chat/rooms/:id`,
  `GET/POST /api/chat/rooms/:id/messages`, `POST /api/chat/rooms/:id/read`,
  `PATCH/DELETE /api/chat/messages/:id`, `PUT /api/chat/reactions`, WS `/ws`.
- E2E test (REST + WebSocket): `cd apps/api && bun scripts/test-chat.ts` (potrebuje
  bežiaci Postgres v `DATABASE_URL`).

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

Web + reverse proxy pre `/api`, `/ws` beží s profilom `edge` — interná appka
bez publikovaných host portov. TLS (Let's Encrypt) a doménové routovanie rieši
**zdieľaná NAS-wide edge vrstva** spoločná pre všetky appky na NAS (nielen
túto), cez externú Docker sieť `edge`:

```bash
cp .env.example .env     # nastav DOMAIN, PUBLIC_WEB_ORIGIN, POSTGRES_PASSWORD, atď.
docker compose --profile edge up -d --build
```

Kompletný postup — zdieľaná edge vrstva, Synology DDNS, port forwarding,
pripojenie tejto appky, pridanie ďalších appiek na NAS (napr. poznámky,
zápisník letov) — je v
[`docs/SYNOLOGY_DOMAIN_ACTIVATION.md`](./docs/SYNOLOGY_DOMAIN_ACTIVATION.md).

**Nasadenie Phase 2** (tajomstvá VAPID/ICS/LLM, poradie mergovania PR, prvý
štart, smoke checklist, zálohovanie a **restore drill**) —
krok za krokom v [`docs/DEPLOY_RUNBOOK.md`](./docs/DEPLOY_RUNBOOK.md).

## Roadmap

Pozri `ARCHITECTURE_V2.md §13` a [`docs/MODULES_PLAN_PHASE2.md`](./docs/MODULES_PLAN_PHASE2.md).
Hotové: **T1–T9 (Phase 1 jadro) + M0–M8 (Phase 2 moduly).**
Otvorené: T2b (Passkey), feed virtualizácia, diary push po manuálnom zápise,
kvalita LLM obsahu (denník, kvízy) — pozri [`docs/DEPLOY_RUNBOOK.md` §9](./docs/DEPLOY_RUNBOOK.md).
