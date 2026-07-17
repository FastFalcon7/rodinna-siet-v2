# Rodinná Sieť v2 — Architektonický návrh

> **Stav dokumentu:** referenčný architektonický návrh — **implementované a nasadené**
> (júl 2026). Phase 1 (T1–T9) aj celá Phase 2 (moduly M0–M8, `docs/MODULES_PLAN_PHASE2.md`)
> bežia na produkčnom NAS-e. §13 a §15 nižšie odzrkadľujú aktuálny stav vrátane
> odchýlok od pôvodného návrhu.
> **Cieľová kódová báza:** nové repo `rodinna-siet-v2` (tento dokument je referencia z prototypu v1).

---

## 1. Kontext a cieľ

Existujúci prototyp (React 19 + Firebase, ~9,6 K riadkov, verzia v0006) je funkčný, ale ako celok nedostačujúci. Začíname **odznova**, bez fixácie na pôvodný kód.

**Cieľ:** privátna **rodinná sociálna sieť pre max 10 užívateľov**, ktorá:

1. beží **100 % self-hosted na Synology DS925+ (32 GB RAM)** — žiadny cloud, žiadny Firebase,
2. je **moderná a užívateľsky konkurencieschopná** voči mainstreamu (WhatsApp, iMessage),
3. má **všetky bežne očakávané funkcionality** sociálnej siete,
4. je **modulárna** — umožňuje pridávať ďalšie moduly bez zásahu do jadra,
5. je **LLM-ready** — pripravená na lokálny LLM bežiaci na NAS.

**Prvá fáza:** Login + **Feed** + **Chat**. Chat musí byť užívateľsky **na úrovni WhatsApp** (push notifikácie na zamknutej obrazovke, real-time, typing indicators, reakcie, attachments).

**Druhá fáza:** Notes/ToDo, Photo Albums, Personal Diary (s LLM), hry/kvízy/krížovky/piškvorky (s LLM).
Detailný implementačný plán Phase 2 (poradie modulov, integračný kontrakt s Feedom/Chatom, harmonogram): **`docs/MODULES_PLAN_PHASE2.md`**.

---

## 2. Zafixované rozhodnutia (vstupy od užívateľa)

| Téma | Rozhodnutie | Dôsledok pre architektúru |
|---|---|---|
| Backend hosting | 100 % self-hosted na NAS | žiadny Firebase/cloud, všetko v Dockeri na NAS |
| NAS | Synology **DS925+**, 32 GB RAM | CPU **AMD Ryzen = x86_64** → natívne Docker image pre Bun/Postgres/Ollama; **bez GPU** → LLM beží na CPU (malé kvantované modely 3B–8B Q4) |
| Externý prístup | verejný HTTPS cez Synology DDNS + reverse proxy | Caddy auto-TLS (Let's Encrypt) |
| Doména | na začiatok **`*.synology.me`**, vlastná možná neskôr | zmena domény = 1 riadok v Caddyfile + DNS, bez refactoru |
| Frontend | **PWA** (Add-to-Home-Screen), Capacitor-ready fallback | jeden codebase pre PC/iPhone/iPad/Android |
| Push notifikácie | **kritické**, ako WhatsApp na lock screen iPhone | Web Push / VAPID (iOS 16.4+ cez nainštalovanú PWA) |
| LLM | Phase 1 neimplementovala, API vrstva bola pripravená vopred | implementované v Phase 2 (M5 Denník, M8 Kvízy); OpenAI-kompatibilný adaptér, prepínateľný cez `LLM_BASE_URL`/`LLM_MODEL` |
| Repo | úplne **nové repo `rodinna-siet-v2`** | starý prototyp ostáva len ako referencia |

---

## 3. Zvažované varianty architektúry

### Variant A — Pragmatický: Node.js + Fastify + Postgres + Socket.IO
- **Výhody:** najväčšia komunita, JS-natívny web-push ekosystém, ľahký onboarding.
- **Nevýhody:** vyššia pamäťová stopa, Node WS server pre 10 userov zbytočne ťažký.
- **Náročnosť vývoja:** 2/5. **Výkon na NAS:** výborný (~150 MB app).

### Variant B — Moderný/výkonný: Bun + Hono + Postgres + natívne WS ⭐ ODPORÚČANÝ
- **Výhody:** Bun WS ~3× rýchlejší než Node, natívny TS bez build kroku, Hono RPC = end-to-end typesafe (frontend dostáva typy backendu zadarmo), jediný runtime od build-toolu po server.
- **Nevýhody:** mladší ekosystém (niektoré low-level libs ešte nemajú Bun-natívne buildy).
- **Náročnosť vývoja:** 2/5. **Výkon na NAS:** vynikajúci (~80 MB app), najlepšie latencie chatu.

### Variant C — Minimalistický: Bun/Elysia + SQLite + SSE
- **Výhody:** zero-config DB, jeden proces, triviálny backup (kópia `db.sqlite`), štart < 200 ms.
- **Nevýhody:** SQLite + WS zápisy potrebujú WAL + opatrné transakcie; `sqlite-vec` má menej featur než `pgvector`; horšie škáluje pre RAG.
- **Náročnosť vývoja:** 1/5. **Výkon na NAS:** najnižšia stopa (~60 MB total).

---

## 4. Odporúčaný variant: **B (Bun + Hono + Postgres)** s prvkami C

**Zdôvodnenie:**
- 10 užívateľov nepotrebuje horizontálne škálovanie, ale potrebuje **nízku latenciu chatu** — tam Bun WS exceluje.
- **Postgres (nie SQLite)** kvôli `pgvector` pre Phase 2 (RAG diary, sémantické vyhľadávanie), `LISTEN/NOTIFY` pre synchronizáciu s worker procesmi, robustný backup (`pg_dump`).
- **Hono RPC** = end-to-end typesafe → dramaticky menej chýb pri pridávaní modulov.
- Jediný TS runtime zjednodušuje workflow pre solo developera.
- Z variantu C preberáme **jednoduchú DB-based job queue** (žiadny Redis pre 10 userov).

### Kompletný tech stack

**Backend (`apps/api`)**
| Vrstva | Voľba |
|---|---|
| Runtime | Bun 1.2 (TypeScript) |
| HTTP framework | Hono (+ RPC client zdieľaný s web) |
| Databáza | PostgreSQL 16 + `pgvector` |
| ORM / migrácie | Drizzle |
| Real-time | natívne Bun WebSockets (pub/sub) |
| Storage | lokálny FS `/volume1/rodinna/media` + presigned URL endpoint |
| Obrázky | `sharp` (resize, re-encode, EXIF strip) + blurhash |
| Push | `web-push` (VAPID) vo worker procese |
| Auth | Lucia v3 + argon2id + Passkey (WebAuthn) + invite tokeny |
| Rate limit | `@hono/rate-limiter` |
| Validácia | Zod (zdieľané schémy) |

**Frontend (`apps/web`)**
| Vrstva | Voľba | Prečo |
|---|---|---|
| Build/Framework | Vite 7 + React 19 | SSR netreba (authenticated app), rýchly dev server |
| Routing | TanStack Router | typesafe, file-based, vhodné pre nested moduly |
| Komponenty | shadcn/ui (Radix primitives) + custom theme | full control, žiadny lock-in |
| Styling | Tailwind CSS 4 + CSS variables | dark/light cez `data-theme` |
| Server state | TanStack Query | cache + optimistické updaty |
| UI state | Zustand (+ Jotai pre chat draft) | žiadny Redux |
| Real-time klient | Hono RPC client + `partysocket` | auto-reconnect / backoff |
| Forms | TanStack Form + Zod | typesafe s backendom |
| PWA | `vite-plugin-pwa` + Workbox | Add-to-Home-Screen, offline shell |
| Push | Web Push API + service worker; Capacitor 6 fallback | iOS 16.4+ |
| Animácie | Motion (Framer Motion v11) + View Transitions API | mikroanimácie, route transitions |
| Virtualizácia | react-virtuoso | Feed + Chat (prevzaté z v1) |
| Obrázky | `@unpic/react` + blurhash | bez CLS |
| i18n | paraglide-js | slovenčina default |

**Pomocné knižnice pre WhatsApp-level polish:** Aceternity UI (animované komponenty), Sonner (toasts), vaul (iOS bottom sheets), cmdk (Cmd+K palette), emoji-mart, react-zoom-pan-pinch.

---

## 5. Modulárna ("plugin-ready") štruktúra

```
apps/
  api/                       (Bun + Hono)
    src/
      modules/
        auth/                kernel (povinný)
        users/               kernel
        media/               kernel (používa každý modul)
        notifications/       kernel (web-push)
        feed/                Phase 1
        chat/                Phase 1
        notes/               Phase 2
        albums/              Phase 2
        diary/               Phase 2
        games/               Phase 2
        llm/                 kernel pre Phase 2
      core/
        db/                  Drizzle schema + migrácie
        events/              interný EventBus + Postgres LISTEN/NOTIFY
        permissions/         RBAC (admin / member)
        rpc/                 Hono app root, kompozícia routerov
      worker/                push fan-out, async LLM jobs (Postgres queue)
  web/                       (Vite + React PWA)
    src/
      modules/               mirror backend modulov, lazy-loaded routes
      shared/
        components/          shadcn + custom (LazyImage, MediaViewer, CommandPalette)
        hooks/               useOnlineStatus, useTyping, usePushSubscription
      app/                   router, providers, layout
packages/
  shared-types/              Zod schémy zdieľané API ↔ web
  ui/                        design system tokens
```

**Plugin kontrakt (backend):**
```ts
export const module = {
  name: 'notes',
  router: notesRouter,        // Hono sub-app, mount na /api/notes
  migrations: [...],          // Drizzle migrations
  events: { subscribes: [], emits: ['note.created'] },
  permissions: ['notes.read', 'notes.write'],
  llmTools?: [...]            // pre Phase 2 LLM function-calling
}
```

**Plugin kontrakt (frontend):**
```ts
export const module = {
  name: 'notes',
  route: '/notes',
  navItem: { icon, label: 'Poznámky' },
  lazyComponent: () => import('./Page'),
  commandPaletteCommands: [...]
}
```

Phase 2 moduly sa pridávajú cez `register(module)` v `app.ts` — **bez zásahu do core**.

---

## 6. LLM-ready API vrstva

```
                    ┌────────────────────────┐
   Frontend ───────▶│ /api/llm/* (Hono)      │── streaming SSE
                    │  - chat/completions    │
                    │  - embeddings          │
                    │  - jobs (async)        │
                    └──────────┬─────────────┘
                               │ OpenAI-compatible JSON
                               ▼
                    ┌────────────────────────┐
                    │ LLM Provider Adapter   │ (interface)
                    └──────────┬─────────────┘
              ┌────────────────┼──────────────┐
              ▼                ▼              ▼
        Ollama (local)   llama.cpp server   OpenAI (fallback)
        :11434           :8080              api.openai.com
```

- **Endpoint:** `/api/llm/chat/completions` mirror OpenAI spec → zameniteľný backend cez `LLM_BASE_URL`.
- **Streaming:** SSE (kompatibilné s `EventSource` v PWA, jednoduchšie debugovanie než WS).
- **Async jobs:** dlhé úlohy (generovanie kvízu, súhrn denníka) → Postgres tabuľka `pg_jobs`; worker spracuje, notifikuje cez WS event + Web Push.
- **Modely:** bind-mount `/volume1/rodinna/ollama/models`. Štart: `llama3.2:3b-instruct-q4_K_M`
  (~2 GB, CPU-friendly) + `nomic-embed-text`. **Prevádzková skúsenosť:** 3B model je pre
  faktické úlohy (kvízy, súvislý denníkový text) príliš slabý (halucinácie, nezmyselné
  otázky). Na NAS-e s 32 GB RAM sa dá vymeniť za `qwen2.5:7b-instruct-q4_K_M`
  (nastavením `LLM_MODEL` v `.env`, bez zásahu do kódu) — kvalita o niečo lepšia, ale
  stále nie spoľahlivá; navyše tento model vracia otázky ako **JSON Lines** namiesto
  JSON poľa, na čo si parser v `apps/api/src/modules/quiz/service.ts` (`extractQuestions`)
  musel dať pozor. Otvorená téma: buď väčší lokálny model (14B+, pomalšie na CPU), alebo
  cloud LLM API pre kvízy/denník — pozri Odchýlky nižšie.
- **Vector DB:** `pgvector` v tej istej Postgres (žiadny Qdrant kontajner navyše).

---

## 7. Dátový model (Phase 1)

```
users         (id, email, display_name, avatar_url, role, created_at, last_seen_at, push_pref_json)
sessions      (id, user_id, refresh_token_hash, user_agent, ip, expires_at)
push_subs     (id, user_id, endpoint, p256dh, auth, device_label, created_at)

posts         (id, author_id, body_md, visibility, created_at, edited_at, deleted_at)   -- [T4] deleted_at = soft delete
post_media    (id, post_id, media_id, order)
comments      (id, post_id, parent_comment_id, author_id, body_md, depth, created_at, edited_at, deleted_at)
              -- [T4] depth (0-2) = server-side vynútenie max hĺbky 3; deleted_at = soft delete (deti neosirotia)
reactions     (id, target_type ENUM('post','comment','message'), target_id, user_id, emoji, created_at)
              -- [T4] UNIQUE(target_type, target_id, user_id): 1 reakcia/užívateľ/cieľ, toggle sémantika

chat_rooms    (id, kind ENUM('dm','group','family'), title, avatar_url, created_at)
room_members  (room_id, user_id, role, joined_at, last_read_message_id, muted_until)
messages      (id, room_id, author_id, body_md, reply_to_id, created_at, edited_at, deleted_at)
message_media (id, message_id, media_id, order)
typing_state  (room_id, user_id, started_at)   -- ephemeral, môže byť in-memory

media         (id, owner_id, kind, mime, bytes, width, height, duration_ms,
               storage_path, blurhash, sha256, created_at)

notifications (id, user_id, kind, payload_json, read_at, created_at)
audit_log     (id, actor_id, action, entity, entity_id, meta_json, created_at)
```

**Phase 2 pridáva:** `notes`, `note_embeddings`, `albums`, `album_photos`, `diary_entries`, `game_sessions`,
`diary_fragments`, `user_news_prefs`, `news_items` (§15).

---

## 8. Auth (odporúčaný tok)

**Email + heslo (argon2id) + Passkey (WebAuthn) ako alternatíva/2. faktor**, postavené na **Lucia v3** primitivách.

1. Admin vygeneruje **invite token** (UUID, 7 dní platný) z whitelistu emailov.
2. Pozvaný klikne link → registruje email+heslo **alebo** rovno Passkey (Face ID / Windows Hello).
3. Session = **opaque token** v `HttpOnly; Secure; SameSite=Lax` cookie, refresh rotation.
4. **Bez JWT** — pre 10 userov je session-v-DB jednoduchšia a revokovateľná.

> Magic link sa nepoužíva (SMTP setup na NAS + spam riziko bez SPF/DKIM). Keycloak/Authentik = over-engineering (overhead 500 MB+).

---

## 9. Bezpečnosť (kritická, lebo verejné HTTPS)

- **TLS:** Caddy auto Let's Encrypt pre `rodinna.<doména>.synology.me`.
- **Whitelist + invite-only** registrácia (tabuľka `allowed_emails` / invite token).
- **Rate limiting:** login 5/min/IP, API 100/min/user, upload 10/min/user.
- **CORS:** striktný origin allowlist. **CSP:** `default-src 'self'; img-src 'self' data: blob:; connect-src 'self' wss://...`.
- **File upload:** `file-type` magic-byte check, max 50 MB foto / 200 MB video, `sharp` re-encode + **EXIF strip (GPS!)**.
- **Heslá:** argon2id, min 10 znakov, offline HIBP check.
- **fail2ban** na DSM, audit log pre admin akcie.
- **Backup:** denný `pg_dump` cez Hyper Backup, šifrovaný.

---

## 10. UX / vizuálna stratégia

**Smer:** *"Calm iMessage + Linear sharp"* — čisté, nadčasové, jemný glassmorfizmus iba v nav baroch (`backdrop-blur-xl`), flat content (žiadne neóny/neo-brutalizmus).

| Prvok | Detail |
|---|---|
| Typografia | Inter Variable + Geist Mono; line-height 1.55 pre feed |
| Farby | OKLCH paleta (warm coral + deep teal), neutrálny grey 50–950 |
| Theming | `data-theme="light/dark"`, auto podľa `prefers-color-scheme` + manuálny override |
| Chat bubliny | iMessage-like tail bubbles, per-user `accentColor` |
| Mikroanimácie | reakcie "pop" (spring), typing dots, message arrive bounce, swipe-to-reply |
| Transitions | View Transitions API (route change), FLIP (reorder feedu) |
| Feedback | haptika cez Vibration API + Capacitor Haptics |
| Empty states | ilustrované, hravé (rodinný motív — strom, dom, srdce) |
| Command Palette | `Cmd/Ctrl+K`, fuzzy cez `cmdk`; voice (Web Speech API) pre Phase 2 LLM |
| Onboarding | 3-krokový welcome (avatar, push permission, prvý príspevok) |
| Loading | shadcn `Skeleton`, content-aware shapes |
| A11y | Radix primitives = AA-compliant, VoiceOver test |

---

## 11. UX patterny prevzaté z prototypu v1

| v1 pattern | v2 implementácia |
|---|---|
| `OnlineStatusContext` (`src/contexts/OnlineStatusContext.js`) | `useOnlineStatus` + Zustand + TanStack Query `onlineManager` |
| `CommandPalette` (Cmd+K) | `cmdk` + per-modul `registerCommands()` |
| `InfiniteScrollFeed` (react-virtuoso) | react-virtuoso + TanStack `useInfiniteQuery` |
| `TypingIndicator` | WS event `chat:typing`, 3 s debounce, ephemeral |
| Nested comments | rekurzívny `<Comment>`, `parent_comment_id`, max hĺbka 3 |
| `LazyImage` / `MediaViewer` | `@unpic/react` + blurhash + react-zoom-pan-pinch |

---

## 12. Deployment na Synology DS925+

**Package Center:** Container Manager, Hyper Backup, DDNS.

**Štruktúra na NAS:**
```
/volume1/rodinna/
  compose/docker-compose.yml
  caddy/{Caddyfile, data}      certs
  postgres/                    data volume
  media/                       user uploads (bind-mount)
  ollama/                      modely (Phase 2)
  backups/
```

**Compose služby:** `caddy` (80/443) → `api` (Bun, :3000) + `worker` + `postgres` (+ `uptime-kuma`; + `ollama` v Phase 2).

**Caddyfile (skica):**
```
rodinna.tvojadomena.synology.me {
  encode zstd gzip
  @api path /api/* /ws
  reverse_proxy @api api:3000
  root * /srv/web
  try_files {path} /index.html
  file_server
}
```

> **Pozn.:** Vyhnúť sa DSM built-in reverse proxy (Control Panel → Login Portal) — DSM update prepisuje nginx config. Caddy v Dockeri je čistejší.

> **Aktuálny stav (viď `docs/SYNOLOGY_DOMAIN_ACTIVATION.md`):** Caddy z tohto repa TLS/doménu už nerieši priamo — beží interne za zdieľanou NAS-wide edge vrstvou (samostatný Caddy na 80/443, externá Docker sieť `edge`), spoločnou pre všetky appky na NAS. Umožňuje to pridávať ďalšie appky (poznámky, zápisník letov,…) bez kolízie o porty 80/443.

**Backup:** denný `pg_dump` o 3:00 → `/backups/db-YYYY-MM-DD_HHMMSS.dump`; Hyper Backup týždenne na externý USB; mesačne na Synology C2 / Backblaze B2. Retencia 7d/4w/12m. **Restore drill povinný.** Konkrétne skripty a postup: [`infra/backup/backup.sh`](infra/backup/backup.sh), [`infra/backup/restore.sh`](infra/backup/restore.sh), runbook [`docs/DEPLOY_RUNBOOK.md`](docs/DEPLOY_RUNBOOK.md) §5–6.

**Monitoring:** Uptime Kuma (endpoint checks + Telegram alert), Glances (CPU/RAM), Caddy structured logs.

---

## 13. Roadmap (10 týždňov, indikatívne)

| Týždeň | Cieľ |
|---|---|
| **T1** ✅ | monorepo skeleton (Bun workspaces), Caddy + Postgres + Bun "hello", deploy na NAS, HTTPS funguje |
| **T2a** ✅ | Auth modul (email+heslo argon2id + invite-only), prvé prihlásenie cez verejnú URL. *(T2b Passkey odložené)* |
| **T3** ✅ | Users + Media (upload, sharp, blurhash, EXIF strip), avatary |
| **T4–5** | Feed (posty, reakcie, komentáre, ~~infinite scroll~~). **Jadro ✅ overené na NAS-e.** Zostáva: virtualizácia (react-virtuoso + TanStack `useInfiniteQuery`) — viď Odchýlky nižšie a §14.5 |
| **T6** ✅ | Chat — **real-time jadro**: natívne Bun WebSockets (pub/sub), DM + skupiny + „Rodina", typing, online presence, read receipts, reakcie + odpovede na správach, foto prílohy, cursor pagination. **Overené E2E (36/36) + browser smoke (2 prehliadače, real-time).** |
| **T7** ✅ | Chat — push notifikácie (web-push/VAPID + worker + pg_jobs queue, `docs/MODULES_PLAN_PHASE2.md` M0-1/M0-2), notifications kernel (in-app + per-druh preferencie), registry-driven app shell (M0-3). *Hlasovky presunuté do M5 (prepis Whisperom); živé karty (M0-4) nasledujú.* |
| **T8** ✅ | PWA polish — offline app shell (service worker network-first navigácie, cache-first hashované assety), install prompt, command palette |
| **T9** ✅ | Security audit, rate limiting (sken všetkých mutačných endpointov Phase 2 modulov), **restore drill** |
| **T10+** ✅ | Phase 2 moduly + LLM integrácia — **kompletne implementované, moduly M0–M8:** `docs/MODULES_PLAN_PHASE2.md`. Kvalita LLM obsahu (kvízy, denník) ostáva otvorená téma — viď Odchýlky nižšie. |

### Odchýlky implementácie oproti návrhu (živý zoznam)

| Oblasť | Návrh | Realita | Dôvod |
|---|---|---|---|
| Feed scroll | react-virtuoso + TanStack `useInfiniteQuery` | tlačidlo „Načítať staršie" + `useState`, cursor (keyset) pagination na BE | max 10 užívateľov, nízky objem; minimum závislostí. **Dlh:** §14.5 (500 postov) zatiaľ nesplnené |
| Routing | TanStack Router | tab state v `Home.tsx` (Feed ↔ Profil) | netreba file-based routing pri 2 obrazovkách |
| Server state (web) | TanStack Query | natívny `fetch` + lokálny `useState` | zatiaľ bez cache vrstvy; pridá sa keď začne byť potrebná |
| Komentáre | `(…, body_md, created_at)` | + `depth`, `edited_at`, `deleted_at` | vynútenie hĺbky a soft delete |
| Reakcie | bez constraintu | `UNIQUE(target_type,target_id,user_id)` + toggle | 1 reakcia/užívateľ/cieľ |
| Email pozvánok | — | linky **neposiela** žiadny SMTP; admin ich kopíruje ručne z UI | zámerne (§8), žiadna SMTP závislosť |
| Real-time klient (web) | `partysocket` | vlastná `ChatSocket` trieda (reconnect + exp. backoff + heartbeat) | ~80 riadkov, žiadna závislosť navyše |
| Chat prílohy | foto **aj video** | zatiaľ **len foto** (cez existujúci `media` pipeline) | video = samostatný slice (T7): upload path + HTTP range serving + prehrávač/poster |
| Chat push | web-push/VAPID v T6 | **odložené na T7** | push na lock screen sa reálne overí až s PWA (T8); WS protokol je forward-compatible |
| Read receipts | — | `room_members.last_read_at` nastavený priamo v SQL z `messages.created_at` | round-trip cez JS `Date` orezáva µs → vlastná správa by vyšla ako neprečítaná |
| Denník — push po manuálnom zápise | notifikácia pri každom novom zápise | tlačidlo „Vygenerovať dnešný zápis" **nepošle** push; pošle ho len automatický nočný beh (`diary.daily`→`diary.notify`) | zistené pri reálnom testovaní na NAS-e (júl 2026), zatiaľ neopravené — odložené |
| Kvalita LLM obsahu (M5 Denník, M8 Kvízy) | koherentný text / fakticky správne kvízy | `llama3.2:3b-instruct-q4_K_M` halucinuje (nezmyselný text, faktické chyby); `qwen2.5:7b-instruct-q4_K_M` o niečo lepší, ale stále chybný obsah (preklepy, zlé možnosti, miešanie jazykov) | limit malého kvantovaného modelu na CPU-only NAS-e bez GPU; otvorené — buď väčší lokálny model (14B+, pomalší), alebo cloud LLM API len pre tieto dve funkcie (mení privacy-model pre denník, kvíz je menej citlivý) |
| AI vypínač (Denník, Hry — otázka dňa/týždňa, Kvízy) | voľba per zariadenie (`localStorage`) | globálne serverové nastavenie (`app_settings`), mení **výhradne admin** (`PUT /api/settings/ai`, 403 pre člena); predvolene vypnuté | pôvodná voľba len skrývala UI na danom zariadení — worker ďalej generoval obsah (napr. otázku dňa) pre celú rodinu, aj keď si to niekto lokálne „vypol" |
| Video prílohy na iPhone | transkód (H.264/AAC) + podpísaný token v URL malo zaručiť prehrateľnosť | príčina nájdená (júl 2026): Hono `c.body(stream)` posielal 206 bez `Content-Length` (chunked) a stream zo `slice()` neukončil spojenie → iOS AVFoundation probe `bytes=0-1` timeoutol; opravené — telo ide ako BunFile/Blob priamo do `Response` | detailný rozbor v `docs/DEPLOY_RUNBOOK.md` §9 |

---

## 14. Verifikácia (end-to-end akceptačné kritériá)

1. **HTTPS:** z mobilnej siete načítať `https://rodinna.<doména>.synology.me/health` → 200 OK s platným Let's Encrypt certom.
2. **Auth E2E:** na druhom zariadení akceptovať invite, prihlásiť sa Passkey, session prežije reload.
3. **Real-time chat:** 2 zariadenia v rôznych sieťach, latencia < 300 ms, typing indicator viditeľný.
4. **Push:** iPhone s nainštalovanou PWA, vypnutá obrazovka → správa z druhého zariadenia → notifikácia na lock screen.
5. **Feed perf:** 500 syntetických postov, react-virtuoso scroll plynulý na iPad Mini 5.
6. **Restore drill:** vymazať `postgres` volume, obnoviť z `pg_dump` → všetky dáta späť.
7. **LLM-ready:** dummy `/api/llm/chat/completions` vracia stream s mock odpoveďou (Phase 1 acceptance).
8. **Bezpečnosť:** rate limiter test (curl loop), EXIF strip overený `exiftool` na uploadnutej fotke.

---

## 15. Use cases pre Local LLM (Phase 2, odporúčané a zrealizovateľné)

> Záver diskusie o reálnom využití LLM na CPU-only hardvéri (DS925+, 32 GB RAM, žiadne GPU).
> Princíp: **real-time chat/feed nikdy nečaká na LLM.** LLM beží buď (a) ako krátky
> interaktívny dotaz so SSE streamingom, alebo (b) ako async job vo `pg_jobs` queue,
> ktorý dobehne na pozadí (typicky v noci) a notifikuje cez WS/push, keď je hotový.
> Ollama na CPU spracúva požiadavky prakticky sériovo → worker používa jeden semafór,
> nikdy paralelné inferencie. Interaktívne funkcie používajú malý model (`3B Q4`),
> dávkové joby môžu použiť väčší (`7–8B Q4`), pretože nezáleží na latencii.

### 15.1 Prehľad use cases

| Use case | Typ | Model | Poznámka |
|---|---|---|---|
| Týždenný/denný digest aktivity | async job | 3B | zhrnutie feedu/chatu, push notifikácia |
| Sémantické vyhľadávanie (feed/chat) | interaktívne | embedding (`nomic-embed-text`) | `pgvector`, nájde aj bez presnej zhody slov |
| Chat assistant (`@asistent`) s function-calling | async job + WS update | 3B | využíva `llmTools` kontrakt modulov (napr. vytvorenie ToDo) |
| Extrakcia eventov zo správ | async job | 3B | len návrh, nikdy automatická nezvratná akcia |
| "Spomínaš si?" pripomienky | async job (periodický) | 3B | z `diary_entries`/`album_photos`, na základe dátumu |
| Personalizované kvízy z rodinnej historie | async job (na vyžiadanie) | 3B–7B | z anonymizovaných faktov diary/album popiskov |
| Auto-tagging fotiek | nočný batch | malý VLM (napr. Moondream) | nikdy pri uploade, len batch |
| Prepis hlasových správ | takmer real-time | Whisper.cpp tiny/base | nie je LLM, ale rovnaký CPU rozpočet |
| **Osobný denník s LLM** | async job (denný) | 3B–7B | detail nižšie §15.2 |
| **Svet okolo (správy podľa záujmov)** | async job (denný) | 3B | detail nižšie §15.3 |

### 15.2 Osobný denník — detailný návrh

**Zber fragmentov.** Užívateľ priebežne pridáva krátke záznamy (veta, foto, nálada,
hlasovka) cez "quick capture" UI — nie je to plnohodnotný editor:

```
diary_fragments (id, user_id, body, source ENUM('manual','feed','chat'),
                  source_ref_id, created_at)
```

**Nočný job (per user, per deň).** Worker o 23:30 vezme:
- `diary_fragments` daného užívateľa za deň,
- jeho **vlastné** posty z Feedu a **vlastné** odoslané správy z Chatu
  (cudzí obsah z DM iných ľudí sa nezahŕňa, pokiaľ to užívateľ explicitne nepovolí
  per-room nastavením),

a poskladá prompt: *"Tu sú surové poznámky a aktivita jedného človeka za deň. Napíš
z toho súvislý text osobného denníka v 1. osobe, slovensky, teplý a osobný tón.
Nepridávaj fakty, ktoré tam nie sú."* Pri prázdnom dni (žiadne fragmenty/aktivita)
job nevytvára draft z ničoho.

**Draft + review (human-in-the-loop, povinné).** Výsledok sa uloží ako návrh, nie
finálny záznam. Užívateľ ho ráno potvrdí alebo upraví — toto je nutný krok proti
halucináciám (LLM si nesmie v osobnom denníku domýšľať udalosti, ktoré sa nestali).

**Embedding.** Po potvrdení sa text embedduje (`nomic-embed-text`) do
`note_embeddings` → umožňuje "Spomínaš si?" pripomienky a sémantické vyhľadávanie
v denníku.

**Privacy default:** len vlastný obsah užívateľa, zahrnutie skupinového chat
kontextu je opt-in per room/per užívateľ.

### 15.3 Svet okolo — správy podľa preferencií

Jediné miesto v architektúre, kde je potrebné **výstupné** pripojenie na internet —
lokálny LLM nepozná aktuálne dianie, dostáva len to, čo mu dodá fetch krok. Ide
výhradne o jednosmerné čítanie verejných RSS feedov, žiadne rodinné dáta nikam
neodchádzajú.

```
user_news_prefs (user_id, category ENUM('sport','politika','technologie','kultura',...))
news_items       (id, category, title, snippet, source, url, published_at)
```

- **RSS aggregator job** (bez LLM, čisto sieťový fetch) 2× denne stiahne kurátorované
  feedy per kategória, uloží len titulok + krátky snippet (1-2 vety) + link + dátum
  (copyright: nikdy celý článok, rovnaká prax ako napr. FreshRSS).
- **Diary job rozšírenie:** pri generovaní denníka sa pre kategórie, ktoré má
  užívateľ nastavené, doplní do promptu 5–10 dnešných titulkov a inštrukcia: *"Na
  záver denníka doplň krátky odsek 'Svet okolo' — 2-3 vety, použi LEN tieto
  informácie, nič si nedomýšľaj."*
- **UI:** sekcia "Svet okolo" je vizuálne oddelená od osobnej časti (iný štýl/farba),
  aby bolo jasné, že ide o objektívny prehľad, nie súčasť osobného príbehu.
- **Default:** vypnuté pri registrácii, opt-in s výberom kategórií.
- **Firewall:** výstupné HTTPS na RSS zdroje treba explicitne povoliť, zvyšok appky
  zostáva offline-schopný.
