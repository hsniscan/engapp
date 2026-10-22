#!/usr/bin/env bash
# Creates the Engapp upload key (Google Play "upload key"): the one key that signs the release
# APK you sideload AND every bundle uploaded to Play. docs/setup-android.md, step 2.
#
#   scripts/make-upload-key.sh <folder>
#
# Writes, inside <folder> (created if needed, never inside the repository):
#   engapp-upload.jks          the keystore (PKCS12, RSA 4096, valid 30 years, alias "engapp")
#   engapp-upload.jks.base64   the same file in base64, to paste into the GitHub secret
#                              ANDROID_KEYSTORE_BASE64
# and prints the certificate's SHA-1 and SHA-256 (public; they go into Google Cloud).
#
# The password is read from the terminal without echo (or from ENGAPP_KEYSTORE_PASSWORD) and is
# passed to keytool through the environment, so it never appears on a command line or in output.
# Needs `keytool` (any JDK 17+, e.g. Android Studio's bundled JBR) and `base64`.
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

[ $# -eq 1 ] || die "usage: $0 <folder>   (e.g. a private folder outside the repository)"
dir="$1"
command -v keytool >/dev/null || die "keytool not found: install a JDK or add Android Studio's jbr/bin to PATH"
command -v base64 >/dev/null || die "base64 not found"

mkdir -p "$dir"
dir="$(cd "$dir" && pwd)"
repo="$(cd "$(dirname "$0")/.." && pwd)"
case "$dir/" in
  "$repo"/*) die "refusing to write a signing key inside the repository ($repo)" ;;
esac

ks="$dir/engapp-upload.jks"
b64="$dir/engapp-upload.jks.base64"
alias_name="engapp"
[ -e "$ks" ] && die "$ks already exists; never replace an upload key that is in use (move it away first)"

if [ -z "${ENGAPP_KEYSTORE_PASSWORD:-}" ]; then
  [ -t 0 ] || die "no terminal: set ENGAPP_KEYSTORE_PASSWORD instead"
  read -r -s -p "New keystore password (at least 12 characters): " p1
  echo
  read -r -s -p "Repeat the password: " p2
  echo
  [ "$p1" = "$p2" ] || die "the passwords differ"
  ENGAPP_KEYSTORE_PASSWORD="$p1"
  unset p1 p2
fi
[ "${#ENGAPP_KEYSTORE_PASSWORD}" -ge 12 ] || die "the password must have at least 12 characters"
export ENGAPP_KEYSTORE_PASSWORD

umask 077
# PKCS12: the key password is the keystore password (one secret: ANDROID_KEYSTORE_PASSWORD).
keytool -genkeypair -noprompt \
  -keystore "$ks" -storetype PKCS12 \
  -alias "$alias_name" -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=Engapp, O=hsniscan, C=TR" \
  -storepass:env ENGAPP_KEYSTORE_PASSWORD -keypass:env ENGAPP_KEYSTORE_PASSWORD >/dev/null

# One line, no wrapping (GNU base64 wraps at 76 columns; macOS base64 does not).
if base64 --help 2>&1 | grep -q -- '-w'; then
  base64 -w 0 "$ks" >"$b64"
else
  base64 <"$ks" | tr -d '\n' >"$b64"
fi

echo
echo "Upload key created:"
echo "  keystore:        $ks"
echo "  base64 (secret): $b64"
echo "  alias:           $alias_name"
echo
echo "Certificate fingerprints (public, for Google Cloud → Android OAuth client):"
keytool -list -v -keystore "$ks" -alias "$alias_name" -storepass:env ENGAPP_KEYSTORE_PASSWORD \
  | grep -E '^[[:space:]]*(SHA1|SHA256):' | sed 's/^[[:space:]]*/  /'
echo
echo "Next (docs/setup-android.md): GitHub secrets ANDROID_KEYSTORE_BASE64 = contents of the"
echo ".base64 file, ANDROID_KEYSTORE_PASSWORD = the password, ANDROID_KEY_ALIAS = $alias_name."
echo "Back up the .jks file and the password in two safe places. Then delete the .base64 file."
