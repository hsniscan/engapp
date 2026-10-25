# Sourced by GitHub workflow steps (tts-pregen.yml): exports SUPABASE_URL and
# SUPABASE_SERVICE_ROLE_KEY for the project in $SUPABASE_PROJECT_REF, the same way the word
# bank job does. The key comes from SERVICE_KEY_SECRET (the SUPABASE_SERVICE_ROLE_KEY secret),
# or else is read through the Management API with SUPABASE_ACCESS_TOKEN. It is masked in the
# log and never printed; the API answer goes to a private temp file that is deleted at once.
# shellcheck shell=bash

_tts_key="${SERVICE_KEY_SECRET:-}"
if [ -z "$_tts_key" ]; then
  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    echo "::error::Set SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ACCESS_TOKEN with API key read access (docs/setup-backend.md)"
    exit 1
  fi
  _tts_f="$(umask 077 && mktemp)"
  _tts_status=$(curl -sS -o "$_tts_f" -w '%{http_code}' \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/api-keys?reveal=true")
  if [ "$_tts_status" != "200" ]; then
    rm -f "$_tts_f"
    echo "::error::Could not read the project's API keys (HTTP $_tts_status). Set the SUPABASE_SERVICE_ROLE_KEY secret instead."
    exit 1
  fi
  _tts_key=$(jq -r '([.[] | select(.type == "secret")] + [.[] | select(.name == "service_role")])[0].api_key // empty' "$_tts_f")
  rm -f "$_tts_f"
  if [ -z "$_tts_key" ]; then echo "::error::No secret or service_role key found"; exit 1; fi
fi
echo "::add-mask::$_tts_key"
export SUPABASE_URL="https://$SUPABASE_PROJECT_REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="$_tts_key"
unset _tts_key _tts_f _tts_status
