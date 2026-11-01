#!/usr/bin/env bash
# 16 KB page-size check for the Android release APK (docs/decisions/0064).
#
# Google Play rejects apps targeting Android 15+ whose 64-bit native libraries are not ready for
# 16 KB memory pages. Two things must hold for every lib/arm64-v8a and lib/x86_64 .so:
#   1. ELF: every LOAD segment is aligned to at least 16 KB (2**14), as check_elf_alignment.sh
#      from the Android docs checks.
#   2. ZIP: the uncompressed .so entries start on a 16 KB boundary (zipalign -c -P 16).
# 32-bit libraries (armeabi-v7a, x86) are exempt. Engapp's only native code is ML Kit text
# recognition (bundled model); if this fails after a dependency change, update ML Kit.
#
# Usage: scripts/check-16kb.sh path/to/app-release.apk [path/to/zipalign]
set -euo pipefail

apk="${1:?usage: check-16kb.sh app.apk [zipalign]}"
zipalign="${2:-}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

unzip -q -o "$apk" 'lib/*' -d "$work" 2>/dev/null || true
shopt -s nullglob
libs=("$work"/lib/arm64-v8a/*.so "$work"/lib/x86_64/*.so)
if [ ${#libs[@]} -eq 0 ]; then
  echo "No 64-bit native libraries in $apk: nothing to check."
  exit 0
fi

bad=0
for so in "${libs[@]}"; do
  rel="${so#"$work"/}"
  # Smallest LOAD alignment of the file (readelf prints it as 0x… in the last column).
  min=""
  while read -r align; do
    v=$((align))
    if [ -z "$min" ] || [ "$v" -lt "$min" ]; then min=$v; fi
  done < <(readelf -lW "$so" | awk '$1 == "LOAD" { print $NF }')
  if [ -z "$min" ]; then
    echo "?? $rel: no LOAD segments found"
    bad=1
  elif [ "$min" -lt 16384 ]; then
    printf 'UNALIGNED %s: LOAD alignment %d bytes (needs 16384)\n' "$rel" "$min"
    bad=1
  else
    printf 'ok %s: LOAD alignment %d bytes\n' "$rel" "$min"
  fi
done

if [ -n "$zipalign" ]; then
  if "$zipalign" -c -P 16 -v 4 "$apk" > "$work/zipalign.txt" 2>&1; then
    echo "ok zip alignment (zipalign -c -P 16)"
  else
    grep -E 'lib/(arm64-v8a|x86_64)/.*\(BAD' "$work/zipalign.txt" || tail -n 20 "$work/zipalign.txt"
    echo "UNALIGNED zip entries (zipalign -c -P 16 failed)"
    bad=1
  fi
fi

if [ "$bad" -ne 0 ]; then
  echo "::error::Native libraries are not 16 KB page-size compatible; Google Play will reject this build (docs/decisions/0064)."
  exit 1
fi
echo "All 64-bit native libraries are 16 KB page-size compatible."
