#!/usr/bin/env bash
# S10.3 exit criteria, run in CI (.github/workflows/backup-selftest.yml): the weekly dump workflow's two scripts against a throwaway database.
#   1. dump + encrypt with a throwaway key,
#   2. the file is encrypted (the marker is not readable in it) and the wrong key cannot open it,
#   3. decrypt + restore into a second, empty database and compare what is in it,
#   4. a dump that fails (an unreachable database) makes the script FAIL, which is what makes GitHub notify the owner.
#
#   ADMIN_URL  a superuser connection to the server (to create the two databases)
set -euo pipefail

: "${ADMIN_URL:?ADMIN_URL is not set}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

base="${ADMIN_URL%/*}"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "drop database if exists selftest_source" -c "drop database if exists selftest_restored" -c "create database selftest_source" -c "create database selftest_restored"
# The role the policies and grants name. Neon projects have it already; a plain Postgres needs it before the migrations run.
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'app_runtime') then create role app_runtime nologin; end if; end \$\$"

source_url="$base/selftest_source"
restored_url="$base/selftest_restored"

SELFTEST_DATABASE_URL="$source_url" npx tsx scripts/ops/selftest-db.ts

age-keygen -o "$work/key.txt" 2> "$work/key.log"
recipient="$(age-keygen -y "$work/key.txt")"
age-keygen -o "$work/other.txt" 2> /dev/null

BACKUP_DATABASE_URL="$source_url" BACKUP_AGE_RECIPIENT="$recipient" bash scripts/ops/backup-db.sh "$work/backup.dump.age"

echo "-- the file is encrypted"
if grep -aq "Backup Marker Person" "$work/backup.dump.age"; then echo "The marker is readable in the backup: it is not encrypted." >&2; exit 1; fi
if age --decrypt --identity "$work/other.txt" "$work/backup.dump.age" > /dev/null 2>&1; then echo "A different key opened the backup." >&2; exit 1; fi

echo "-- restore into an empty database"
psql "$restored_url" -v ON_ERROR_STOP=1 -c "create schema if not exists neon_auth" > /dev/null
RESTORE_DATABASE_URL="$restored_url" bash scripts/ops/restore-db.sh "$work/backup.dump.age" "$work/key.txt"

echo "-- compare"
query="select (select count(*) from lead) || ',' || (select count(*) from placement_payment) || ',' || (select count(*) from media_asset) || ',' || (select name from lead limit 1) || ',' || (select amount_usd_cents from placement_payment limit 1) || ',' || (select count(*) from pg_policies where schemaname = 'public') || ',' || (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity)"
a="$(psql "$source_url" -At -c "$query")"
b="$(psql "$restored_url" -At -c "$query")"
echo "source:   $a"
echo "restored: $b"
[ "$a" = "$b" ] || { echo "The restored database differs from the source." >&2; exit 1; }
# The guard on payments came back too (a trigger and its function are part of the dump).
psql "$restored_url" -At -c "select count(*) from pg_trigger where tgname = 'placement_payment_guard'" | grep -qx 1

echo "-- a failed dump fails the script (this is the forced failure that reaches the owner)"
if BACKUP_DATABASE_URL="postgres://nobody:nothing@127.0.0.1:1/none" BACKUP_AGE_RECIPIENT="$recipient" bash scripts/ops/backup-db.sh "$work/never.dump.age" > /dev/null 2>&1; then
  echo "A backup of an unreachable database reported success." >&2
  exit 1
fi
[ ! -s "$work/never.dump.age" ] || { echo "A failed backup left a file behind." >&2; exit 1; }
echo "Backup round trip: OK"
