#!/usr/bin/env bash
# Dead man's switch of the nightly backup (decision 0076): looks at the newest daily copy in
# R2 itself, not only at the heartbeat the backup script writes, and fails (so GitHub e-mails
# the owner) when it is older than MAX_AGE_HOURS (26) or missing.
#   R2_ACCOUNT_ID and R2_BACKUP_BUCKET / R2_BACKUP_ACCESS_KEY_ID / R2_BACKUP_SECRET_ACCESS_KEY,
#   or the audio bucket's R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (the same
#   fallback as scripts/db-backup.sh). Lists one prefix: one R2 class A operation a day.
set -euo pipefail
max_hours="${MAX_AGE_HOURS:-26}"
bucket="${R2_BACKUP_BUCKET:-${R2_BUCKET:-}}"
access="${R2_BACKUP_ACCESS_KEY_ID:-${R2_ACCESS_KEY_ID:-}}"
secret="${R2_BACKUP_SECRET_ACCESS_KEY:-${R2_SECRET_ACCESS_KEY:-}}"
if [ -z "${R2_ACCOUNT_ID:-}" ] || [ -z "$bucket" ] || [ -z "$access" ] || [ -z "$secret" ]; then
  echo "::error title=Backup::No R2 bucket/key: cannot see the backups (docs/runbook-backup-restore.md)"
  exit 1
fi
export AWS_ACCESS_KEY_ID="$access" AWS_SECRET_ACCESS_KEY="$secret" AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
newest=$(aws --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" s3api list-objects-v2 \
  --bucket "$bucket" --prefix backups/daily/ --query 'Contents[].Key' --output text \
  | tr '\t' '\n' | grep -E '\.tar\.gz\.gpg$' | sort | tail -n 1 || true)
if [ -z "$newest" ]; then
  echo "::error title=Backup::No nightly backup found in R2 (backups/daily/)"
  exit 1
fi
# backups/daily/2026-11-06T024512Z.tar.gz.gpg
stamp=$(basename "$newest" .tar.gz.gpg)
iso="${stamp:0:10} ${stamp:11:2}:${stamp:13:2}:${stamp:15:2} UTC"
age_h=$(( ($(date -u +%s) - $(date -u -d "$iso" +%s)) / 3600 ))
line="Newest nightly backup in R2: $stamp ($age_h hours old)"
echo "$line"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$line" >> "$GITHUB_STEP_SUMMARY"; fi
if [ "$age_h" -gt "$max_hours" ]; then
  echo "::error title=Backup::The newest nightly backup is $age_h hours old (more than $max_hours): look at the 'Database backup' runs"
  exit 1
fi
