# 0076 — v0.5.3: the database starts the nightly jobs, a backup alarm, and error reports

## Context

Review `plan/oneriler-2026-11/teknik-notlar/saglamlik.md`, items 4, 5 and 13 (D3, D4):

- **D3.** GitHub's scheduler started the 02:45 UTC backup at 09:50–10:06, the 02:30 level job at
  08:11–09:50, and gave the picture "collect" cron 2–3 of its 6 daily runs. In a public
  repository GitHub also switches every schedule off after 60 days without commits. The only
  alarm for a stopped backup was a failed run of the backup workflow itself, so a backup that
  never started would have stayed unnoticed.
- **D4.** Errors users hit stayed in the device's own error log (Ayarlar → Gelişmiş). Edge
  functions logged failures to Supabase's one-day log, and nobody counted how often Gemini ran
  out of quota and Claude answered instead (that spends the owner's $10 a month).

Constraints: free tiers only, nothing the non-technical owner has to run or watch, and the
start-up bundle is at 95 % of its 500 KB budget.

## Decision

### 1. pg_cron starts the jobs (D3)

`pg_cron` and `pg_net` already run in the project (push reminders). Migration
`20261106000600_ops_dispatch.sql` adds `ops_dispatch(workflow, inputs)`, which POSTs GitHub's
`workflow_dispatch` API, and six cron entries (UTC):

| pg_cron job | Workflow | When |
| --- | --- | --- |
| `engapp-gh-images-nightly` | `images.yml` job=nightly | 01:30 |
| `engapp-gh-graded` | `graded.yml` job=nightly | 02:15 |
| `engapp-gh-levels` | `level-jobs.yml` | 02:30 |
| `engapp-gh-backup` | `db-backup.yml` | 02:45 (before the purges at 03:17–03:35 again) |
| `engapp-gh-images-collect` | `images.yml` job=collect | 02:45, 04:45 … 12:45 |
| `engapp-gh-ops-health` | `ops-health.yml` (new) | 06:30 (09:30 in Türkiye) |

`word-bank.yml` and `tts-pregen.yml` stay on GitHub's schedule: they are off unless a variable
turns them on, and a few hours late does not matter for them.

- **Token.** A fine-grained personal access token with only *Actions: Read and write* on this
  repository. The owner pastes it once as the repository secret `GH_DISPATCH_TOKEN`; every
  deploy copies it into **Supabase Vault** (`ops_dispatch_set_token`, through `psql`'s
  `\getenv`, never on a command line). Nothing in the database can read it except the owner
  role (pg_cron); `service_role` and clients cannot. Without the secret every tick records
  `no_token` and the jobs keep GitHub's late schedule, so nothing breaks before the step is done.
- **Backstop and run-once.** Every dispatched workflow keeps its `schedule`. Automatic runs
  (schedule, or dispatch with `trigger=cron`) are named `… [auto:<slot>]`; a small first job,
  `scripts/ci-gate.ts`, asks the Actions API (the run's own `GITHUB_TOKEN`, `actions: read`) for
  runs of the same workflow and slot in the window (20 h; 100 min for picture collects) and
  skips when one finished well or is still running. A failed run does not count, so the late
  schedule retries a failed dispatched run. Manual runs always run. On any API problem the gate
  lets the run go: a second backup is cheap, a missing one is not.
- **60-day rule.** `ops-health.yml` calls `PUT /actions/workflows/<file>/enable` for every
  scheduled workflow each day (its `GITHUB_TOKEN` gets `actions: write`). pg_net has no PUT, so
  this cannot live in the database. GitHub also e-mails the owner before it disables a schedule.
- **Answers.** pg_net is asynchronous: the request id goes to `ops_dispatch_log` (14 days) and
  the next tick copies GitHub's answer from `net._http_response`.

Why not a Cloudflare Worker cron (also free): it needs a Worker deployed with wrangler, a
Cloudflare API token and the GitHub token as a Worker secret — three more manual steps. The
pg_cron path needs one secret and lives next to the data. Why not healthchecks.io for the
alarm: another account and another e-mail to trust; the existing path (a failed run e-mails the
owner) already reaches him.

### 2. The backup's dead man's switch (D3)

The health check moved out of the backup workflow into `ops-health.yml`, so it runs even when
the backup run never started. It fails (and so GitHub e-mails the owner) when:

- `scripts/backup-age.sh`: the newest `backups/daily/` object in R2 is older than 26 hours or
  missing (one R2 list call a day);
- `ops_health_reliability()` (`20261106000620`): `backup_age`, the backup heartbeat in
  `job_runs`, is older than 26 hours; or `gh_dispatch`: GitHub refused the token (401/403/404)
  since the last accepted dispatch (an expired token);
- any `ops_health()` check fails, or the database cannot be reached at all.

If the database is down, pg_cron cannot start the check, but GitHub's own 06:30 schedule
does, and its failure to connect is the alarm. The remaining blind spot is GitHub Actions
itself being off for this repository *and* the token expired; GitHub's own e-mails (token
expiry, schedule disabling) cover that.

### 3. Error reports (D4)

- **Table** `client_errors` (`20261106000610`): insert-only for `authenticated`; RLS policy
  "insert own"; column grants exclude `user_id`, which a trigger takes from `auth.uid()`. The
  trigger cuts every field, clamps the time, and silently drops rows over **20 per user per
  day** or **5,000 a day in all**. pg_cron deletes rows after 30 days; deleting the account
  cascades. ~300 B a row: at the caps at most ~1.5 MB a day, normally almost nothing.
- **Guests send nothing.** An anonymous endpoint could not be rate-limited per person and
  would invite junk rows into the 500 MB database; guests also never agreed to send anything
  to the server (the privacy policy says guest data stays on the device).
- **Client.** After a sync that went well, `src/sync/errorReport.ts` (its own lazy chunk:
  ~1 KB, zero bytes in the start-up bundle besides one `import()`) sends at most 10 new local
  error-log entries, once an hour, one per fingerprint. `src/domain/errorReport.ts` scrubs
  them first: URLs become `file.js:line:col`, e-mail addresses, quoted text, uuids and long
  numbers are replaced, row ids in contexts are dropped. A refused insert (or the migration not
  yet deployed) keeps the entries for the next hour. No Dexie change: the cursor lives in
  `meta`.
- **Edge functions.** `_shared/ops-events.ts` counts into the existing `ops_events` table:
  `fn_error` (any 5xx except quota), `ai_quota` (provider quota or monthly budget refused) and
  `ai_fallback` (the first provider ran out of quota, read from the existing
  `provider fallback` log line, so the Claude switch does not have to know about it).
  Fire-and-forget; details hold the function name and error code only. `createHandler` got an
  `onError` hook; the AI functions, `ai-story`, `tts` and `fetch-article` use it.
- **Nightly summary.** `ops_health_reliability()` adds `client_errors_24h` (count, users, top
  three as code label and fingerprint), `fn_errors_24h` (top function/code), `ai_fallbacks_24h`
  and `ai_quota_24h`. The run log of a public repository is readable by anyone, so messages are
  never printed there; the owner (or a helper) reads them in the SQL editor:
  `select * from client_errors where fingerprint = '…' order by id desc;`.
- Not Sentry: free, but US transfer to disclose, and +20–30 KB gzip in the start-up bundle.

The privacy policy (TR/EN) now describes the reports, their 30-day retention and their deletion
with the account.

## Consequences

- Nightly jobs start within seconds of their time; the GitHub schedules only catch misses.
- One-time owner step (Turkish checklist below). Until it is done, everything works as before.
- The token expires (fine-grained tokens last at most a year): GitHub e-mails before, and the
  health check fails with "GitHub refused the token" after. Renewing it = steps 1–3 again.
- `ops_health()` is unchanged; another migration may replace it without touching these rows.
- Images' dispatch choice gained `nightly`, and the dispatched workflows gained a `trigger`
  input ("Leave empty").

## Sahibin bir kerelik adımları (Saat ayarı)

1. GitHub → sağ üstte profil resmi → **Settings → Developer settings → Personal access tokens
   → Fine-grained tokens → Generate new token**. Ad: `engapp-saat`. Süre: en uzunu (1 yıl).
   **Only select repositories** → `engapp`. **Permissions → Repository → Actions: Read and
   write**. Başka bir şey seçme. **Generate** → çıkan kodu kopyala.
2. GitHub → `engapp` deposu → **Settings → Secrets and variables → Actions → New repository
   secret**. Ad: `GH_DISPATCH_TOKEN`, değer: kopyaladığın kod → **Add secret**.
3. **Actions → Supabase → Run workflow** (yeşil düğme). Bitince işler artık tam saatinde başlar.
4. (Zaten açıksa atla) Profil resmi → **Settings → Notifications → Actions** → "Send
   notifications for failed workflows only" açık olsun: yedek 26 saati geçerse e-posta gelir.

Bir yıl sonra GitHub "token süresi doluyor" e-postası gönderir: 1–3'ü tekrarla.
