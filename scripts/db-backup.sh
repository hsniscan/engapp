#!/usr/bin/env bash
# Dumps the production database, encrypts the dump and uploads it to Cloudflare R2, then
# deletes old copies (decision 0060, restore steps: docs/runbook-backup-restore.md).
#
#   scripts/db-backup.sh daily           nightly copy; on Sundays also kept as the weekly copy
#   scripts/db-backup.sh pre-migration   taken by deploy-supabase.yml right before `db push`
#
# Environment:
#   DB_URL_FILE            file holding the Postgres URL (scripts/supabase-db-url.sh writes it)
#   BACKUP_PASSPHRASE      required: the dump is encrypted with it (gpg, AES-256). Keep a copy
#                          outside GitHub: without it no backup can be read.
#   R2_ACCOUNT_ID          required
#   R2_BACKUP_BUCKET, R2_BACKUP_ACCESS_KEY_ID, R2_BACKUP_SECRET_ACCESS_KEY
#                          a private bucket only for backups (recommended); when they are not
#                          set, R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (the audio
#                          bucket) are used under backups/ - safe only because of the encryption.
#   KEEP_DAILY (14), KEEP_WEEKLY (8), KEEP_PRE_MIGRATION (10)
# Tools: supabase CLI (uses Docker), docker, gpg, aws CLI (preinstalled on GitHub runners).
# Nothing secret is printed: the URL, keys and passphrase only travel in env and private files.
set -euo pipefail
umask 077
kind="${1:-}"
case "$kind" in daily|pre-migration) ;; *) echo "usage: db-backup.sh daily|pre-migration" >&2; exit 2 ;; esac

: "${DB_URL_FILE:?DB_URL_FILE is not set}" "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}" "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is not set}"
bucket="${R2_BACKUP_BUCKET:-${R2_BUCKET:-}}"
access="${R2_BACKUP_ACCESS_KEY_ID:-${R2_ACCESS_KEY_ID:-}}"
secret="${R2_BACKUP_SECRET_ACCESS_KEY:-${R2_SECRET_ACCESS_KEY:-}}"
if [ -z "$bucket" ] || [ -z "$access" ] || [ -z "$secret" ]; then
  echo "::error::No R2 bucket/key for backups (R2_BACKUP_* or R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY)"; exit 1
fi
if [ -z "${R2_BACKUP_BUCKET:-}" ]; then
  echo "::warning::R2_BACKUP_BUCKET is not set: the encrypted backup goes to the audio bucket under backups/. A separate private bucket is safer (docs/runbook-backup-restore.md)."
fi
url="$(cat "$DB_URL_FILE")"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/dump"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"

# 1. The Supabase way (restore: roles, schema, data with psql), plus a pg_dump custom-format
#    copy of public + auth that can restore single tables (pg_restore -t).
supabase db dump --db-url "$url" -f "$work/dump/roles.sql" --role-only
supabase db dump --db-url "$url" -f "$work/dump/schema.sql"
supabase db dump --db-url "$url" -f "$work/dump/data.sql" --use-copy --data-only
docker run --rm --network host -e PGURL="$url" -v "$work/dump:/out" postgres:17 \
  sh -c 'pg_dump "$PGURL" --format=custom --no-owner --no-privileges --schema=public --schema=auth --file=/out/public-auth.dump'

# 2. Sanity: an empty or truncated dump must fail loudly, not overwrite good copies.
for f in roles.sql schema.sql data.sql public-auth.dump; do
  [ -s "$work/dump/$f" ] || { echo "::error::$f is empty"; exit 1; }
done
grep -q 'CREATE TABLE IF NOT EXISTS "public"."review_logs"\|CREATE TABLE "public"."review_logs"' "$work/dump/schema.sql" \
  || { echo "::error::schema.sql has no public.review_logs table"; exit 1; }
grep -q 'COPY "public"."review_logs"\|"public"."review_logs"' "$work/dump/data.sql" \
  || { echo "::error::data.sql has no public.review_logs data block"; exit 1; }
users=$(PGCONNECT_TIMEOUT=15 psql "$url" -qAtc 'select count(*) from auth.users')
{
  echo "kind=$kind"
  echo "created_at=$stamp"
  echo "git_sha=${GITHUB_SHA:-unknown}"
  echo "auth_users=$users"
  (cd "$work/dump" && sha256sum roles.sql schema.sql data.sql public-auth.dump)
} > "$work/dump/MANIFEST"

# 3. Pack + encrypt.
printf '%s' "$BACKUP_PASSPHRASE" > "$work/pass"
tar -C "$work/dump" -czf - . \
  | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$work/pass" \
      --symmetric --cipher-algo AES256 -o "$work/backup.tar.gz.gpg"
rm -f "$work/pass"
size=$(stat -c %s "$work/backup.tar.gz.gpg")

# 4. Upload + retention.
export AWS_ACCESS_KEY_ID="$access" AWS_SECRET_ACCESS_KEY="$secret" AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
endpoint="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
s3() { aws --endpoint-url "$endpoint" "$@"; }

put() { s3 s3 cp --only-show-errors "$work/backup.tar.gz.gpg" "s3://$bucket/backups/$1/$stamp.tar.gz.gpg"; }
prune() { # prefix keep
  local keys
  keys=$(s3 s3api list-objects-v2 --bucket "$bucket" --prefix "backups/$1/" --query 'Contents[].Key' --output text | tr '\t' '\n' | grep '\.tar\.gz\.gpg$' | sort || true)
  local n
  n=$(printf '%s\n' "$keys" | grep -c . || true)
  if [ "$n" -gt "$2" ]; then
    printf '%s\n' "$keys" | head -n "$((n - $2))" | while read -r k; do
      s3 s3 rm --only-show-errors "s3://$bucket/$k"
      echo "deleted old backup $k"
    done
  fi
}

if [ "$kind" = daily ]; then
  put daily
  prune daily "${KEEP_DAILY:-14}"
  if [ "$(date -u +%u)" = 7 ]; then put weekly; prune weekly "${KEEP_WEEKLY:-8}"; fi
else
  put pre-migration
  prune pre-migration "${KEEP_PRE_MIGRATION:-10}"
fi
# Heartbeat (job_runs): ops_health() fails when the nightly backup stops running.
if [ "$kind" = daily ]; then
  PGCONNECT_TIMEOUT=15 psql "$url" -v ON_ERROR_STOP=1 -qAt \
    -c "select public.job_heartbeat('db-backup', 'ok', jsonb_build_object('kb', $((size / 1024))))" >/dev/null \
    || echo "::warning::Could not write the backup heartbeat (migration 20261103000400 not deployed yet?)"
fi
echo "Backup $kind/$stamp uploaded ($((size / 1024)) KB, $users users)."
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "Database backup **$kind** \`$stamp\`: $((size / 1024)) KB, $users users." >> "$GITHUB_STEP_SUMMARY"
fi
