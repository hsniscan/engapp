#!/usr/bin/env bash
# Run as its own workflow step, right after checkout and BEFORE `pnpm install` (decision 0060).
# It is the only step of a job workflow that sees SUPABASE_ACCESS_TOKEN (an account-wide
# personal access token): no npm package code runs while the token is in the environment.
# The project's service key comes from SERVICE_KEY_SECRET (the SUPABASE_SERVICE_ROLE_KEY secret,
# preferred) or else is read once through the Management API. It is masked in the log and
# written to "$RUNNER_TEMP/supabase-service-key" (mode 600), which
# scripts/supabase-service-env.sh reads in the later steps. The API answer goes to a private
# temp file that is deleted at once.
set -euo pipefail
umask 077
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is not set}"
out="${RUNNER_TEMP:?RUNNER_TEMP is not set}/supabase-service-key"
key="${SERVICE_KEY_SECRET:-}"
if [ -z "$key" ]; then
  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    echo "::error::Set SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ACCESS_TOKEN with API key read access (docs/setup-backend.md)"
    exit 1
  fi
  echo "::warning::The SUPABASE_SERVICE_ROLE_KEY secret is not set; reading the key with the account-wide SUPABASE_ACCESS_TOKEN. Add the secret (docs/setup-backend.md) so job workflows do not need the token."
  f="$(mktemp)"
  trap 'rm -f "$f"' EXIT
  status=$(curl -sS -o "$f" -w '%{http_code}' \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/api-keys?reveal=true")
  if [ "$status" != "200" ]; then
    echo "::error::Could not read the project's API keys (HTTP $status). Set the SUPABASE_SERVICE_ROLE_KEY secret instead."
    exit 1
  fi
  key=$(jq -r '([.[] | select(.type == "secret")] + [.[] | select(.name == "service_role")])[0].api_key // empty' "$f")
  if [ -z "$key" ]; then echo "::error::No secret or service_role key found"; exit 1; fi
fi
echo "::add-mask::$key"
printf '%s' "$key" > "$out"
echo "Service key ready for the later steps."
