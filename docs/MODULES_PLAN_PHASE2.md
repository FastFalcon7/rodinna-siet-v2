# Plán modulov Phase 2 — nadväznosť na Feed a Chat

> **Stav dokumentu:** návrh na diskusiu (júl 2026).
> **Východisko:** Feed a Chat sú hotové a overené na NAS-e (T4–T6 + design review priority 1–3:
> OG preview, prílohy foto/video/súbor/poloha, reakcie, zoskupovanie bublín, swipe-to-reply).
> **Súvisí s:** `ARCHITECTURE_V2.md` §5 (plugin kontrakt), §7 (dátový model), §13 (roadmap), §15 (LLM use cases);
> `docs/DESIGN_REVIEW_FEED_CHAT.md` §2 (app shell, bottom nav).

---

## 0. Hlavná myšlienka: moduly nie sú záložky, sú to prítoky do Feedu a Chatu

Najčastejšia chyba rodinných appiek: každý modul je izolovaný ostrov s vlastnou obrazovkou,
na ktorú nikto nechodí. Feed a Chat sú **jediné dve miesta, kde rodina reálne žije** —
preto každý nový modul musí primárne **prúdiť do nich**, nie súperiť o pozornosť.

Z toho plynie **integračný kontrakt** — podmienka pre každý nový modul (rozširuje
plugin kontrakt z §5 architektúry):

| # | Pravidlo | Príklad |
|---|---|---|
| K1 | **Feed karta** — modul vie vložiť do Feedu „aktivitnú kartu" (nie obyčajný post): interaktívnu, živú, s vlastným renderom | anketa s tlačidlami hlasovania priamo vo Feede; „Janka pridala 12 fotiek do albumu *Leto 2026*" s mini-gridom |
| K2 | **Chat share-target** — každá entita modulu sa dá poslať do konverzácie ako **živá karta** (renderuje aktuálny stav, nie snapshot) | nákupný zoznam v bubline, kde sa checkboxy odškrtávajú real-time |
| K3 | **Push druh** — modul registruje vlastné `notification.kind` + per-user nastavenie | „Ocko ťa vyzval na piškvorky", „Zajtra má Babka narodeniny" |
| K4 | **Nav + palette** — `navItem` do bottom navu / „Viac" sheetu, príkazy do Cmd+K | „Nová anketa…", „Otvor nákupný zoznam" |
| K5 | **Média cez kernel** — žiadny modul si nerieši vlastný upload; všetko cez existujúci `media` pipeline (sharp, blurhash, EXIF strip) | fotky v albumoch = tie isté `media` riadky ako vo Feede/Chate |

Kontrakty K1–K3 vyžadujú tri malé rozšírenia jadra (detail v M0):
`EventBus` (§5 už počíta s `events`), tabuľku `feed_cards` a generický
„entity card" render v Chate (obdoba existujúcej OG karty — vzor už máme).

---

## 1. Čo už máme a na čom sa dá stavať

| Hotová schopnosť | Kto ju zdedí |
|---|---|
| `media` pipeline (upload, sharp, blurhash, video range serving) | Albumy, Denník, Hry (foto výzvy) |
| Bun WS pub/sub + `ChatSocket` (reconnect, heartbeat) | živé karty, Ankety, Zoznamy, Hry (ťahy real-time) |
| `<ReactionBar>` zdieľaný Feed/Chat | Albumy (reakcie na fotky), Denník (súkromné „nálady") |
| OG link-preview karta + `linkpreview` worker vzor | živé entity karty (K2), Svet okolo (RSS fetch) |
| Cursor pagination (feed, chat) | Albumy timeline, Denník archív |
| Invite-only auth + roly | detské kontá / obmedzenia (backlog) |

**Čo jadru chýba** (a Phase 2 to potrebuje skôr než prvý modul): worker proces +
`pg_jobs` queue, `notifications` modul (web-push/VAPID), škálovateľná navigácia
(bottom nav + „Viac"), TanStack Router pre routy modulov. To je milestone M0.

---

## 2. Prehľad navrhovaných modulov (poradie = odporúčané poradie implementácie)

| M | Modul | Prečo v tomto poradí | Stavia na |
|---|---|---|---|
| M0 ✅ | **Jadro Phase 2**: push + worker + app shell | prerekvizita všetkého; zároveň dokončuje T7–T8 | — |
| M1 ✅ | **Ankety** 🗳 | najmenší modul, end-to-end overí kontrakt K1–K4; okamžitá hodnota | WS, Feed, Chat |
| M2 ✅ | **Albumy + Spomienky** 📷 | najväčšia emočná hodnota; média už máme, chýba len organizácia | media, worker |
| M3 ✅ | **Zoznamy & Poznámky** | denná praktická hodnota (nákupy); predvedie živé karty naplno | WS, živé karty |
| M4 | **Kalendár & Udalosti** 📅 | narodeniny + rodinné akcie; spája Feed (RSVP) a push (pripomienky) | worker, push, Ankety (RSVP ≈ anketa) |
| M5 | **LLM kernel + Denník** 📖 | prvý LLM modul podľa §15.2; najinovatívnejšia časť appky | worker, media, embeddings |
| M6 | **Hry & Výzvy** 🎲 | zábava/retencia; piškvorky sú „chat s iným payloadom" | WS, LLM (kvízy), media (výzvy) |
| M7 | **Svet okolo** 🌍 | rozšírenie Denníka podľa §15.3; opt-in | worker, Denník |

Poradie je zvolené tak, aby **každý modul znovu použil niečo z predchádzajúceho**
a rodina dostávala novú hodnotu každé ~2 týždne, nie jeden big-bang po pol roku.

---

## 3. Detaily modulov

### M0 — Jadro Phase 2 (≈ 2 týždne; kryje sa s T7–T8 roadmapy)

Nie je to používateľský modul, ale bez neho sa žiadny ďalší nedá poriadne spraviť:

1. **Worker proces + `pg_jobs`** (§6 architektúry) — už dnes ho potrebuje video poster
   a OG fetch; Phase 2 pridá nočné joby (spomienky, denník, re-encode).
2. **`notifications` kernel** — web-push/VAPID, tabuľky `push_subs` + `notifications`
   (v §7 už navrhnuté), per-user matica „ktorý druh notifikácie chcem" (K3).
3. **App shell podľa design review §2** — bottom nav (Feed, Chat, Albumy, Viac),
   TanStack Router s lazy routami per modul, register `navItem` z plugin kontraktu.
4. **`feed_cards` + živé karty** — jadrová podpora pre K1/K2:

```
feed_cards (id, module, entity_type, entity_id, author_id, created_at, deleted_at)
  -- karta žije vo feede vedľa postov (UNION v paginácii cez spoločný kurzor);
  -- render + aktuálny stav si modul rieši sám cez svoje API
```

   V Chate sa živá karta posiela ako správa s `body_md = app://polls/<id>` — linkify
   už existuje, len namiesto OG karty renderuje registrovaný modulový komponent.
   (Interná `app://` schéma = žiadna kolízia s reálnymi URL, deep-link zadarmo.)

**Akceptácia M0:** push na lock screen iPhonu (verifikácia §14.4), bottom nav so 4 slotmi,
`bun run dev` spúšťa api + worker, dummy živá karta sa dá poslať do chatu a otvoriť.

### M1 — Ankety 🗳 (≈ 1 týždeň)

„Kde bude nedeľný obed?" — najkratšia cesta k dennému používaniu a zároveň
**testovací balón plugin kontraktu**: malý dátový model, ale dotkne sa všetkých K1–K4.

- Anketa sa vytvára z Feed composeru (nový typ prílohy) **alebo** z chatu (`[+]` sheet).
- Hlasovanie priamo v karte (Feed aj Chat), výsledky sa menia real-time cez WS.
- Voľby: viac možností, anonymné áno/nie, deadline (+ push „anketa končí o hodinu").
- **Inovácia — „rozhodovacie ankety":** po deadline karta sama vyhlási víťaza a
  autor môže jedným tapom vytvoriť z víťaznej možnosti udalosť v Kalendári (M4 ju
  neskôr len zapne — API sa navrhne teraz).

```
polls        (id, author_id, question, kind ENUM('single','multi'), anonymous, closes_at, created_at)
poll_options (id, poll_id, label, order)
poll_votes   (poll_id, option_id, user_id, created_at, UNIQUE(poll_id, user_id, option_id))
```

**Akceptácia:** 2 zariadenia, hlas z jedného sa do 300 ms objaví v karte na druhom
(vo Feede aj v tej istej ankete zdieľanej v chate).

### M2 — Albumy + Spomienky 📷 (≈ 2–3 týždne)

Fotky už v systéme sú (Feed aj Chat) — modul ich **organizuje a oživuje**, nie duplikuje.

- **Albumy:** manuálne (názov, obálka, členovia môžu prispievať), fotky = existujúce
  `media` id-čka + nové uploady. Grid s virtualizáciou, lightbox (react-zoom-pan-pinch
  už je v pláne), reakcie na fotky cez `<ReactionBar>`.
- **Inovácia 1 — „Zberač":** worker si všíma fotky poslané do chatu/feedu a pri
  ≥ N fotkách z jedného dňa navrhne: *„Máte 14 fotiek zo soboty — vytvoriť album
  ‚Výlet 28. 6.'?"* Jeden tap = album. (Heuristika dátum+autor, žiadne LLM.)
- **Inovácia 2 — „Na tento deň":** nočný job nájde fotky spred roka/dvoch a ráno
  vloží do Feedu spomienkovú kartu (K1) — najsilnejší dôvod otvárať appku denne.
- **Timeline „Rok v rodine":** chronologický pás všetkých fotiek naprieč albumami
  (mesiace ako sekcie) — cursor pagination už máme.
- ZIP download albumu (worker job, push „archív je pripravený").

```
albums        (id, title, cover_media_id, created_by, created_at)
album_photos  (album_id, media_id, added_by, order, created_at, PRIMARY KEY(album_id, media_id))
memory_marks  (user_id, media_id, hidden_at)   -- „túto spomienku už neukazuj"
```

**Akceptácia:** návrh albumu zo skupinového chatu s 10+ fotkami; spomienková karta
vo Feede s fotkou spred roka; ZIP 200 fotiek stiahnuteľný z iPhonu.

### M3 — Zoznamy & Poznámky ✅ (≈ 2 týždne)

Notes z pôvodného plánu, ale s ťahom na **spoluprácu v reálnom čase** — to je to,
čo WhatsApp nevie a rodina používa denne.

- **Zoznamy** (nákupy, balenie na dovolenku, úlohy): checkboxy, priradenie osobe
  („kúpi Peter"), odškrtnutie sa cez WS okamžite prejaví všetkým.
- **Poznámky:** jednoduchý markdown editor (bez real-time co-editingu — pre 10 ľudí
  stačí „naposledy upravil X", konflikt riešime last-write-wins + história verzií).
- **Inovácia — živá karta zoznamu v chate (K2 naplno):** *„pošli nákupný zoznam
  do Rodina"* → bublina s prvými 3 položkami a progresom `4/9 ✓`; odškrtávať sa dá
  **priamo v bubline** z chatu, v obchode, bez otvárania modulu.
- Šablóny („týždenný nákup") + opakovanie; pripnuté zoznamy hore.
- LLM-ready: `llmTools: [createList, addItem]` — pripraví pôdu pre `@asistent`
  („pridaj mlieko do nákupu") v M5+, bez implementácie teraz.

```
notes       (id, kind ENUM('note','list'), title, body_md, created_by, pinned, created_at, updated_at, updated_by, deleted_at)
note_items  (id, note_id, label, checked_by, checked_at, assigned_to, order)
note_revisions (id, note_id, body_md, saved_by, saved_at)
```

**Akceptácia:** zoznam zdieľaný v chate; odškrtnutie z bubliny na zariadení A sa
do 300 ms ukáže v bubline aj v module na zariadení B.

### M4 — Kalendár & Udalosti 📅 (≈ 2 týždne)

- **Narodeniny a výročia:** dátum narodenia v profile → automatické celodenné
  udalosti navždy; push ráno + 3 dni vopred; vo Feede oslávencova karta (K1) —
  reakcie a gratulácie priamo pod ňou.
- **Udalosti s RSVP:** „Grilovačka u nás, sobota 17:00" → karta vo Feede s tlačidlami
  Prídem / Neprídem / Neviem (technicky = špecializovaná anketa z M1). Zoznam „kto
  príde" živý cez WS. Push pripomienka deň vopred a hodinu vopred.
- **Mesačný pohľad + agenda** (mobil: agenda default — mesačná mriežka je na malom
  displeji nepoužiteľná).
- **ICS export/subscribe** (read-only URL s tokenom) → rodinný kalendár sa objaví
  v Apple/Google Calendar bez toho, aby tam museli dáta žiť.
- LLM-ready háčik (§15): worker neskôr **navrhne** udalosť z chatovej správy
  („v sobotu o piatej u nás?") — vždy len návrh, nikdy automatický zápis.

```
events       (id, title, starts_at, ends_at, all_day, location, body_md, created_by, source ENUM('manual','birthday','poll','suggested'), created_at, deleted_at)
event_rsvps  (event_id, user_id, status ENUM('yes','no','maybe'), created_at, PRIMARY KEY(event_id, user_id))
```

**Akceptácia:** narodeninová karta vo Feede v deň narodenín; RSVP z Feedu aj z chatu;
udalosť viditeľná v Apple Calendar cez ICS subscribe; pripomienka na lock screene.

### M5 — LLM kernel + Denník 📖 (≈ 3–4 týždne)

Prvé nasadenie Ollamy podľa §6 a §15.2 — **najosobnejší a najinovatívnejší modul**.

1. **LLM kernel:** Ollama kontajner (`llama3.2:3b-instruct-q4_K_M` + `nomic-embed-text`),
   `/api/llm/*` adaptér, semafór (nikdy paralelné inferencie), `pg_jobs` integrácia.
2. **Quick capture:** jednoriadkový vstup „Ako bolo dnes?" (text/foto/nálada emoji/
   hlasovka) — dostupný z „Viac" aj z Cmd+K; zapisuje `diary_fragments`.
3. **Nočný draft:** worker o 23:30 poskladá fragmenty + vlastné posty + vlastné
   odoslané správy → LLM napíše súvislý zápis v 1. osobe. **Vždy draft** — ráno
   push „Tvoj včerajšok je pripravený ✍️", užívateľ potvrdí/upraví (human-in-the-loop,
   ochrana pred halucináciami, presne podľa §15.2).
4. **Súkromie:** denník je striktne privátny (jediný modul bez K1/K2 defaultu);
   zdieľať sa dá len explicitne vybraný zápis ako post.
5. **Embeddings + „Spomínaš si?":** potvrdené zápisy → `pgvector`; občasná privátna
   karta „pred rokom si písal o…" + sémantické hľadanie v denníku.
6. **Hlasovky s prepisom** (Whisper.cpp tiny) — najprv pre denník, potom to isté
   tlačidlo v chate (T7 nice-to-have sa splní tu, s prepisom navyše).

```
diary_fragments (id, user_id, body, mood, media_id, source ENUM('manual','feed','chat'), source_ref_id, created_at)
diary_entries   (id, user_id, date, body_md, status ENUM('draft','confirmed'), confirmed_at, created_at)
note_embeddings (id, entry_id, chunk, embedding vector(768))
```

**Akceptácia:** deň s 3 fragmentmi + 2 postami → ráno draft, ktorý neobsahuje nič,
čo sa nestalo; potvrdený zápis nájditeľný sémantickým dopytom („keď sme boli pri vode").

### M6 — Hry & Výzvy 🎲 (≈ 2–3 týždne, dá sa krájať)

Zábava ako sociálne lepidlo — všetko sa hrá **v chate a vo Feede**, nie v izolovanej „herni".

- **Piškvorky v chate:** výzva = živá karta v konverzácii, ťahy real-time cez WS
  (technicky trivialita — je to správa s iným payloadom). Push „si na ťahu".
- **Denná rodinná otázka:** ráno karta vo Feede — striedavo kvíz („Hlavné mesto
  Austrálie?"), anketa-ice-breaker („Najlepší film večera?") a **rodinný kvíz z LLM**
  (M5+): otázky vygenerované z potvrdených denníkov/albumov — *„Kto v júni chytil
  najväčšiu rybu?"* — hra, ktorú nevie ponúknuť žiadna iná appka na svete.
- **Foto výzva týždňa:** „odfoť niečo žlté" → odpovede ako posty s tagom výzvy,
  nedeľné vyhodnotenie reakciami.
- Jemné skóre/rebríček za mesiac (bez gamifikačného spamu — jedna karta mesačne).

```
game_sessions (id, kind ENUM('tictactoe','quiz','photo_challenge'), room_id, state_json, status, created_by, created_at, updated_at)
game_moves    (id, session_id, user_id, payload_json, created_at)
```

**Akceptácia:** partia piškvoriek medzi 2 telefónmi v chate; denná otázka vo Feede
s vyhodnotením; LLM kvíz vygenerovaný z reálnych rodinných dát (ak M5 hotové).

### M7 — Svet okolo 🌍 (≈ 1 týždeň)

Presne podľa §15.3: RSS aggregator job (2× denne, len titulky + snippet), kategórie
per user, opt-in. Zobrazuje sa ako vizuálne odlíšený záverečný odsek denníka a
voliteľná ranná karta vo Feede („3 titulky pre teba"). Jediný modul s výstupným
internetom — firewall pravidlo explicitne len na RSS zdroje.

---

## 4. Nápady do zásobníka (zámerne mimo plánu, nech sa scope neroztečie)

- **Rodokmeň** — vizuálny strom rodiny (kto je koho), pekné empty-states už s motívom
  stromu počítajú (§10). Kandidát na M8.
- **Recepty** — špecializované poznámky s fotkou a porciami; dá sa začať šablónou v M3.
- **Detské kontá** — rola `child` s obmedzeniami; auth to už umožňuje.
- **Rodinná poloha** („zdieľaj kde som na 1 hodinu") — chat už má polohu ako prílohu,
  toto by bol živý variant. Citlivé na súkromie → len po výslovnom dopyte rodiny.
- **Týždenný digest** (LLM, §15.1) — „čo sa u nás dialo" každú nedeľu večer.

---

## 5. Harmonogram a závislosti (nadväzuje na §13, T7+)

| Týždne | Milestone | Poznámka |
|---|---|---|
| T7–T8 | **M0** jadro: push, worker, app shell, živé karty | kryje sa s pôvodným T7–T8; T9 security audit beží po ňom nezmenene |
| T10 | **M1** Ankety | overenie plugin kontraktu end-to-end |
| T11–T13 | **M2** Albumy + Spomienky | „Na tento deň" zapnúť hneď — dáta vo Feede/Chate už existujú |
| T14–T15 | **M3** Zoznamy & Poznámky | živé karty v chate |
| T16–T17 | **M4** Kalendár & Udalosti | RSVP stavia na M1 |
| T18–T21 | **M5** LLM kernel + Denník | najdlhší; Ollama + Whisper na NAS treba odladiť |
| T22–T24 | **M6** Hry & Výzvy | piškvorky skôr (bez LLM), kvízy po M5 |
| T25 | **M7** Svet okolo | malý, závisí na M5 (denník) |

```
M0 ──► M1 ──► M4 (RSVP)
 ├───► M2 ──► M6 (foto výzvy)
 ├───► M3 ──► (llmTools pre @asistent)
 └───► M5 ──► M6 (kvízy), M7
```

Každý milestone končí nasadením na NAS a týždňom reálneho používania rodinou pred
začatím ďalšieho — spätná väzba od 10 skutočných užívateľov je lacnejšia než
špekulatívny vývoj.

## 6. Riziká a poistky

| Riziko | Poistka |
|---|---|
| Feed zahltený kartami modulov | max 1 systémová karta denne per druh (spomienka, otázka…); karty sa dajú per-druh vypnúť v nastaveniach |
| LLM na CPU pomalé / nekvalitné výstupy | všetko LLM je async draft s human-in-the-loop; žiadna interaktívna cesta nečaká na model (§15) |
| Únava z notifikácií | K3 matica per druh + „tichý režim" per user; defaulty konzervatívne |
| Rozsah M2–M6 sa nafúkne | každý modul má „akceptáciu" — po jej splnení sa ide ďalej, polish do zásobníka |
| `feed_cards` UNION spomalí feed | pre 10 užívateľov neproblém; index na `(created_at, id)` rovnaký ako posty |
