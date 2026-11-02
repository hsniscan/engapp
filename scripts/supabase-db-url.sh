#!/usr/bin/env bash
# Finds a working Postgres URL for the project and writes it to "$RUNNER_TEMP/db-url" (mode
# 600) for the later steps of the job (decision 0060). GitHub runners have no IPv6 and the
# direct database host is IPv6-only, so the URL points at the project's IPv4 session pooler
# (port 5432, which also serves pg_dump).
#   SUPABASE_PROJECT_REF, SUPABASE_REGION, SUPABASE_DB_PASSWORD   required
#   SUPABASE_ACCESS_TOKEN   optional: reads the exact pooler host through the Management API;
#                           without it (or without 'Connection Pooling: Read') the regional
#                           pooler hosts are tried.
# Needs psql (installed when missing). The password is masked and never printed.
set -euo pipefail
umask 077
: "${SUPABASE_PROJECT_REF:?}" "${SUPABASE_REGION:?}" "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is not set}"
out="${RUNNER_TEMP:?}/db-url"
command -v psql >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client >/dev/null; }
pass=$(jq -rn --arg p "$SUPABASE_DB_PASSWORD" '$p|@uri')
echo "::add-mask::$pass"
candidates=()
if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  f="$(mktemp)"
  trap 'rm -f "$f"' EXIT
  status=$(curl -sS -o "$f" -w '%{http_code}' \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/database/pooler" || true)
  if [ "$status" = "200" ]; then
    host=$(jq -r '[.[] | select(.database_type == "PRIMARY")][0].db_host // empty' "$f")
    user=$(jq -r '[.[] | select(.database_type == "PRIMARY")][0].db_user // empty' "$f")
    name=$(jq -r '[.[] | select(.database_type == "PRIMARY")][0].db_name // empty' "$f")
    if [ -n "$host" ] && [ -n "$user" ] && [ -n "$name" ]; then
      candidates+=("postgresql://$user:$pass@$host:5432/$name")
    fi
  else
    echo "::warning::Pooler config not readable (HTTP $status); trying regional pooler hosts."
  fi
fi
for host in "aws-0-$SUPABASE_REGION.pooler.supabase.com" "aws-1-$SUPABASE_REGION.pooler.supabase.com"; do
  candidates+=("postgresql://postgres.$SUPABASE_PROJECT_REF:$pass@$host:5432/postgres")
done
for url in "${candidates[@]}"; do
  if PGCONNECT_TIMEOUT=15 psql "$url" -qAtc 'select 1' >/dev/null 2>&1; then
    printf '%s' "$url" > "$out"
    echo "Database reachable."
    exit 0
  fi
done
echo "::error::Could not reach the database pooler. Check SUPABASE_DB_PASSWORD (and give SUPABASE_ACCESS_TOKEN the 'Connection Pooling: Read' permission)."
exit 1
