# NAS cheatsheet — prevádzka Rodinnej siete (admin)

Operatívny prehľad príkazov pre **tento konkrétny NAS** — cesty a názvy nižšie
sú overené reálnym behom (júl 2026), nie generický príklad. Pre historický
kontext nasadenia Phase 2, restore drill v plnom znení a LLM/Ollama setup od
nuly pozri [`DEPLOY_RUNBOOK.md`](./DEPLOY_RUNBOOK.md); pre doménu/TLS
[`SYNOLOGY_DOMAIN_ACTIVATION.md`](./SYNOLOGY_DOMAIN_ACTIVATION.md).

Dokument je organizovaný podľa situácie — nájdi si, čo chceš urobiť, a
skopíruj príkazy.

---

## 0. Základné fakty (tento NAS)

| Čo | Hodnota |
|---|---|
| Repo / compose adresár | `/volume1/docker/rodinna-siet-v2` |
| Zálohy DB | `/volume1/docker/backups` |
| Doména appky | `https://rodina-sm.synology.me` |
| Hlavná vetva | `main` (feature vetvy `claude/...` sú dočasné, mažú sa po merge) |
| Kontajnery | `rodinna-api-1`, `rodinna-worker-1`, `rodinna-caddy-1`, `rodinna-postgres-1`, `rodinna-ollama-1` |
| Aktívne compose profily | `edge` (vždy) + `llm` (Ollama beží, teda je aktívny) |

**Kedy `sudo`:** `git` príkazy nie — bežia ako tvoj užívateľ nad súbormi v
repe. `docker`/`docker compose` áno — tento účet nie je v `docker` skupine,
takže bez `sudo` dostaneš `permission denied`.

---

## 1. Nasadiť novú verziu (po zmergovanom PR)

Over si najprv, na akej vetve/stave si:

```bash
cd /volume1/docker/rodinna-siet-v2
git status
```

Ak `working tree clean`, pokračuj. Ak nie, zastav sa — niečo je rozrobené,
neprepisuj to.

```bash
# 1) prepni sa na main a stiahni najnovšie
git fetch origin
git checkout main
git pull origin main

# 2) záloha DB PRED rebuildom (najmä ak pull priniesol nové súbory v
#    apps/api/drizzle/ — to sú migrácie schémy, ktoré sa spustia automaticky
#    pri štarte api kontajnera)
COMPOSE_DIR=/volume1/docker/rodinna-siet-v2 \
BACKUP_DIR=/volume1/docker/backups \
sh /volume1/docker/rodinna-siet-v2/infra/backup/backup.sh
# ak "permission denied": sudo sh -c 'COMPOSE_DIR=... BACKUP_DIR=... sh .../backup.sh'
ls -lh /volume1/docker/backups/          # over, že dump vznikol

# 3) rebuild + reštart (rebuilduje api, worker aj caddy — ten v sebe
#    zabalí aj Vite build webu)
sudo docker compose --profile edge up -d --build

# 4) over
sudo docker compose ps                              # všetko healthy/running
sudo docker compose logs api | grep -i migrat        # migrácie prebehli bez chyby
curl -fsS https://rodina-sm.synology.me/api/health   # {"status":"ok",...}
```

Voliteľné upratanie zmergovanej feature vetvy:

```bash
git branch -d claude/<názov-vetvy>
```

**Ak `docker compose logs api` ukáže chybu pri migráciách:** nič ďalšie
nereštartuj, nájdi si vytvorený dump z kroku 2 a pozri sekciu 4 (obnova).

---

## 2. Pozvať nového člena rodiny

```bash
sudo docker compose exec api bun apps/api/scripts/create-invite.ts meno@email.sk
# pre admina: ... meno@email.sk admin
```

Vypíše registračný link a **textovú verziu e-mailu priamo do terminálu** —
tú stačí skopírovať a vložiť kamkoľvek (Gmail, SMS, WhatsApp).

Ak chceš radšej **formátovaný HTML e-mail** (vyzerá lepšie), skript ho uložil
do kontajnera na `/app/invite-<email>.html` — vytiahni ho na NAS a odtiaľ si
ho otvor cez File Station / SMB vo svojom prehliadači:

```bash
sudo docker compose cp api:/app/invite-<email-so-spravnymi-znakmi>.html \
  /volume1/docker/rodinna-siet-v2/invite-preview.html
```

(presný názov súboru vypíše samotný skript v riadku „Hotový HTML e-mail
uložený do: …"). V prehliadači otvor, `Ctrl/Cmd+A`, skopíruj, vlož do tela
e-mailu — zachová farby aj tlačidlo.

Pozvánka platí **7 dní** a je **jednorazová**.

---

## 3. Záloha DB (mimo nasadenia, napr. pred rizikovým zásahom)

```bash
COMPOSE_DIR=/volume1/docker/rodinna-siet-v2 \
BACKUP_DIR=/volume1/docker/backups \
sh /volume1/docker/rodinna-siet-v2/infra/backup/backup.sh
```

Automaticky beží aj denne o 3:00 cez Synology Task Scheduler (ak je
nastavené — over v Control Panel → Task Scheduler). Retencia 14 dní, staršie
dumpy sa mažú samé.

> **Media** (fotky/videá v `MEDIA_HOST_PATH`) zálohuje priamo **Hyper
> Backup** ako bežný adresár — tento skript zálohuje len databázu.

---

## 4. Obnova zo zálohy

**Bezpečný nácvik** (do dočasnej DB, produkciu sa nedotkne) — spúšťaj z
repo adresára, nech `docker compose` nájde správny `docker-compose.yml`/`.env`:

```bash
cd /volume1/docker/rodinna-siet-v2
DUMP=/volume1/docker/backups/db-<STAMP>.dump   # ktorý dump chceš overiť

sudo docker compose exec postgres createdb -U rodinna rodinna_drill
sudo docker compose cp "$DUMP" postgres:/tmp/d.dump
sudo docker compose exec postgres \
  pg_restore -U rodinna -d rodinna_drill --no-owner --no-privileges -j 2 /tmp/d.dump
sudo docker compose exec postgres psql -U rodinna -d rodinna_drill \
  -c "select count(*) from users; select count(*) from messages;"
sudo docker compose exec postgres dropdb -U rodinna rodinna_drill   # upratať
```

Porovnaj počty s tým, čo vieš o produkcii (napr. `select count(*) from users`
v ostrej `rodinna` DB) — ak sedia, záloha je platná. Rob tento nácvik raz za
štvrťrok, nie len keď horí. Plný kontext: [`DEPLOY_RUNBOOK.md` §6](./DEPLOY_RUNBOOK.md#6-restore-drill-povinný-otestuj-skôr-než-to-budeš-potrebovať-naostro).

**Naostro** (prepíše živú DB — použi len pri havárii):

```bash
COMPOSE_DIR=/volume1/docker/rodinna-siet-v2 \
  sh /volume1/docker/rodinna-siet-v2/infra/backup/restore.sh \
  /volume1/docker/backups/db-<STAMP>.dump

curl -fsS https://rodina-sm.synology.me/api/health
```

Skript sám reštartuje `api` a `worker` na konci. Over si potom prihlásenie,
Novinky/Správy históriu a že fotky sedia (media súbory obnov z Hyper Backup
**pred** DB, inak budú odkazy na fotky mŕtve).

---

## 5. Rollback pri zlom nasadení

```bash
cd /volume1/docker/rodinna-siet-v2
git checkout <predchádzajúci-commit-alebo-tag>
sudo docker compose --profile edge up -d --build
```

Migrácie sú dopredu-kompatibilné (starý kód nové stĺpce ignoruje), takže
samotný rollback kódu je bezpečný. Ak by nová verzia dáta menila deštruktívne
(zatiaľ sa nestalo), treba aj obnovu z dumpu spred nasadenia — preto krok 2 v
sekcii 1 (záloha pred rebuildom) nikdy nevynechávaj.

---

## 6. Bežný dohľad — stav, logy, DB konzola

```bash
sudo docker compose ps                                    # stav všetkých služieb
sudo docker compose logs -f api worker                    # živé logy (Ctrl+C ukončí)
sudo docker compose exec postgres psql -U rodinna -d rodinna   # SQL konzola

# fronta pozadia bežiacich jobov (push, denné joby, RSS…):
sudo docker compose exec postgres psql -U rodinna -d rodinna \
  -c "select kind, status, count(*) from jobs group by 1,2 order by 1;"
```

---

## 7. AI funkcie (Denník, Kvízy, otázka dňa)

**Zapína/vypína sa v appke, nie príkazom** — prihlás sa ako admin → **Viac →
AI funkcie** → prepínač. Je to globálne pre celú rodinu, uložené v DB
(`app_settings`), takže sa netreba dotýkať `.env` ani reštartovať kontajnery.

Predpoklad, aby prepínač vôbec niečo robil: `LLM_BASE_URL` musí byť
nastavené v `.env` a Ollama musí bežať (na tomto NAS-e áno —
`rodinna-ollama-1`). Zmena modelu (napr. na kvalitnejší 7B) je cez `.env`
(`LLM_MODEL`) + stiahnutie modelu — presný postup v
[`DEPLOY_RUNBOOK.md` §3](./DEPLOY_RUNBOOK.md#3-prvý-štart).

---

## 8. Rotácia ICS tokenu (kalendárový feed)

Ak máš podozrenie na únik `ICS_SECRET` (niekto neoprávnený vidí rodinné
udalosti):

```bash
# v .env zmeň ICS_SECRET na nový (napr. openssl rand -hex 32)
sudo docker compose up -d api
```

Staré odberové URL prestanú fungovať, členovia si vytiahnu nové z UI
(Kalendár).

---

## 9. Kde hľadať viac

- **Prvé nasadenie od nuly / história Phase 2 / LLM setup krok za krokom** →
  `DEPLOY_RUNBOOK.md`
- **Doména, TLS, Caddy porty** → `SYNOLOGY_DOMAIN_ACTIVATION.md`
- **Architektúra, dátový model, otvorené odchýlky** → `ARCHITECTURE_V2.md`
- **Známe otvorené problémy z reálnej prevádzky** (video na iPhone, kvalita
  LLM výstupov...) → `DEPLOY_RUNBOOK.md` §9 a `ARCHITECTURE_V2.md` §13
