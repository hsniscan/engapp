#!/usr/bin/env bash
# Prints public.ops_health() (migration 20261103000400, decision 0060), and once deployed
# public.ops_storage_health() (20261106000510, decision 0075) and public.ops_health_reliability()
# (20261106000620, decision 0076: backup age, pg_cron's GitHub dispatches, users' errors,
# edge-function failures, AI fallbacks and quota refusals). Fails when a check says 'fail', so
# the workflow run turns red and GitHub e-mails the owner. 'warn' rows become workflow warnings,
# except the checks in ESCALATE (default: db_size), whose warning e-mails too.
# DB_URL_FILE: the file scripts/supabase-db-url.sh wrote. The run log of a public repository is
# readable by anyone: the functions return counts, names, codes and fingerprints only.
set -euo pipefail
: "${DB_URL_FILE:?DB_URL_FILE is not set}"
ESCALATE="${ESCALATE:-db_size}"
url="$(cat "$DB_URL_FILE")"
sql='select check_name, status, detail from public.ops_health()'
for fn in ops_storage_health ops_health_reliability; do
  has=$(PGCONNECT_TIMEOUT=15 psql "$url" -v ON_ERROR_STOP=1 -qAt \
    -c "select to_regprocedure('public.${fn}()') is not null")
  if [ "$has" = "t" ]; then
    sql+=" union all select check_name, status, detail from public.${fn}()"
  fi
done
rows=$(PGCONNECT_TIMEOUT=15 psql "$url" -v ON_ERROR_STOP=1 -qAt -F $'\t' -c "$sql")
failed=0
summary="| Check | Status | Detail |"$'\n'"| --- | --- | --- |"
while IFS=$'\t' read -r name status detail; do
  [ -n "$name" ] || continue
  printf '%-24s %-5s %s\n' "$name" "$status" "$detail"
  summary+=$'\n'"| $name | $status | ${detail//|//} |"
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
