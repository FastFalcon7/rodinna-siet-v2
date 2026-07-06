# Deploy runbook — Rodinná Sieť v2 (Synology DS925+)

Praktický postup nasadenia **Phase 2** na NAS: príprava tajomstiev, poradie
mergovania PR, prvý štart, zálohovanie a **restore drill**. Doplnok k
[`ARCHITECTURE_V2.md`](../ARCHITECTURE_V2.md) (§11 nasadenie, §14 verifikácia)
a [`docs/SYNOLOGY_DOMAIN_ACTIVATION.md`](./SYNOLOGY_DOMAIN_ACTIVATION.md)
(doména, TLS, edge vrstva).

> Cieľ: aby si pri NAS-e mal jeden dokument, podľa ktorého všetko zbehne bez
> hádania. Príkazy sú kopírovateľné.

---

## 0. Prehľad — čo Phase 2 pridáva k bežiacemu T6

Phase 2 (moduly M0–M7) beží v tých istých compose službách ako doteraz —
**žiadna nová infra služba nie je povinná** okrem voliteľného `ollama` (LLM).
Pribudol proces **`worker`** (už je v compose od M0) na pg_jobs frontu:
push fan-out, denné joby (spomienky, narodeniny, denník, hry, RSS).

Nové tajomstvá/nastavenia oproti T6:

| Premenná | Povinné? | Načo | Ako získať |
|---|---|---|---|
| `POSTGRES_PASSWORD` | **áno** | heslo DB (je v `DATABASE_URL`) | vlastné silné heslo |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | pre push | Web Push podpis | generátor (§2, raz, nemeniť) |
| `VAPID_SUBJECT` | pre push | kontakt (mailto:) | tvoj email |
| `ICS_SECRET` | pre ICS feed | token kalendárového odberu | `openssl rand -hex 32` |
| `LLM_BASE_URL` | pre denník/LLM | adresa Ollama | `http://ollama:11434` (s `--profile llm`) |
| `DOMAIN`, `PUBLIC_WEB_ORIGIN` | **áno** | doména appky | podľa Synology DDNS |

> **Fail-closed:** bez `VAPID_*` sa push ticho nevykonáva, bez `LLM_BASE_URL`
> sú LLM funkcie vypnuté (denník ukáže vysvetlenie), bez `ICS_SECRET` je ICS
> feed vypnutý (404). Appka v každom prípade nabehne. Zapínaš len to, čo chceš.

---

## 1. Poradie mergovania PR

Phase 2 je 8 stacknutých PR + bezpečnostná oprava. Merguj **v poradí**, každý
až po tom, čo predchádzajúci je v cieľovej vetve (inak diffy nesadnú):

```
#16  M0  jadro (worker + pg_jobs, notifications kernel, app shell)
#17  M0-4 živé karty — základ (app:// linky, registry kariet)
#18  M1  Ankety
#19  M2  Albumy + Spomienky
#20  M3  Zoznamy & Poznámky
#21  M4  Kalendár & Udalosti           ← ICS feed
#22  M5  LLM kernel + Denník            ← pgvector, Ollama
#23  M6  Hry & Výzvy
#23+ M7  Svet okolo (RSS) + fix(security) ICS token   ← na tej istej vetve
```

> Čísla PR over v GitHube (`gh pr list` / web) — poradie podľa vetiev
> `claude/m1-ankety … claude/m7-svet` je záväzné, čísla sú orientačné.
> Bezpečnostná oprava ICS tokenu je posledný commit na `claude/m7-svet`.

Po zmergovaní všetkého do hlavnej vetvy nasleduje jeden `up -d --build`.

---

## 2. Príprava `.env` na NAS

```bash
cd /volume1/rodinna/compose        # kde máš docker-compose.yml
cp .env.example .env
```

Vyplň v `.env`:

```dotenv
# — Doména / origin (podľa SYNOLOGY_DOMAIN_ACTIVATION.md) —
DOMAIN=rodinna.tvojadomena.synology.me
PUBLIC_WEB_ORIGIN=https://rodinna.tvojadomena.synology.me

# — DB — (zmeň, nie default!) —
POSTGRES_PASSWORD=<silne-nahodne-heslo>

# — Media (bind-mount na NAS) —
MEDIA_HOST_PATH=/volume1/rodinna/media
```

Vygeneruj a doplň tajomstvá:

```bash
# Web Push (raz, nikdy nemeň — zmena zneplatní všetky subscriptions):
docker compose run --rm --no-deps api bun apps/api/scripts/generate-vapid.ts
#   → skopíruj VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT do .env

# ICS kalendár feed (silný náhodný token):
echo "ICS_SECRET=$(openssl rand -hex 32)" >> .env
```

> `PUBLIC_WEB_ORIGIN` musí byť **presná verejná https URL** — používa sa v
> odkazoch push notifikácií aj v ICS subscribe URL.

---

## 3. Prvý štart

```bash
cd /volume1/rodinna/compose
docker compose --profile edge up -d --build
```

- Migrácie (vrátane `CREATE EXTENSION vector`) sa aplikujú **automaticky** pri
  boote `api`. `worker` na schému len počká.
- Over zdravie a že edge vrstva appku vidí:

```bash
docker compose ps                              # všetky healthy/running
docker compose logs -f api | grep -i migrat    # migrácie prebehli
curl -fsS https://$DOMAIN/api/health           # → {"status":"ok",...}
```

### Bootstrap admina (prvá pozvánka)

```bash
docker compose exec api bun apps/api/scripts/create-invite.ts ty@email.sk
```

Vypíše `…/register?token=…` — otvor v prehliadači, dokonči registráciu → si
admin. Ďalších členov už pozývaš z UI („Pozvať člena").

### (Voliteľné) LLM pre denník

```bash
# V .env: LLM_BASE_URL=http://ollama:11434
docker compose --profile edge --profile llm up -d
docker compose exec ollama ollama pull llama3.2:3b-instruct-q4_K_M
docker compose exec ollama ollama pull nomic-embed-text
```

> Ollama beží na CPU (DS925+ nemá GPU). Worker spracúva LLM joby **sériovo**
> (jeden semafór) — nočný denník je pomalý, ale nezahltí NAS.

---

## 4. Smoke checklist po nasadení

Rýchly prechod, že Phase 2 žije (5 min):

- [ ] **Health/HTTPS** — `curl https://$DOMAIN/api/health` = 200, platný cert.
- [ ] **Login** — prihlásenie admina, session prežije reload.
- [ ] **Feed** — nový príspevok s fotkou sa zobrazí, EXIF stripnutý.
- [ ] **Chat** — 2 zariadenia, správa naživo < 300 ms.
- [ ] **Push** — nainštaluj PWA na telefón, vypni obrazovku, pošli správu z
      druhého zariadenia → notifikácia na lock screen. *(Vyžaduje `VAPID_*`.)*
- [ ] **Ankety (M1)** — vytvor anketu v Feede, hlas sa prejaví na druhom
      zariadení naživo.
- [ ] **Albumy (M2)** — založ album, nahraj fotku, stiahni ZIP.
- [ ] **Poznámky (M3)** — zoznam, pošli do chatu, odškrtni položku z bubliny.
- [ ] **Kalendár (M4)** — udalosť + RSVP; skopíruj ICS subscribe URL z UI,
      pridaj do telefónového kalendára → udalosti sa zobrazia.
- [ ] **Denník (M5)** *(ak LLM zapnuté)* — quick capture, „Vygenerovať" →
      draft; potvrď; „Spomínaš si?" hľadanie vráti zápis.
- [ ] **Hry (M6)** — piškvorky v chate, dvaja hráči odohrajú ťah naživo.
- [ ] **Svet okolo (M7)** — v Denníku zapni kategóriu → o pár hodín (job 2×
      denne) sa objavia titulky; alebo vynúť job (viď nižšie).

Vynútenie RSS fetchu hneď (bez čakania na job):
```bash
docker compose exec postgres psql -U rodinna -d rodinna \
  -c "insert into jobs (kind, payload) values ('news.fetch', '{}');"
```

---

## 5. Zálohovanie (denne)

Skripty: [`infra/backup/backup.sh`](../infra/backup/backup.sh),
[`infra/backup/restore.sh`](../infra/backup/restore.sh).

**Čo sa zálohuje čím:**
- **DB** (Postgres, vrátane pgvector embeddingov) → `pg_dump` skriptom nižšie.
  DB žije v Docker volume, ktorý Hyper Backup samostatne nezachytí konzistentne.
- **Media** (`/volume1/rodinna/media`) → priamo **Hyper Backup** (je to obyčajný
  adresár na zväzku). Netreba kopírovať skriptom.

### Synology Task Scheduler — denný `pg_dump` o 3:00

Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script:

```sh
COMPOSE_DIR=/volume1/rodinna/compose \
BACKUP_DIR=/volume1/rodinna/backups \
RETENTION_DAYS=14 \
sh /volume1/rodinna/compose/infra/backup/backup.sh
```

Výstup: `/volume1/rodinna/backups/db-YYYY-MM-DD_HHMMSS.dump` (custom format,
komprimovaný). Retencia zmaže dumpy staršie než `RETENTION_DAYS`.

**Vrstvy zálohy** (podľa §11 architektúry): denný `pg_dump` lokálne (14 d) →
**Hyper Backup** týždenne na externý USB (media + dumpy) → mesačne do cloudu
(C2 / Backblaze B2). Retencia 7 d / 4 t / 12 m.

> Over, že Hyper Backup zálohuje aj `/volume1/rodinna/backups` (DB dumpy),
> nielen `media/` — inak by cloudová vrstva DB neobsahovala.

---

## 6. Restore drill (POVINNÝ — otestuj skôr, než to budeš potrebovať naostro)

Cieľ: dokázať, že zo zálohy vieš appku obnoviť do funkčného stavu. Rob to
**po prvom nasadení a potom raz za štvrťrok**.

### A) Bezpečný nácvik (bez zmazania produkcie)

Ak nechceš siahať na živú DB, otestuj restore do dočasnej databázy:
```bash
docker compose exec postgres createdb -U rodinna rodinna_drill
docker compose cp <záloha>.dump postgres:/tmp/d.dump
docker compose exec postgres \
  pg_restore -U rodinna -d rodinna_drill --no-owner --no-privileges -j 2 /tmp/d.dump
docker compose exec postgres psql -U rodinna -d rodinna_drill \
  -c "select count(*) from users; select count(*) from messages;"
docker compose exec postgres dropdb -U rodinna rodinna_drill   # upratať
```
Ak počty sedia s produkciou, záloha je platná.

### B) Plný drill (obnova do ostrej DB — podľa §14.6)

```bash
# 1) obnov z poslednej zálohy (--clean --if-exists prepíše obsah)
COMPOSE_DIR=/volume1/rodinna/compose \
  sh infra/backup/restore.sh /volume1/rodinna/backups/db-<STAMP>.dump

# 2) over
curl -fsS https://$DOMAIN/api/health
```

**Overovací checklist po obnove:**
- [ ] prihlásenie funguje (session tabuľka obnovená)
- [ ] Feed a Chat história je späť
- [ ] fotky sa zobrazujú (media + DB metadáta konzistentné)
- [ ] denníkové embeddingy fungujú (pgvector rozšírenie sa obnovilo z dumpu) —
      otvor „Spomínaš si?" a vyhľadaj

> **Pozn. o médiách:** `pg_dump` obnoví len metadáta v DB; samotné súbory sú v
> `MEDIA_HOST_PATH`. Pri havárii celého zväzku obnov najprv `media/` z Hyper
> Backup, až potom DB — inak budú fotky odkazovať na chýbajúce súbory.

---

## 7. Rollback pri zlom nasadení

```bash
# späť na predchádzajúci commit hlavnej vetvy
git -C /volume1/rodinna/compose checkout <predchadzajuci-tag-alebo-commit>
docker compose --profile edge up -d --build
```

Migrácie sú **doprednekompatibilné, nie automaticky reverzibilné** — ak nová
verzia pridala stĺpec/tabuľku, starý kód ich ignoruje (bezpečné). Ak by
migrácia dáta menila deštruktívne (v Phase 2 sa nedeje), rollback vyžaduje
restore z pg_dump spred nasadenia — preto **vždy sprav zálohu tesne pred
mergom nového releasu**.

---

## 8. Prevádzka — užitočné príkazy

```bash
docker compose ps                          # stav služieb
docker compose logs -f api worker          # živé logy
docker compose exec postgres psql -U rodinna -d rodinna   # SQL konzola

# fronta jobov (koľko čaká/zlyhalo):
docker compose exec postgres psql -U rodinna -d rodinna \
  -c "select kind, status, count(*) from jobs group by 1,2 order by 1;"

# rotácia ICS tokenu (napr. pri podozrení na únik) — zmeň ICS_SECRET a reštartuj;
# staré subscribe URL prestanú platiť, členovia si vytiahnu novú z UI:
docker compose up -d api
```
