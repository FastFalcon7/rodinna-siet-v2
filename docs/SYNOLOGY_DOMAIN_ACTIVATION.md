# Aktivácia Synology domény (DDNS) — postup

> Nadväzuje na `ARCHITECTURE_V2.md §2` (zafixované rozhodnutia), `§12` (deployment na
> DS925+) a `README.md` („Produkčné nasadenie"). Cieľ: dostať appku z `DOMAIN=localhost`
> na verejne dostupnú `rodinna.<meno>.synology.me` s platným Let's Encrypt certom cez
> Caddy — bez zásahu do kódu, len konfigurácia.

## 0. Predpoklady

- Synology účet (Synology Account) prihlásený v DSM.
- Admin prístup do DSM na DS925+ a do routera/firewallu pred ním.
- NAS beží, `docker compose --profile edge` je pripravený (Caddy image existuje —
  `infra/docker/web.Dockerfile` + `infra/caddy/Caddyfile`).
- Statická/rezervovaná lokálna IP pre NAS v LAN (DHCP reservation na routeri),
  aby port forwarding neprestal fungovať po reštarte NAS.

## 1. DDNS v DSM

1. **Control Panel → External Access → DDNS → Add**.
2. Poskytovateľ: **Synology**, prihlásiť sa cez Synology Account (ak ešte nie je
   párovaný).
3. Zvoliť hostname, napr. `rodinna-<priezvisko>` → vznikne
   `rodinna-<priezvisko>.synology.me`.
4. **Nechať vypnuté** „Zapnúť Heartbeat (HTTPS)" / DSM built-in cert manažment pre
   túto doménu — TLS rieši Caddy v Dockeri, nie DSM (viď §12 pozn. nižšie).
5. Test: DSM ukáže zelenú fajku „Normal" pri statuse DDNS záznamu → doména sa
   priebežne aktualizuje na aktuálnu WAN IP.

## 2. Port forwarding na routeri

Presmerovať na internú IP NAS-u:

| Externý port | Interný port | Protokol | Účel |
|---|---|---|---|
| 80 | 80 | TCP | HTTP-01 ACME challenge (Let's Encrypt) + redirect na 443 |
| 443 | 443 | TCP | HTTPS appka |
| 443 | 443 | UDP | HTTP/3 (QUIC) — Caddy ho vie použiť, voliteľné ale odporúčané |

Ak ISP port 80 blokuje (časté u niektorých mobilných/CGNAT pripojení), Let's Encrypt
HTTP-01 zlyhá — treba DNS-01 challenge (vyžaduje API token u DNS providera) alebo
zmenu ISP plánu. Over najprv jednoducho: `curl -I http://<WAN-IP>` zvonka siete.

## 3. DSM firewall / Control Panel → Security

- **Control Panel → Security → Firewall**: povoliť len porty 80/443 smerom von,
  všetko ostatné (5000/5001 DSM, SSH) nechať blokované z WAN, alebo aspoň
  obmedziť na dôveryhodné IP/VPN.
- **Dôležité (už v `ARCHITECTURE_V2.md §12`):** nepoužívať DSM vstavaný reverse
  proxy (Control Panel → Login Portal → Advanced → Reverse Proxy) pre túto doménu —
  DSM update vie prepísať jeho nginx config a zhodí appku. Celý TLS/reverse-proxy
  layer nech drží výhradne `caddy` kontajner.

## 4. Konfigurácia projektu (`.env` na NAS)

V `/volume1/rodinna/compose/.env` (alebo kde je nasadený `.env`, viď README):

```bash
DOMAIN=rodinna-<priezvisko>.synology.me
PUBLIC_WEB_ORIGIN=https://rodinna-<priezvisko>.synology.me
```

`DOMAIN` ide priamo do `infra/caddy/Caddyfile` (Caddy site block + auto-TLS),
`PUBLIC_WEB_ORIGIN` do `apps/api/src/config/env.ts` → používa sa pre CORS
allowlist (`apps/api/src/core/rpc/app.ts`) a pre link v pozvánkovom e-maile
(`apps/api/src/modules/auth/index.ts`). Obe musia byť konzistentné (rovnaká
doména, `https://`), inak CORS zablokuje web volania na `/api/*`.

## 5. Naštartovať / reštartovať edge profil

```bash
cd /volume1/rodinna/compose
docker compose --profile edge up -d --build
docker compose logs -f caddy
```

Prvé spustenie s reálnou doménou si Caddy vyžiada cert od Let's Encrypt
automaticky (žiadny manuálny krok) — v logu sleduj `certificate obtained
successfully`. Let's Encrypt má rate limit (5 duplicitných certov / týždeň na
doménu) — pri opakovaných testoch radšej najprv over na
`https://acme-staging-v02.api.letsencrypt.org` (Caddy env `CADDY_ACME_CA`), aby
sa produkčný limit nevyčerpal skúšaním.

## 6. Overenie

1. **Z LAN:** `curl -Ik https://rodinna-<priezvisko>.synology.me/api/health` → `200`.
2. **Zvonka LAN (mobilná dáta, wifi vypnuté):** to isté z telefónu → potvrdí, že
   port forwarding + DDNS naozaj fungujú, nie len lokálny DNS/hairpin NAT.
3. **Cert:** v prehliadači skontrolovať, že je platný Let's Encrypt cert (nie
   self-signed) a reťaz nehlási varovanie.
4. **CORS:** prihlásiť sa cez web na doméne, skontrolovať Network tab, že
   volania na `/api/*` prechádzajú bez CORS chyby.
5. Zodpovedá kritériu `ARCHITECTURE_V2.md §14` bod 1.

## 7. Priebežná údržba

- DDNS sa obnovuje automaticky (DSM balík), certifikát obnovuje automaticky
  Caddy (~30 dní pred expiráciou) — bez zásahu, pokiaľ zostane funkčný port 80.
- Ak sa niekedy prejde na vlastnú doménu (spomenuté v `ARCHITECTURE_V2.md §2`
  ako budúca možnosť): stačí zmeniť `DOMAIN` + `PUBLIC_WEB_ORIGIN` v `.env`,
  nasmerovať A/AAAA (alebo CNAME) záznam na WAN IP, reštartovať `caddy` — žiadny
  refactor kódu.

## Troubleshooting

| Príznak | Príčina | Riešenie |
|---|---|---|
| Caddy log: `no route to host` / timeout pri ACME | port 80 nie je forwardovaný alebo ISP ho blokuje | over `curl -I http://<WAN-IP>` zvonka, skontroluj router aj DSM firewall |
| `too many certificates already issued` | vyčerpaný Let's Encrypt rate limit z testovania | počkať do reset okna, alebo testovať cez staging CA |
| Web beží, ale API volania padajú na CORS | `PUBLIC_WEB_ORIGIN` nesedí s doménou v prehliadači (napr. chýba/naviac `https://`) | zosynchronizovať s `DOMAIN`, reštartovať `api` |
| DSM Login Portal preberá port 443 | DSM vlastný reverse proxy/HTTPS beží na rovnakom porte ako Caddy kontajner | vypnúť DSM HTTPS na porte 443 pre DSM samotné, alebo presmerovať DSM na iný port |
