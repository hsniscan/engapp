# 0037 — Maintenance: nightly job hardening, job health, bulk picture priority, perf tests

v0.4 İP10 (maintenance) together with the code side of İP9 (bulk picture generation). Plan:
`plan/v0.4-plan.md`, İP9, İP10, Annex A.3 ("Priority for İP9") and A.8.

## 1. The level job: why it never ran, and hardening

**Context.** `level-jobs.yml` (cron 02:30 UTC) had no run in its history and all 1,141
`lexicon_terms` had a null `zipf`. Findings:

- **Timing, not a bug.** Scheduled workflows run only from the default branch. The workflow
  reached `main` with PR #6 at 04:44 UTC on 22 October, after that day's 02:30 slot (the
  repository was created on 21 October at 15:51 UTC). The first scheduled run is the night of
  23 October. `zipf` is written only by this job, so it stayed null.
- **Fragile points** that would have hurt later:
  1. `exit 1` when `GEMINI_API_KEY` was missing, before the deterministic step, although
     resolving levels and `zipf` from the reference data needs no AI.
  2. An exception in the AI steps (network error, an RPC failure) ended the run before the
     final resolve.
  3. Up to 100 model calls of up to 90 s each could pass the job's 60-minute timeout, so the
     final resolve could be cut off. The manual run on 22 October shows it: the resolve took
     3 s (1,159 senses, `zipf` for 830 terms), the AI steps 55 minutes (54 calls, 4,500 list
     entries checked, stopped by a 90 s Gemini timeout), and the job ended green only 4
     minutes before the timeout.
  4. GitHub may start a scheduled run late or drop it under load, and disables schedules in a
     repository without activity for 60 days. Nothing made a missing run visible.

**Decision.**

- Orchestration moved to `scripts/lib/level-run.ts` (tested with fakes). Step 1 (resolve, no AI)
  always runs. Without `GEMINI_API_KEY` (or with the new `no_ai` input / `--no-ai`) the AI
  steps are skipped with a warning and the run ends green. An error in the AI steps is caught,
  the final resolve still runs, then the run ends red with the error.
- The AI steps stop after `--max-minutes` (40 in the workflow), inside the 60-minute timeout.
- **Job health.** New `public.job_runs` (one row per job: status, last run, last good run,
  counters only; service role only) with `job_heartbeat()` / `job_health()`
  (`20261026001000_job_health.sql`). The level job and every `img-batch` step write a heartbeat
  (`scripts/lib/heartbeat.ts`); each run warns (`::warning::` and the run summary) about a
  nightly job without a good run for 36 hours. A missing function (migration not deployed)
  only logs a line; heartbeats never fail a run. Owner doc: setup-backend.md step 13.
- **Graceful without zipf.** The picture SQL reads `coalesce(lexicon_terms.zipf,
  ref_word_freq.zipf)`, so its order is right before the level job has run; the pilot already
  drops its frequency floor while no term has a `zipf` (wave 1). Clients use their own level
  file and never depended on the server's `zipf`.

## 2. İP9 bulk priority

**Decision** (`20261026001010_image_priority.sql`; the deployed `…000200_images.sql` is not
edited; `image_queue_auto` and `image_visual_pending` keep their signatures, so the job code
did not change):

| Priority | Tier |
|---|---|
| 4000 | owner redraw (unchanged) |
| 3000 + 100 / user | user request (unchanged) |
| 2000 + users | in an app admin's cards |
| 1000 + users | in anyone's cards |
| 500 + zipf × 10 | owner's CEFR level ±1 (`settings.level` of the app admins; sense level `lexicon_senses.cefr`) |
| 100 + zipf × 10 | the rest of the 5,000 most frequent lemmas (`ref_word_freq`, 5,000th zipf as the floor) |
| not queued | everything else (a user can still ask) |

Only `visualizability ≥ 2` is auto-queued (unchanged). Each night queued **auto** rows below
3000 are re-ranked, so a sense that enters someone's cards moves up; redraws and user requests
are never touched. `visual-v1` scores senses in the same order. With no frequency data at all,
every sense counts as top 5,000 (the queue still fills). The formula lives in one immutable SQL
function (`image_auto_priority`) with a TypeScript twin (`_shared/image-priority.ts`) whose
property test checks that the tiers never overlap and stay below user requests; the pgTAP test
pins the same numbers.

**Why tiers by number ranges** instead of a composite sort key: the queue already orders by a
single `priority` column with an index, the user/redraw numbers stay valid, and the re-rank is a
plain update.

**Deviation.** "Top 5,000 lemmas" is taken from the wordfreq reference table, not from the
lexicon: senses only exist for words someone added, so tier 3 covers the lexicon's senses whose
lemma is in the top 5,000. Pre-creating lexicon senses for the rest of the top 5,000 (an AI
enrichment job) is out of scope; the bulk run therefore draws ~what the lexicon holds, and grows
as users add words. Bulk submission stays behind the repository variable `IMAGE_BULK=true`
(wave 1); documented in setup-backend.md step 12.

## 3. Review screen close control

`/admin/images` showed the immersive top bar's ✕ and its own back arrow. Like the review,
practice and level-test screens it now has only the ✕; a route handle (`exitTo`,
`exitLabelKey`) sends it back to Ayarlar → Gelişmiş with the label "Görsel onayından çık".

## 4. Perf e2e under load

**Context.** `perf`, `images-perf` and `restore-perf` failed on a loaded machine and passed on
CI. Two causes: measurement overhead (the cold-start time read `performance.now()` in a second
`page.evaluate`, adding a round trip; the restore time was the test's wall clock including its
clicks and `expect` polling) and real CPU contention.

**Decision.** Times are measured in the page: the cold start uses the page's clock at the painted
first card; the restore uses the app's own `performance.measure` entries
(`engapp:restore-read`, `engapp:restore-apply` in `DataSection.tsx`). Bounds are the real budget
on CI, always. Locally they scale by a factor printed with each result: `E2E_PERF_SLACK=n`, or by
default the machine's load (1-minute load per CPU × 2, clamped to 1–4); `E2E_PERF_SLACK=1`
forces the real budget. Test timeouts and the reading pause before a card switch scale too. No
test is skipped. Checked at load 13–17 on 4 CPUs: all four pass.

## 5. Privacy text and usage counters

The Anthropic paragraph now lists exactly what the pipeline sends (shared dictionary word,
POS, Turkish meaning, drawing hint, a fixed redraw note, and the drawn picture for the vision
check; no user id, cards or sentences — no request carries `metadata`). The data and deletion
sections name the picture data (`image_usage`, `image_request_users`, picture answers and
choices; for an admin `app_admins` and `image_feedback`), and so does the in-app deletion
dialog. The policy promised that usage counters go after 90 days, but `tts_usage` and
`image_usage` were never purged: `purge_usage_counters(90)`, scheduled by pg_cron as
`engapp-purge-usage` (`20261026001020_usage_purge.sql`).

## 6. Real-device checklist

`docs/real-device-checklist.md` (Turkish): install, Google sign-in, offline review,
read-aloud, notification, share, pictures offline, dark mode, account deletion with a
throwaway account; one column for notes. Linked from setup-android.md.
