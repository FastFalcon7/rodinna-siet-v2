# Design review — prvý draft Feed + Chat (júl 2026)

> **Vstup:** 4 screenshoty z testu na NAS (10.7.7.243) — 2× aktuálny draft (Feed, Chat),
> 2× referencia Bluesky. Vzory: **Feed = Bluesky, Chat = WhatsApp.**
> **Súvisí s:** ARCHITECTURE_V2.md §10 (UX/vizuálna stratégia), §5 (modulárna štruktúra).

---

## 0. Dôležité zistenie pred samotným review

Testovaný draft (taby Feed / Chat / Profil a rodina, composer, chat bubliny) **nie je
v repe** — `main` končí pri T2a (Auth) a `Home.tsx` je stále prázdna domovská obrazovka.
Draft beží z lokálneho kódu na NAS.

**Akcia:** pushni draft do repa (feature vetva, napr. `feat/t4-feed-draft`), inak sa
k nemu nedá robiť code review, opravy ani nasadenie cez CI. Všetky odporúčania nižšie
sú formulované tak, aby sa dali aplikovať na draft aj na čistú T4/T6 implementáciu.

---

## 1. Zhrnutie problémov z testu (potvrdené zo screenshotov)

| # | Problém | Dôkaz na screenshote | Závažnosť |
|---|---|---|---|
| P1 | Hlavička + tab bar zaberajú ~30 % výšky displeja | Feed aj Chat: „Ahoj, iphone 👋" blok + veľký tab prepínač nad obsahom | vysoká |
| P2 | Dlhé texty (URL) pretekajú z okna | Chat: coral bublina s URL odrezaná na pravej hrane; foto príloha vyteká mimo viewport | vysoká (bug) |
| P3 | Linky sú surový text, žiadny náhľad | Feed: post = holé URL bez OG karty; Bluesky ukazuje kartu s titulkom | stredná |
| P4 | Prílohy len „Foto" | Feed composer: jediné tlačidlo Foto; Chat: len spinka | stredná |
| P5 | Reakcie neintuitívne | Feed: textové tlačidlo „+ reakcia"; Chat: reakcie chýbajú úplne | stredná |
| P6 | Menu neškáluje | 3 taby v hlavičke; Phase 2 pridá Notes, Albums, Diary, Games → 7+ položiek | vysoká (architektúrna) |
| P7 | Chat nemá vlastnú obrazovku | Chat je vnorená karta pod hlavičkou + tabmi → málo miesta pre správy | vysoká |
| P8 | Feed je „karta v karte" | Posty sú boxy s rámikom vnútri boxu → strata šírky, vizuálny šum | stredná |

---

## 2. App shell — nová kostra obrazoviek (rieši P1, P6, P7)

Vzor Bluesky: identita používateľa **nepatrí do hlavičky každej obrazovky**.
Hlavička má byť tenká a kontextová, navigácia dole.

### 2.1 Bottom navigation (mobil) namiesto tabov v hlavičke

```
┌──────────────────────────────┐
│ ◉ Rodinná sieť        🔔  ⌕ │  ← app bar 52 px, backdrop-blur, skryje sa pri scrolle dole
├──────────────────────────────┤
│                              │
│         obsah modulu         │
│                              │
├──────────────────────────────┤
│  🏠      💬      📷      ☰  │  ← bottom nav 56 px + safe-area-inset-bottom
│ Feed    Chat   Albumy  Viac │
└──────────────────────────────┘
```

- **4 fixné sloty + „Viac"**: Feed, Chat (s badge počtu neprečítaných), najbližší
  Phase 2 modul, „Viac" = bottom sheet (vaul) so zvyšnými modulmi, profilom,
  nastaveniami a odhlásením. Presne toto rieši plugin kontrakt `navItem` z §5 —
  moduly sa registrujú do bottom navu / sheetu, nie do hlavičky.
- **„Ahoj, meno + email + rola + Odhlásiť" sa presúva** do „Viac" → Profil.
  Na hlavnej obrazovke z identity zostáva len avatar (tap → profil).
- **Desktop/tablet (≥ 768 px):** bottom nav sa mení na ľavý sidebar (ikona + label),
  obsah max-width ~640 px v strede — presne layout Bluesky na webe.
- **Auto-hide:** app bar sa pri scrolle nadol schová (translateY), pri scrolle nahor
  vráti — obsah dostane celý viewport. Bottom nav zostáva vždy.

### 2.2 Chat = plnohodnotná obrazovka, nie karta

Konverzácia sa otvára ako **samostatná routa** (`/chat/:roomId`) cez celý viewport:

```
┌──────────────────────────────┐
│ ←  ◉ Stefan        📞?  ⋮   │  ← 52 px: späť, avatar, meno, online/naposledy
├──────────────────────────────┤
│        ── streda 25. 6. ──   │  ← date separator
│ ┌────────────┐               │
│ │ perfektne  │ 17:22         │  ← cudzia bublina, vľavo, max-width 78 %
│ └────────────┘               │
│         ┌──────────────────┐ │
│         │ shop.everything… │ │  ← vlastná bublina, vpravo, coral
│         │ [OG karta linku] │ │
│         └──────── 17:24 ✓✓ ┘ │  ← čas + doručenky v bubline
├──────────────────────────────┤
│ [+] [ Napíš správu…  ] 😊 🎙 │  ← sticky composer + safe-area
└──────────────────────────────┘
```

Pri otvorenej konverzácii **bottom nav zmizne** (WhatsApp pattern) — composer je
posledný riadok. Zoznam konverzácií (`/chat`) je klasický WhatsApp zoznam:
avatar, meno, posledná správa (1 riadok, ellipsis), čas, unread badge.

---

## 3. Feed à la Bluesky (rieši P3, P5, P8)

### 3.1 Layout postu — edge-to-edge, žiadna karta v karte

```
┌──────────────────────────────┐
│ ◉  Stefan · 19 m          ⋯ │  ← avatar 40 px vľavo; meno + relatívny čas; menu (zmazať/upraviť)
│    Testy feedu               │  ← body, line-height 1.55
│    ┌────────────────────┐    │
│    │  médiá (grid 1–4)  │    │  ← zaoblené 12 px, aspect-ratio, blurhash placeholder
│    └────────────────────┘    │
│    💬 2   ❤ 5   ↗           │  ← action row: komentáre, reakcie, zdieľať
├──────────────────────────────┤  ← len 1 px hairline delič medzi postami
```

- Posty **bez rámčekov a tieňov** — oddelené hairline deličom (`--color-border`),
  full-width. Získa sa ~48 px šírky obsahu a Bluesky vzhľad.
- **Relatívne časy** („19 m", „včera", nad 7 dní dátum) namiesto „25. 6. 2026, 17:50".
- **„Zmazať" schovať do ⋯ menu** — červený destruktívny link na každom poste je
  vizuálny šum a riziko omylu (potvrdenie cez dialóg).
- **Composer:** na mobile zmenšiť na 1 riadok „Čo nové v rodine?" (rozbalí sa po
  fokuse) **alebo** úplne nahradiť FAB tlačidlom ✏️ vpravo dole (Bluesky) → compose
  ako bottom sheet / fullscreen. FAB odporúčam — composer nezaberá miesto v liste.
- **Pull-to-refresh** + „↑ nové príspevky" pill pri príchode nového obsahu cez WS.

### 3.2 Reakcie

- Action row s ❤ ako primárnou reakciou (tap = like, ako Bluesky).
- **Long-press / hover na ❤** → quick bar 👍❤️😂😮😢🙏 + „+" na plný emoji-mart picker.
- Zvolené reakcie sa zobrazujú ako chipy pod postom (`❤ 3 😂 1`), tap na chip = zoznam kto.
- Rovnaký komponent `<ReactionBar>` sa použije vo Feede aj v Chate (dizajn systém, §5).

### 3.3 Link preview (OG karty)

- Backend: pri vytvorení postu/správy worker stiahne URL, sparsuje OG meta
  (`og:title`, `og:description`, `og:image`), obrázok uloží zmenšený do media
  storage. Cache do tabuľky `link_previews (url_hash, title, descr, image_media_id,
  fetched_at)` — každá URL sa fetchne raz.
- Frontend: v texte sa URL renderuje ako **skrátený link** (`shop.everythingsmart.io/…`,
  max 1 riadok, ellipsis) + pod textom karta: obrázok, titulok, doména.
- Zabezpečenie: fetch len http/https, timeout 5 s, max 2 MB, block privátnych IP
  rozsahov (SSRF), beží vo worker procese — nikdy neblokuje odoslanie.

---

## 4. Chat à la WhatsApp (rieši P2, P4, P5, P7)

### 4.1 Bubliny — oprava pretekania (P2 je bug, fix hneď)

```css
.bubble {
  max-width: min(78%, 32rem);
  overflow-wrap: anywhere;   /* zlomí aj URL bez medzier */
  word-break: break-word;
  border-radius: 1.125rem;
}
.bubble--own   { margin-left: auto;  background: var(--color-accent); border-bottom-right-radius: 0.375rem; }
.bubble--other { margin-right: auto; background: var(--color-surface); border-bottom-left-radius: 0.375rem; }
.bubble img, .bubble video { max-width: 100%; height: auto; border-radius: 0.75rem; }
```

Rovnaké pravidlo (`overflow-wrap: anywhere`) patrí aj na body postu vo Feede.
Media príloha v bubline: thumbnail max ~70 % šírky, `aspect-ratio` z DB (media
tabuľka má width/height) → žiadne pretečenie ani layout shift.

- Čas **do bubliny** (pravý dolný roh, malé, polopriehľadné) namiesto samostatného
  riadku — ušetrí vertikálne miesto, WhatsApp vzhľad.
- Doručenky ✓ / ✓✓ (odoslané / prečítané — `last_read_message_id` už je v schéme).
- Zoskupovanie: po sebe idúce správy toho istého autora < 2 min = jedna skupina,
  chvost bubliny a čas len na poslednej.
- Date separatory („dnes", „včera", „streda 25. 6.").
- **Swipe-to-reply** + citovaná správa v composer (schéma má `reply_to_id`).
- **Reakcie:** long-press na bublinu → quick bar (rovnaký `<ReactionBar>` ako Feed),
  chipy na spodnej hrane bubliny.

### 4.2 Composer a prílohy (P4)

Tlačidlo **[+]** vľavo → bottom sheet (vaul) s mriežkou:

| Položka | Implementácia | Poznámka pre NAS |
|---|---|---|
| 📷 Fotoaparát | `<input capture="environment">` | sharp resize max 2048 px, WebP, EXIF strip (už v §9) |
| 🖼 Galéria (foto **aj video**) | `accept="image/*,video/*"` multiple | video: limit 200 MB (§9), poster frame + dĺžka cez ffmpeg vo workeri |
| 📄 Súbor | `accept="*"`, max 50 MB | karta s ikonou typu, názvom, veľkosťou; download stream |
| 📍 Poloha | `navigator.geolocation` → statická mini-mapa (OSM tile uložený ako obrázok) + link na mapy | žiadny externý JS, len 1 tile fetch cez worker |
| 🎙 Hlasová správa | `MediaRecorder` (opus/aac), push-to-record na 🎙 v composeri | Phase 2: prepis cez Whisper.cpp (§15) |

- Emoji tlačidlo 😊 v composeri (emoji-mart, lazy-loaded).
- Viac príloh naraz = grid v jednej správe (`message_media.order` už existuje).
- Upload s progress ringom priamo na thumbnaile + retry pri páde spojenia;
  správa sa odosiela optimisticky.

### 4.3 Video na NAS — realizovateľnosť

DS925+ nemá GPU → **žiadne server-side transkódovanie na požiadanie**. Pravidlá:

1. Prehráva sa **originál** cez HTTP Range requesty (`<video preload="metadata">`,
   poster z ffmpeg) — iPhone/Android nahrávajú H.264/HEVC MP4, ktoré prehrá každý klient.
2. Worker robí len **lacné operácie**: poster frame + metadáta (1 ffmpeg call, sekundy).
3. Voliteľný **nočný batch** (rovnaká pg_jobs queue ako LLM §15): re-encode veľkých
   videí do 720p H.264 pre úsporu miesta. Nikdy pri uploade.

---

## 5. Ďalšie odporúčania (modernizácia + užívateľská prívetivosť)

Zoradené podľa pomeru prínos/náročnosť:

1. **Safe-area & PWA:** `viewport-fit=cover`, `env(safe-area-inset-*)` na bottom nav
   a composer; `theme-color` meta zladený s témou. Test beží na holej IP cez HTTP —
   push notifikácie a instalovateľná PWA vyžadujú HTTPS (Caddy + DDNS z §12), takže
   ostrý test UX má zmysel až na HTTPS URL.
2. **Skeleton loading** (feed karty, chat zoznam) namiesto prázdnej plochy; obrázky
   vždy s blurhash placeholderom → žiadne poskakovanie layoutu.
3. **Optimistické UI všade:** post/správa/reakcia sa zobrazí okamžite lokálne,
   server potvrdí (TanStack Query mutácie) — na LAN aj cez internet pôsobí okamžite.
4. **Virtualizácia od prvého dňa** (react-virtuoso pre feed aj chat) — na iPade/starších
   telefónoch drží 60 fps aj pri stovkách položiek; NAS to nestojí nič.
5. **Prístupnosť pre rodinu:** touch targety min 44×44 px, nastavenie veľkosti písma
   (S/M/L/XL v profile — starí rodičia), kontrast AA (Radix), haptika pri reakcii.
6. **Tmavá téma** už je v tokenoch — pridať prepínač do „Viac" (auto/light/dark).
7. **Unread UX:** badge na Chat ikone v bottom nave, „— neprečítané —" divider
   v konverzácii, `document.title` počítadlo na desktope.
8. **Mikroanimácie s mierou** (§10): pop reakcie, typing dots, príchod správy —
   všetko CSS/spring, žiadne ťažké knižnice navyše.
9. **Command palette (Cmd+K)** nechať na T8 — na mobile ju nahrádza „Viac" sheet.

---

## 6. Dopad na výkon DS925+ (32 GB RAM) — overenie realizovateľnosti

| Zložka | Odhad RAM | Poznámka |
|---|---|---|
| Bun API + WS | ~80–120 MB | 10 userov, pub/sub in-memory |
| Worker (sharp, ffmpeg poster, OG fetch, push) | ~100–250 MB špičkovo | joby sériovo, po jobe sa pamäť vráti |
| Postgres 16 | ~200–300 MB | `shared_buffers` 512 MB stačí s rezervou |
| Caddy | ~30 MB | statika + TLS + reverse proxy |
| **Spolu Phase 1** | **< 1 GB** | zvyšok RAM ostáva pre DSM, cache a Phase 2 Ollamu |

Návrhové rozhodnutia, ktoré držia NAS v pohode: obrázky sa transformujú **raz pri
uploade** (nie pri každom zobrazení), varianty thumb/medium/full na disku; video sa
netranskóduje on-demand; OG preview sa cachuje per URL; WS fan-out pre 10 userov je
triviálny. Frontend je statika servovaná Caddym — React beží u klienta, NAS nič
nerenderuje.

---

## 7. Prioritizovaný akčný plán

| Priorita | Úloha | Rieši |
|---|---|---|
| **0 (teraz)** | Pushnúť lokálny draft z NAS do repa | review-ovateľnosť |
| **1 (quick fix)** | `overflow-wrap:anywhere` + `max-width` bublín + `max-width:100%` médií | P2 |
| **1** | App shell: tenký app bar + bottom nav + presun identity do „Viac"/Profil | P1, P6 |
| **1** | Chat ako fullscreen routa so sticky composerom | P7 |
| **2** | Feed layout à la Bluesky (edge-to-edge, action row, relatívne časy, ⋯ menu) | P8, P5 |
| **2** | Attachment sheet: galéria s videom, súbor, poloha; upload progress | P4 |
| **2** | ReactionBar (long-press quick bar + emoji picker) pre Feed aj Chat | P5 |
| **3** | OG link preview (worker + cache + karta) | P3 |
| **3** | Doručenky, zoskupovanie bublín, date separatory, swipe-to-reply | polish |
| **4** | Hlasové správy, nočný video re-encode batch, veľkosť písma v profile | nice-to-have |

Priorita 1 sa dá zvládnuť ako jeden PR nad draftom; priorita 2–3 zodpovedá pôvodnému
plánu T4–T7 z roadmapy (§13) — draft sa tým zosúladí s architektúrou namiesto
rozchádzania.
