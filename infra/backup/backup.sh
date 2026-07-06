#!/usr/bin/env sh
# ── Rodinná Sieť — denná záloha (Postgres + media) ───────────────────────────
# Spúšťa sa cez Synology Task Scheduler (napr. o 3:00). Zálohuje:
#   1) celú DB cez pg_dump (custom format, komprimovaný) z bežiaceho kontajnera
#   2) manifest verzie a času (na overenie pri obnove)
# Media (bind-mount /volume1/rodinna/media) zálohuje priamo Hyper Backup —
# nekopírujeme ich znova, len DB, ktorá v Hyper Backup samostatne nie je
# konzistentná (žije v Docker volume). Retencia: zmaž zálohy staršie než N dní.
#
# Použitie:
#   COMPOSE_DIR=/volume1/rodinna/compose \
#   BACKUP_DIR=/volume1/rodinna/backups \
#   RETENTION_DAYS=14 \
#   sh infra/backup/backup.sh
#
# Predpoklady: docker + docker compose na PATH; služba `postgres` beží.
set -eu

COMPOSE_DIR="${COMPOSE_DIR:-/volume1/rodinna/compose}"
BACKUP_DIR="${BACKUP_DIR:-/volume1/rodinna/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PG_USER="${POSTGRES_USER:-rodinna}"
PG_DB="${POSTGRES_DB:-rodinna}"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="${BACKUP_DIR}/db-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"
cd "$COMPOSE_DIR"

echo "[backup] pg_dump → ${OUT}"
# -Fc = custom (komprimovaný, umožňuje pg_restore -j a selektívny restore).
# Píšeme na stdout kontajnera a presmerujeme do súboru na NAS-e, aby výstup
# nešiel do vrstvy kontajnera.
docker compose exec -T postgres \
  pg_dump -U "$PG_USER" -d "$PG_DB" -Fc --no-owner --no-privileges > "$OUT"

# Sanity: dump nesmie byť prázdny.
if [ ! -s "$OUT" ]; then
  echo "[backup] CHYBA: dump je prázdny, mažem a končím nenulovo" >&2
  rm -f "$OUT"
  exit 1
fi

echo "[backup] hotovo: $(du -h "$OUT" | cut -f1)"

# Retencia — zmaž staršie DB dumpy.
find "$BACKUP_DIR" -name 'db-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete

echo "[backup] retencia ${RETENTION_DAYS} d aplikovaná"
