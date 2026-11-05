#!/usr/bin/env bash
# Prints public.ops_health() (migration 20261103000400, decision 0060) and
# public.ops_storage_health() (20261106000510, decision 0075) and fails when a check says
# 'fail', so the nightly workflow run turns red and GitHub e-mails the owner. 'warn' rows
# become workflow warnings, except the checks in ESCALATE (default: db_size), whose warning
# e-mails too: a database past 350 MB must reach the owner before it is full, not when it is.
# DB_URL_FILE: the file scripts/supabase-db-url.sh wrote.
set -euo pipefail
: "${DB_URL_FILE:?DB_URL_FILE is not set}"
ESCALATE="${ESCALATE:-db_size}"
url="$(cat "$DB_URL_FILE")"
rows=$(PGCONNECT_TIMEOUT=15 psql "$url" -v ON_ERROR_STOP=1 -qAt -F $'\t' \
  -c 'select check_name, status, detail from public.ops_health()')
# Older backends (before 20261106000510) have no storage check yet.
if storage=$(PGCONNECT_TIMEOUT=15 psql "$url" -v ON_ERROR_STOP=1 -qAt -F $'\t' \
  -c 'select check_name, status, detail from public.ops_storage_health()' 2>/dev/null); then
  rows+=$'\n'"$storage"
fi
failed=0
summary="| Check | Status | Detail |"$'\n'"| --- | --- | --- |"
while IFS=$'\t' read -r name status detail; do
  [ -n "$name" ] || continue
  printf '%-24s %-5s %s\n' "$name" "$status" "$detail"
  summary+=$'\n'"| $name | $status | $detail |"
  if [ "$status" = warn ] && [[ " $ESCALATE " == *" $name "* ]]; then
    status=fail
  fi
  case "$status" in
    fail) echo "::error title=Health: $name::$detail"; failed=1 ;;
    warn) echo "::warning title=Health: $name::$detail" ;;
  esac
done <<< "$rows"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "### Backend health"; echo; echo "$summary"; } >> "$GITHUB_STEP_SUMMARY"
fi
exit $failed
