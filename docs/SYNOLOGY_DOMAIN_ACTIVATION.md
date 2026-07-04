# Aktivácia Synology domény (DDNS) + zdieľaná edge vrstva pre viac appiek

> Nadväzuje na `ARCHITECTURE_V2.md §2` (zafixované rozhodnutia), `§12` (deployment na
> DS925+) a `README.md` („Produkčné nasadenie"). Cieľ: dostať appku z `DOMAIN=localhost`
> na verejne dostupnú `rodinna-<meno>.synology.me` s platným Let's Encrypt certom —
> a rovno od začiatku tak, aby sa dali pridávať ďalšie appky v Dockeri na tom istom NAS
> (poznámky, zápisník letov, ...) bez toho, aby si museli navzájom prekážať na
> portoch 80/443.

## 0. Kľúčové rozhodnutie: zdieľaná edge vrstva

Porty **80/443 na NAS môže mať naviazaný len jeden proces**. Ak má na NAS bežať viac
appiek s vlastnou doménou/HTTPS, nemôže mať každá appka vlastný Caddy/nginx priamo na
týchto portoch — treba **jeden spoločný „edge" reverse proxy pre celý NAS**, ku ktorému
sa každá appka len pripája cez internú Docker sieť.

Preto je táto appka (`rodinna-siet-v2`) od začiatku nastavená takto:

- Jej vlastný `caddy` kontajner (`docker-compose.yml`, profil `edge`, image
  `infra/docker/web.Dockerfile` + `infra/caddy/Caddyfile`) **nerobí TLS ani
  nepublishuje host porty** — počúva len na `:80` v internej Docker sieti a servíruje
  web statiku + proxuje `/api`, `/ws` na `api:3000`.
- **TLS a routovanie podľa domény rieši samostatný, NAS-wide zdieľaný Caddy** — jeden
  kontajner mimo tohto repa (žije v `/volume1/edge/compose/` na NAS, nie v žiadnom
  appkovom gite), ktorý jediný drží porty 80/443 a pre každú appku má vlastný site
  block s vlastnou doménou/certom.
- Prepojenie appiek so zdieľaným Caddym ide cez externú Docker sieť s názvom **`edge`**
  — každá appka sa k nej pripojí (`docker-compose.yml` už má `networks.edge.external:
  true` a `caddy` službu s aliasom `rodinna-web`), zdieľaný Caddy potom robí
  `reverse_proxy rodinna-web:80`.

Výhoda: pridanie ďalšej appky = nový DDNS hostname + nový site block v zdieľanom
Caddyfile + pripojenie appky do siete `edge`. Žiadny zásah do už bežiacich appiek.

## 1. Predpoklady

- Synology účet (Synology Account) prihlásený v DSM.
- Admin prístup do DSM na DS925+ a do routera/firewallu pred ním.
- Statická/rezervovaná lokálna IP pre NAS v LAN (DHCP reservation na routeri), aby
  port forwarding neprestal fungovať po reštarte NAS.
- Docker/Container Manager v DSM.

## 2. Zdieľaná edge vrstva — vytvoriť raz na NAS

Toto sa robí **raz za celý NAS**, nezávisle od `rodinna-siet-v2` aj od budúcich
appiek. Odporúčaná štruktúra:

```
/volume1/edge/
  compose/docker-compose.yml
  caddy/Caddyfile
  data/           certy (Let's Encrypt)
  config/         Caddy autosave config
```

**`docker-compose.yml`:**

```yaml
name: edge

services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
      - '443:443/udp'
    volumes:
      - ../caddy/Caddyfile:/etc/caddy/Caddyfile
      - ../data:/data
      - ../config:/config
    networks:
      - edge

networks:
  edge:
    external: true
```

Sieť treba vytvoriť pred prvým spustením:

```bash
docker network create edge
docker compose -f /volume1/edge/compose/docker-compose.yml up -d
```

**`caddy/Caddyfile`** — jeden site block na appku, doplnia sa postupne (viď §6):

```
rodinna-<meno>.synology.me {
	reverse_proxy rodinna-web:80
}
```

## 3. DDNS v DSM

1. **Control Panel → External Access → DDNS → Add**.
2. Poskytovateľ: **Synology**, prihlásiť sa cez Synology Account (ak ešte nie je
   párovaný).
3. Zvoliť hostname, napr. `rodinna-<priezvisko>` → vznikne
   `rodinna-<priezvisko>.synology.me`.
4. **Nechať vypnuté** „Zapnúť Heartbeat (HTTPS)" / DSM built-in cert manažment pre
   túto doménu — TLS rieši výhradne zdieľaný edge Caddy, nie DSM.
5. Test: DSM ukáže zelenú fajku „Normal" pri statuse DDNS záznamu → doména sa
   priebežne aktualizuje na aktuálnu WAN IP.

> Synology dovoľuje zaregistrovať viac nezávislých DDNS hostname na jeden účet
> (bežne limit ~5 zadarmo) — každá appka na NAS dostane svoj vlastný, napr.
> `rodinna-<meno>.synology.me`, `poznamky-<meno>.synology.me`,
> `lety-<meno>.synology.me`. Nie sú to subdomény jedného mena, ale samostatné
> DDNS záznamy — to je presne to, čo tu potrebujeme.

## 4. Port forwarding na routeri

Presmerovať na internú IP NAS-u (**raz, spoločné pre všetky appky** — smeruje na
zdieľaný edge Caddy):

| Externý port | Interný port | Protokol | Účel |
|---|---|---|---|
| 80 | 80 | TCP | HTTP-01 ACME challenge (Let's Encrypt) + redirect na 443 |
| 443 | 443 | TCP | HTTPS appky |
| 443 | 443 | UDP | HTTP/3 (QUIC) — voliteľné, ale odporúčané |

Ak ISP port 80 blokuje (časté u niektorých mobilných/CGNAT pripojení), Let's Encrypt
HTTP-01 zlyhá — treba DNS-01 challenge (API token u DNS providera) alebo zmenu ISP
plánu. Over najprv jednoducho: `curl -I http://<WAN-IP>` zvonka siete.

## 5. DSM firewall / Control Panel → Security

- **Control Panel → Security → Firewall**: povoliť len porty 80/443 smerom von,
  všetko ostatné (5000/5001 DSM, SSH) nechať blokované z WAN, alebo aspoň obmedziť
  na dôveryhodné IP/VPN.
- **Dôležité:** nepoužívať DSM vstavaný reverse proxy (Control Panel → Login Portal
  → Advanced → Reverse Proxy) pre žiadnu appku — DSM update vie prepísať jeho nginx
  config a appku zhodiť. Celý TLS/reverse-proxy layer nech drží výhradne zdieľaný
  `edge` Caddy z §2.

## 6. Pripojenie `rodinna-siet-v2` k edge vrstve

Repo je na toto už pripravené (`docker-compose.yml`, `infra/caddy/Caddyfile`) —
appka len treba nasadiť a zaregistrovať v zdieľanom Caddyfile.

**`.env` na NAS** (`/volume1/rodinna/compose/.env`, viď README):

```bash
DOMAIN=rodinna-<priezvisko>.synology.me
PUBLIC_WEB_ORIGIN=https://rodinna-<priezvisko>.synology.me
```

`DOMAIN` je dnes len referenčná hodnota (appka sama TLS nerieši — to je úloha
zdieľaného Caddyho), ale musí sedieť s tým, čo je v zdieľanom Caddyfile. Kriticky
dôležité je `PUBLIC_WEB_ORIGIN` — používa sa pre CORS allowlist
(`apps/api/src/core/rpc/app.ts`) a pre link v pozvánkovom e-maile
(`apps/api/src/modules/auth/index.ts`). Musí byť `https://` + presne tá istá
doména, inak CORS zablokuje web volania na `/api/*`.

**Spustiť appku** (interne, bez host portov 80/443):

```bash
cd /volume1/rodinna/compose
docker compose --profile edge up -d --build
```

Appkin `caddy` kontajner sa pripojí do siete `edge` s aliasom `rodinna-web`
(nastavené v `docker-compose.yml`).

**Doplniť site block do zdieľaného Caddyfile** (`/volume1/edge/caddy/Caddyfile`):

```
rodinna-<priezvisko>.synology.me {
	reverse_proxy rodinna-web:80
}
```

**Reštartovať zdieľaný edge Caddy**, aby si nový site block vzal a vybavil cert:

```bash
docker compose -f /volume1/edge/compose/docker-compose.yml restart caddy
docker compose -f /volume1/edge/compose/docker-compose.yml logs -f caddy
```

Sleduj v logu `certificate obtained successfully`. Let's Encrypt má rate limit (5
duplicitných certov / týždeň na doménu) — pri opakovaných testoch radšej najprv over
cez staging CA (`caddy` env `CADDY_ACME_CA` nastavená na
`https://acme-staging-v02.api.letsencrypt.org/directory`), aby sa produkčný limit
nevyčerpal skúšaním.

## 7. Overenie

1. **Z LAN:** `curl -Ik https://rodinna-<priezvisko>.synology.me/api/health` → `200`.
2. **Zvonka LAN (mobilná dáta, wifi vypnuté):** to isté z telefónu → potvrdí, že
   port forwarding + DDNS naozaj fungujú, nie len lokálny DNS/hairpin NAT.
3. **Cert:** v prehliadači skontrolovať, že je platný Let's Encrypt cert (nie
   self-signed) a reťaz nehlási varovanie.
4. **CORS:** prihlásiť sa cez web na doméne, skontrolovať Network tab, že volania
   na `/api/*` prechádzajú bez CORS chyby.
5. Zodpovedá kritériu `ARCHITECTURE_V2.md §14` bod 1.

## 8. Pridanie ďalšej appky (napr. poznámky, zápisník letov)

Rovnaký recept, appky sa navzájom neovplyvňujú:

1. **DDNS** (§3): nový hostname v DSM, napr. `poznamky-<priezvisko>.synology.me`.
2. **Appka**: appkin vlastný `docker-compose.yml` pripojiť do externej siete `edge`
   (rovnaký vzor ako `rodinna-siet-v2` — service, ktorá appku servíruje/proxuje,
   dostane `networks.edge.aliases: [poznamky-web]`), **bez publishovania 80/443**.
3. **Zdieľaný Caddyfile** (`/volume1/edge/caddy/Caddyfile`): pridať ďalší site block:
   ```
   poznamky-<priezvisko>.synology.me {
   	reverse_proxy poznamky-web:80
   }
   ```
4. `docker compose -f /volume1/edge/compose/docker-compose.yml restart caddy` —
   nový cert sa vybaví automaticky, ostatné appky bežia bez prerušenia.

Port forwarding (§4) a DSM firewall (§5) sa nastavujú **len raz** pre celý NAS,
netreba ich opakovať pre ďalšie appky.

> Alternatíva bez ďalšieho DDNS hostname: cesty pod jednou doménou
> (`rodinna-<priezvisko>.synology.me/poznamky`, Caddy `handle_path`) — jednoduchšie
> na DNS/certy, ale appka musí poznať svoj base path. Pri max pár appkách na
> rodinný NAS je samostatný hostname na appku jednoduchšie na údržbu.
>
> Ak appiek pribudne veľa alebo sa má riešiť wildcard cert, je čas prejsť na
> vlastnú doménu (`ARCHITECTURE_V2.md §2` to už počíta ako budúcu možnosť) —
> mení sa len `DOMAIN`/DNS záznam a site blocky v zdieľanom Caddyfile, žiadny
> refactor appiek.

## 9. Priebežná údržba

- DDNS sa obnovuje automaticky (DSM balík), certifikáty obnovuje automaticky
  zdieľaný Caddy (~30 dní pred expiráciou pre každú doménu zvlášť) — bez zásahu,
  pokiaľ zostane funkčný port 80.
- Zálohovať `/volume1/edge/data` (Caddy cert storage) v rámci bežného NAS backupu —
  ušetrí to re-issue certov po výpadku.

## Troubleshooting

| Príznak | Príčina | Riešenie |
|---|---|---|
| Caddy log: `no route to host` / timeout pri ACME | port 80 nie je forwardovaný alebo ISP ho blokuje | over `curl -I http://<WAN-IP>` zvonka, skontroluj router aj DSM firewall |
| `too many certificates already issued` | vyčerpaný Let's Encrypt rate limit z testovania | počkať do reset okna, alebo testovať cez staging CA |
| Web beží, ale API volania padajú na CORS | `PUBLIC_WEB_ORIGIN` nesedí s doménou v prehliadači (napr. chýba/naviac `https://`) | zosynchronizovať s `DOMAIN`, reštartovať `api` |
| `502`/`504` zo zdieľaného edge Caddy | appka nie je pripojená do siete `edge`, zlý alias v `reverse_proxy`, alebo appkin kontajner ešte beží | `docker network inspect edge` — over, že appkin kontajner (napr. `rodinna-web`) je v zozname |
| Appkin vlastný Caddy hlási TLS/ACME chyby | appka si omylom stále myslí, že rieši TLS sama (starý `{$DOMAIN}` block namiesto `:80`) | skontrolovať `infra/caddy/Caddyfile` danej appky — má byť plain `:80`, žiadny doménový match |
| DSM Login Portal preberá port 443 | DSM vlastný reverse proxy/HTTPS beží na rovnakom porte ako zdieľaný edge Caddy | vypnúť DSM HTTPS na porte 443 pre DSM samotné, alebo presmerovať DSM na iný port |

## Lokálne testovanie appky bez zdieľanej edge vrstvy

Pre rýchly lokálny test `--profile edge` (bez reálnej domény, bez NAS-wide Caddyho)
appka síce naštartuje, ale nebude dostupná zvonku bez vlastného port-publishu — na
lokálne overenie stačí `curl` priamo do Docker siete (`docker exec` do iného
kontajnera v rovnakej sieti) alebo dočasne pridať `ports: ['8080:80']` k `caddy`
službe cez lokálny `docker-compose.override.yml` (necommitovať).
