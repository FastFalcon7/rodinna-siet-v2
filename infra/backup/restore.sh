#!/usr/bin/env sh
# ── Rodinná Sieť — obnova DB zo zálohy (restore drill) ───────────────────────
# Obnoví Postgres z pg_dump súboru vytvoreného backup.sh. Používa sa pri
# havárii aj pri POVINNOM restore drille (ARCHITECTURE_V2 §14.6).
#
# POZOR: prepíše obsah databázy `POSTGRES_DB`. Spúšťaj vedome.
#
# Použitie:
#   COMPOSE_DIR=/volume1/rodinna/compose \
#   sh infra/backup/restore.sh /volume1/rodinna/backups/db-2026-07-06_030000.dump
#
# Postup, ktorý skript robí:
#   1) skopíruje dump do postgres kontajnera
#   2) pg_restore --clean --if-exists (zmaže existujúce objekty a naleje znova)
#   3) pripomenie reštart api/worker (kvôli čistému stavu poolu)
set -eu

DUMP="${1:?Použitie: restore.sh <cesta-k-.dump>}"
COMPOSE_DIR="${COMPOSE_DIR:-/volume1/rodinna/compose}"
PG_USER="${POSTGRES_USER:-rodinna}"
PG_DB="${POSTGRES_DB:-rodinna}"

if [ ! -s "$DUMP" ]; then
  echo "[restore] CHYBA: súbor '$DUMP' neexistuje alebo je prázdny" >&2
  exit 1
fi

cd "$COMPOSE_DIR"

echo "[restore] kopírujem dump do kontajnera…"
docker compose cp "$DUMP" postgres:/tmp/restore.dump

echo "[restore] pg_restore --clean --if-exists → DB '${PG_DB}'…"
# --clean --if-exists = idempotentný prepis; -j pre paralelný restore.
# pgvector rozšírenie sa v dumpe nesie (CREATE EXTENSION), takže sa obnoví samo.
docker compose exec -T postgres \
  pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists --no-owner --no-privileges -j 2 /tmp/restore.dump

docker compose exec -T postgres rm -f /tmp/restore.dump

echo "[restore] hotovo. Reštartujem api + worker pre čistý stav poolu…"
docker compose restart api worker

echo "[restore] OK — over prihlásenie a že dáta sedia (restore drill checklist v docs/DEPLOY_RUNBOOK.md)."
