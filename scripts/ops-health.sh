#!/usr/bin/env bash
# Prints public.ops_health() (migration 20261103000400, decision 0060) and, once deployed,
# public.ops_health_reliability() (20261106000620, decision 0076: backup age, pg_cron's GitHub
# dispatches, users' errors, edge-function failures, AI fallbacks and quota refusals). Fails
# when a check says 'fail', so the workflow run turns red and GitHub e-mails the owner. 'warn'
# rows become workflow warnings. DB_URL_FILE: the file scripts/supabase-db-url.sh wrote.
# The run log of a public repository is readable by anyone: the functions return counts,
# names, codes and fingerprints only.
set -euo pipefail
: "${DB_URL_FILE:?DB_URL_FILE is not set}"
sql='select check_name, status, detail from public.ops_health()'
has_extra=$(PGCONNECT_TIMEOUT=15 psql "$(cat "$DB_URL_FILE")" -v ON_ERROR_STOP=1 -qAt \
  -c "select to_regprocedure('public.ops_health_reliability()') is not null")
if [ "$has_extra" = "t" ]; then
  sql+=' union all select check_name, status, detail from public.ops_health_reliability()'
fi
rows=$(PGCONNECT_TIMEOUT=15 psql "$(cat "$DB_URL_FILE")" -v ON_ERROR_STOP=1 -qAt -F $'\t' -c "$sql")
failed=0
summary="| Check | Status | Detail |"$'\n'"| --- | --- | --- |"
while IFS=$'\t' read -r name status detail; do
  [ -n "$name" ] || continue
  printf '%-24s %-5s %s\n' "$name" "$status" "$detail"
  summary+=$'\n'"| $name | $status | ${detail//|//} |"
  case "$status" in
    fail) echo "::error title=Health: $name::$detail"; failed=1 ;;
    warn) echo "::warning title=Health: $name::$detail" ;;
  esac
done <<< "$rows"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "### Backend health"; echo; echo "$summary"; } >> "$GITHUB_STEP_SUMMARY"
fi
exit $failed
