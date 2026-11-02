# Sourced by GitHub workflow steps: exports SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the
# project in $SUPABASE_PROJECT_REF. The key was put in "$RUNNER_TEMP/supabase-service-key" by an
# earlier step that ran scripts/resolve-service-key.sh (decision 0060: the account-wide
# SUPABASE_ACCESS_TOKEN never reaches a step that runs npm code). It is already masked.
# shellcheck shell=bash

_svc_f="${RUNNER_TEMP:-/nonexistent}/supabase-service-key"
if [ ! -s "$_svc_f" ]; then
  echo "::error::No service key: run scripts/resolve-service-key.sh in an earlier step of this job"
  exit 1
fi
export SUPABASE_URL="https://$SUPABASE_PROJECT_REF.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="$(cat "$_svc_f")"
export SUPABASE_SERVICE_ROLE_KEY
unset _svc_f
