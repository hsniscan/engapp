# 0060 — v0.5.2 server hardening: backups, AI cost per user, byte-bounded sync, quotas, narrower secrets

## Context

The 2026-11-01 review (`teknik-notlar/sunucu.md`, S1–S22) found the backend fine for a few
testers but not for a public launch:

- **S1** no database backup at all (Free plan has none), while every merge to `main`
  auto-applies migrations to production;
- **S2/S6** one user could spend the whole shared monthly Claude text budget, and budget holds
  of crashed calls were never released;
- **S3/S12** pull pages were sized by rows only (`user_texts` bodies can be 200 KB each, so a
  page could be 100 MB and time out for ever), every progress save re-sent the whole body, and
  each visible tab polled every 60 s;
- **S5** no per-user quota on synced rows or write rate; **S16** an HLC from a fast clock
  wins every LWW race;
- **S7** every signed-in user could `select` the whole shared lexicon (including terms other
  users typed); **S13** one user could fill the picture queue;
- **S8** the account-wide Supabase token and the R2 write keys reached every step of the job
  workflows, including `pnpm install`; actions were pinned by tag;
- **S9** nothing told the owner when something broke; **S14** model ids were repeated in five
  modules and two workflows;
- **S4** (and profil-ilerleme B2) the privacy policy said texts stay on the device, while
  `user_texts` syncs them with full body; with no contact address it linked the public GitHub
  issue tracker.

## Decision

1. **Backups (S1).** `scripts/db-backup.sh` dumps roles, schema and data (`supabase db dump`)
   plus a `pg_dump -Fc` of `public` + `auth`, checks the dump is not empty, writes a
   `MANIFEST` (sha256, account count), encrypts with `gpg --symmetric AES256` (secret
   `BACKUP_PASSPHRASE`) and uploads to R2 (`R2_BACKUP_*`, else the audio bucket under
   `backups/`). `db-backup.yml` runs it nightly (14 daily, 8 weekly, nothing older than
   56 days); `deploy-supabase.yml` runs it with `pre-migration` right before `supabase db
   push` (last 10) and **refuses to migrate without it** unless the variable
   `SKIP_PRE_MIGRATION_BACKUP=true`. Encrypted because the fallback bucket is public.
   Restore steps: `docs/runbook-backup-restore.md`.
2. **AI cost per user (S2, S6).** Migration `20261103000100_ai_fair_share.sql`:
   - `ai_consume_feature`: a per-feature daily counter (`ai_feature_usage`) on top of the
     shared daily counter; defaults lowered (all text AI 200 → 120 a day; extract 60, enrich 60,
     themes 10, mnemonic 20, contrast 20, report 4) and set per feature with
     `AI_DAILY_LIMIT_<FEATURE>`; articles 30 → 20.
   - `text_budget_reserve_user`: a user's monthly share of the shared Claude text budget
     (`text_budget_users`, min of `AI_USER_MONTHLY_USD` [1] and `AI_USER_MAX_SHARE` [10 %] of
     the cap). Lock order: user row, then month row (settle does the same).
   - `text_budget_maintain()` every 15 minutes (pg_cron): releases holds older than 15 minutes
     and reconciles `reserved_usd` with the open holds (repairs holds orphaned by account
     deletion). Refusals are recorded in `ops_events` (no user column).
3. **Sync (S3, S5, S12, S16).** Migration `20261103000200_sync_limits.sql`:
   - `sync_pull_v4(…, p_max_bytes)`: chooses keys with an estimated size first and builds JSON
     only for the kept rows; first row always kept; same order as v3.
   - `user_texts.body_seq` (server-only): an incremental pull leaves out bodies that did not
     change; the client fills them from the local copy or a plain select.
   - Body-less pushes: `_sync_update_partial` keeps columns missing from the payload under the
     same HLC rule; a row the server lacks answers `23502` and the client resends it in full.
     The outbox keeps full payloads, so the guarantees (newest entry per row wins, nothing
     dropped) are unchanged.
   - `sync_limits` + `sync_usage`: per user per day calls/rows/bytes, and texts count/size per
     user, `53400` when over. HLC more than one day in the future: `22023`.
   - Client polling: 60 s × 2^idle up to 10 min; local writes, `online` and visibility wake it.
4. **Lexicon and pictures (S7, S13).** Migration `20261103000300_lexicon_privacy.sql`:
   `lexicon_pull` / `lexicon_get` become `SECURITY DEFINER` and the table grants and read
   policies for `authenticated` go away (no bulk read; `lexicon_find` is edge-only). New
   single-word terms that are in none of the reference lists get `needs_review` (owner reviews
   with the runbook's SQL). `image_request_users`: at most `image_requests_per_day` (20) new
   requests per user and day.
5. **Health (S9).** Migration `20261103000400_ops_health.sql`: `ops_health()` (budgets,
   refusals, stale holds, job heartbeats incl. the backup, failed pg_cron runs, database size,
   lexicon review count); `db-backup.yml` runs it every night through `scripts/ops-health.sh`,
   and a `fail` row fails the run, so GitHub's failed-run e-mail is the alert.
6. **CI and secrets (S8, S14).** Every third-party action pinned by commit SHA. The service key
   is resolved in one step before `pnpm install` (`scripts/resolve-service-key.sh`, writes a
   private file); only that step and "Find the database" see `SUPABASE_ACCESS_TOKEN`; R2 keys
   only in the steps that upload. Default model ids live only in
   `supabase/functions/_shared/model-defaults.ts`; workflows pass a model only when a variable
   sets one and unset the function secret otherwise. `scripts/workflows.test.ts` guards all of
   this.
7. **Privacy text (S4, B2).** TR and EN policy say what syncs (cards, history, saved reading
   texts of every kind with their body, encounter counts, settings), what goes to Gemini and
   Claude, that the Gemini free tier may use inputs, the new counters, R2 and the encrypted
   backups with their retention. Blocks starting `[[email]] ` / `[[noemail]] ` are shown only
   with / without `VITE_CONTACT_EMAIL`; without it the page shows the in-app paths and
   `/hesap-sil`, never the issue tracker and never an invented address. `PRIVACY_UPDATED`
   2026-11-03.

## Why

- Backups first: everything else is recoverable, data loss is not. Fail-closed before a
  migration, because a bad migration is exactly when a copy is needed; the skip variable is
  for the day the backup tool itself breaks.
- Per-user money caps rather than only call counts, because one Claude call's cost varies
  100×; the cap is a share of the global budget so a small budget still serves many users.
- Byte pages keep the v3 contract (same rows, same order, same cursor rule), so older and newer
  clients mix; the body-less paths fall back to full rows on every mismatch.
- Database-side quotas because the client cannot be trusted (AGENTS.md rule 3).

## Consequences

- The deploy fails until the owner adds `BACKUP_PASSPHRASE` (and should add a private R2
  bucket). Losing the passphrase makes every backup unreadable.
- A user over a sync quota sees rows waiting in the outbox (stuck after 10 attempts); the UI
  message for it is left to a later wave.
- pgTAP tests: `60_ai_fair_share`, `61_sync_limits`, `62_lexicon_privacy`, `63_ops_health`;
  `22_account_delete` seeds the new user tables; `01`, `02`, `07` follow the new guards.
- Deferred: S10 (Actions minutes: watch usage; public repo or fewer nightly jobs), S11 (global
  lexicon lock: fine at current write rates), S15 (accepted in ADR 0044), S17 (row-level LWW:
  documented), S18 (production auth settings: owner to record from the dashboard), S19 (R2
  custom domain: needs a domain), S20 (gateway `verify_jwt`: needs the new JWT signing keys),
  S21 (accepted), S22 (re-auth for deletion: backups now limit the damage), `pip
  --require-hashes`, moving Gemini to the paid tier (owner's cost decision), per-row quotas on
  tables other than `user_texts`.
