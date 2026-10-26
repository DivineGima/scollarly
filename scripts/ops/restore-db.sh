#!/usr/bin/env bash
# S10.4: restores an encrypted backup made by backup-db.sh.
#
#   RESTORE_DATABASE_URL  the EMPTY (or disposable) database to restore into. Use a new Neon branch first, never production by hand.
#
#   bash scripts/ops/restore-db.sh <backup.dump.age> <private-key-file>
#
# The target must already have the `app_runtime` role and, for the functions that read Neon Auth, the `neon_auth` schema (a Neon branch
# of the project has both). See docs/recovery.md for the whole procedure and the checks to run afterwards.
set -euo pipefail

dump="${1:?usage: restore-db.sh <backup.dump.age> <private-key-file>}"
identity="${2:?usage: restore-db.sh <backup.dump.age> <private-key-file>}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is not set}"

age --decrypt --identity "$identity" "$dump" | pg_restore --no-owner --clean --if-exists --exit-on-error --dbname "$RESTORE_DATABASE_URL"
echo "Restore finished. Now run the checks in docs/recovery.md (row counts, a sign-in, the Health page)."
