#!/usr/bin/env bash
# S10.3: one encrypted copy of the database, written to the path given as the first argument.
#
#   BACKUP_DATABASE_URL   a connection string that can read every table in `public` past row level security (the owner role's URL does)
#   BACKUP_AGE_RECIPIENT  the PUBLIC key (age1...) the file is encrypted to; the private key stays with the owner, never on GitHub
#
# pg_dump streams straight into age, so an unencrypted copy never touches the disk. `pipefail` makes a failed dump fail the script even
# though age succeeds on an empty input, and the size check refuses a file that is only the age header.
set -euo pipefail

out="${1:?usage: backup-db.sh <output-file>}"
: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is not set}"

case "$BACKUP_AGE_RECIPIENT" in
  age1*) ;;
  *) echo "BACKUP_AGE_RECIPIENT must be an age PUBLIC key (it starts with age1). Never put the private key in a secret." >&2; exit 2 ;;
esac

umask 077
rm -f "$out"
# A failed dump still leaves age having written its header, so any failure from here on removes the file: a leftover must never be taken for a backup.
trap 'status=$?; [ "$status" -eq 0 ] || rm -f "$out"' EXIT
# Only our own schema: Neon manages `neon_auth`, and its tables hold sessions and tokens that a backup file must not carry.
pg_dump --format=custom --no-owner --schema=public "$BACKUP_DATABASE_URL" | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$out"

size="$(wc -c < "$out")"
if [ "$size" -lt 1024 ]; then
  echo "The backup is only $size bytes: the dump did not produce data." >&2
  rm -f "$out"
  exit 1
fi
echo "Backup written: $out ($size bytes, encrypted)"
