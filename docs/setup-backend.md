# Backend setup (Supabase + Gemini + Google sign-in)

Exact, ordered steps to put the Engapp backend live. Everything in `code style` is a
value to type or copy exactly. Placeholders look like `<THIS>`.

Fixed values for this project:

| What                                 | Value                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Supabase project ref                 | `bikcjlomrjaxymifxogi`                                                                         |
| Supabase project URL                 | `https://bikcjlomrjaxymifxogi.supabase.co`                                                     |
| Google OAuth callback (redirect URI) | `https://bikcjlomrjaxymifxogi.supabase.co/auth/v1/callback`                                    |
| Local dev app URL                    | `http://localhost:5173`                                                                        |
| Production app URL                   | `<APP_URL>`: the Cloudflare Pages address, e.g. `https://engapp.pages.dev` (no trailing slash) |

Deployment runs from GitHub Actions (`.github/workflows/deploy-supabase.yml`). Nothing
secret is stored in the repository.

## 1. Gemini API key (Google AI Studio)

1. Open `https://aistudio.google.com/apikey` and sign in with the Google account that
   should own the key.
2. Click **Create API key**. Choose an existing Google Cloud project or let AI Studio
   create one. Copy the key. It is the value of the GitHub secret `GEMINI_API_KEY`
   (step 4).
3. Optional: in AI Studio, open **Usage / Rate limits** for that project to see the
   free-tier limits of `gemini-3.8-flash` and `gemini-3.5-flash-lite`.

Privacy: on the free tier Google may use submitted text to improve its models and
human reviewers may read it (except EU, Switzerland, UK). The import screen tells users
not to upload confidential documents. Moving to the paid tier only needs a different key.

## 2. Google sign-in (OAuth client)

1. Open `https://console.cloud.google.com/` and select the same Google Cloud project
   (top bar project picker).
2. Go to **APIs & Services → OAuth consent screen** (in newer consoles: **Google Auth
   Platform → Branding**). If asked, click **Get started** and fill in:
   - App name: `Engapp`
   - User support email: your email
   - Audience: **External**
   - Contact information: your email
   - Accept the policy, **Create**.
3. **Data access** (or "Scopes"): **Add or remove scopes**, tick `openid`,
   `.../auth/userinfo.email`, `.../auth/userinfo.profile`, **Update**, **Save**.
4. **Audience**: while the app is in _Testing_, only listed test users can sign in: add
   your Google address under **Test users**. To let anyone sign in, click **Publish app**.
5. **Clients → Create client** (older consoles: **Credentials → Create credentials →
   OAuth client ID**):
   - Application type: **Web application**
   - Name: `Engapp Supabase`
   - Authorized JavaScript origins: `<APP_URL>` and `http://localhost:5173`
   - Authorized redirect URIs: `https://bikcjlomrjaxymifxogi.supabase.co/auth/v1/callback`
   - **Create**. Copy **Client ID** and **Client secret**.

## 3. Supabase dashboard (`https://supabase.com/dashboard/project/bikcjlomrjaxymifxogi`)

1. **Authentication → Sign In / Providers → Google**: turn **Enable Sign in with Google**
   on, paste the **Client ID** (field "Client IDs") and **Client Secret** from step 2.5,
   leave "Skip nonce checks" off, **Save**. The callback URL shown there must be
   `https://bikcjlomrjaxymifxogi.supabase.co/auth/v1/callback`.
2. Same page: open **Email** and turn **Enable Email provider** off (Google is the only
   sign-in method). Make sure **Allow anonymous sign-ins** (under **Sign In / Providers**,
   "User Signups") is **off**. Keep **Allow new users to sign up** **on**.
3. **Authentication → URL Configuration**:
   - Site URL: `<APP_URL>`
   - Redirect URLs, **Add URL** for each:
     `<APP_URL>/**`, `http://localhost:5173/**`, `http://127.0.0.1:5173/**`, and for
     Cloudflare preview builds `https://*.<PAGES_PROJECT>.pages.dev/**`
     (e.g. `https://*.engapp.pages.dev/**`).
4. **Project Settings → Data API**: "Exposed schemas" must include `public` (default).
   The sync functions are called through it.
5. **Project Settings → API Keys**: copy the **Publishable key** (`sb_publishable_...`).
   It goes into the web app (step 7); it is public by design (security is RLS).
   Never put a **Secret key** (`sb_secret_...`) anywhere in the web app or the repo.
6. **Project Settings → Database**: if you do not know the database password, click
   **Reset database password**, set a new strong one and keep it for step 4.

## 4. GitHub repository secrets and variables

In the GitHub repository: **Settings → Secrets and variables → Actions**.

**Secrets** tab → **New repository secret** (name exactly as written):

| Name                        | Value                                                                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`     | `https://supabase.com/dashboard/account/tokens` → **Generate new token** → name `github-actions` → copy (starts with `sbp_`)                                                                                                        |
| `SUPABASE_DB_PASSWORD`      | the database password from step 3.6                                                                                                                                                                                                 |
| `GEMINI_API_KEY`            | the key from step 1                                                                                                                                                                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY` | recommended, for every scheduled job (steps 9, 12, 14–16, 19): **Project Settings → API Keys** → the `service_role` key or a secret key (`sb_secret_…`). Without it the job reads the key with `SUPABASE_ACCESS_TOKEN`, which then needs API key read access |
| `BACKUP_PASSPHRASE`         | **required since v0.5.2** (step 20): a long random passphrase (e.g. `openssl rand -base64 32`). Every database backup is encrypted with it. **Keep a copy outside GitHub** (password manager or paper): without it no backup can be read. The deploy refuses to migrate without it |
| `R2_BACKUP_BUCKET`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY` | recommended (step 20): a **private** R2 bucket and an API token limited to it, only for backups. Without them the backups go to the audio bucket under `backups/` (still encrypted) |
| `ANTHROPIC_API_KEY`         | optional, for pictures (step 12) and the text AI fallback (step 16): `https://console.anthropic.com/settings/keys` → **Create Key** → copy (starts with `sk-ant-`)                                                                  |

**Variables** tab → **New repository variable** (all optional; defaults in brackets):

| Name                        | Value                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS`           | `<APP_URL>,http://localhost:5173` [default: only `http://localhost:5173`, so **set this** for production] |
| `GEMINI_MODEL`              | [`supabase/functions/_shared/model-defaults.ts`; every model variable below falls back to that file]      |
| `GEMINI_FALLBACK_MODEL`     | [`model-defaults.ts`]                                                                                     |
| `AI_DAILY_LIMIT`            | AI calls per user per UTC day, all text AI features together [`120`]                                      |
| `AI_DAILY_LIMIT_EXTRACT`, `_ENRICH`, `_THEMES`, `_MNEMONIC`, `_CONTRAST`, `_REPORT` | calls per user per UTC day of one feature [`60`, `60`, `10`, `20`, `20`, `4`] |
| `AI_USER_MONTHLY_USD`       | most one user may spend of the shared Claude text budget per month [`2`]                                  |
| `AI_USER_MAX_SHARE`         | most one user may spend as a share of that budget (the smaller of the two applies) [`0.2`]                 |
| `AI_OWNER_MAX_SHARE`        | share of that budget the owner (`APP_ADMIN_USER_ID`) may spend [`0.75`]                                    |
| `AI_SYSTEM_MONTHLY_USD`     | most the system jobs (level job, morphemes) may spend of it per month [`2`]                               |
| `AI_SYSTEM_MAX_SHARE`       | most the system jobs may spend as a share of it (the smaller of the two applies) [`0.15`]                 |
| `AI_TEXT_PRIMARY`           | `gemini`: Gemini first and Claude only when Gemini's quota runs out (the v0.5 order) [`claude`]           |
| `SKIP_PRE_MIGRATION_BACKUP` | `true`: deploy without the backup before migrating (only if the backup itself is broken) [off]            |
| `AI_SYSTEM_DAILY_LIMIT`     | model calls per UTC day for system jobs (the level job), separate from users' budgets [`100`]             |
| `CLAUDE_MONTHLY_CREDIT_USD` | the monthly Claude credit in USD; pictures may use 80 % of it [`100`]                                     |
| `APP_ADMIN_USER_ID`         | your Supabase user id (step 12): who may open the picture review screen [none]                            |
| `CLAUDE_IMAGE_MODEL`        | model that draws pictures [`claude-sonnet-5-5`]                                                           |
| `CLAUDE_CHECK_MODEL`        | model that scores and checks pictures [`claude-haiku-5-5`]                                                |
| `CLAUDE_WORDBANK_MODEL`     | model of the word bank job (step 14) [`CLAUDE_CHECK_MODEL`]                                               |
| `WORD_BANK_NIGHTLY`         | `true`: the word bank job also runs every night (step 14) [off]                                           |
| `TTS_PREGEN_WEEKLY`         | `false`: the pronunciation audio job stops its Sunday run for new words (step 15) [on]                   |
| `GRADED_BULK`               | `false`: the reading library job stops writing new texts (step 16) [on]                                   |
| `GRADED_MONTHLY_USD`        | the reading library's own monthly Claude cap in US$ (step 16) [20]                                        |
| `AUDIO_MAX_BYTES`           | most bytes the pre-generated audio may take in its bucket (step 15) [6 GB on R2, 0.9 GB on Supabase]     |
| `CLAUDE_TEXT_MONTHLY_USD`   | monthly cap in USD for Claude text AI: every text feature, stories, level job (the library has its own cap) [`30`, owner 2026-11-05] |
| `CLAUDE_GRADED_MODEL`       | model that writes library texts [`claude-sonnet-5-5`]                                                     |
| `GRADED_PER_CELL`           | library texts per level and core topic [`9`]                                                              |
| `GRADED_EXTENDED_PER_CELL`  | library texts per level and extended topic [`0`]                                                          |
| `ARTICLE_DAILY_LIMIT`       | articles a user may import from links per UTC day (step 17) [`20`]                                        |
| `CLAUDE_TEXT_MODEL`         | model of every text AI task; Gemini only steps in when it cannot answer (step 17) [`claude-sonnet-5-5`]   |
| `AI_CLAUDE_FALLBACK`        | `off`: never use Claude for the text AI tasks, Gemini only (step 17) [`on`]                               |
| `STORY_DAILY_LIMIT`         | daily stories per user per UTC day, each may be regenerated once (step 18) [`1`]                          |
| `CLAUDE_STORY_MODEL`        | model that writes the daily story (step 18) [`CLAUDE_TEXT_MODEL`, else `claude-sonnet-5-5`]               |

`ALLOWED_ORIGINS` is the list of web origins allowed to call the AI functions
(comma-separated, exact, no trailing slash). Preview deploys on other origins cannot
call AI unless added here. The deploy workflow always appends the production Pages URL,
`http://localhost:5173` and `https://localhost` (the Android app's origin, see
`docs/setup-android.md`), so the variable only needs extra origins.

## 5. Deploy

1. GitHub → **Actions → Supabase → Run workflow** → branch `main` → **Run workflow**.
   (It also runs by itself on every push to `main` that changes `supabase/**`.)
2. The `test` job runs the Deno type check and the SQL security tests on a temporary
   local database; `deploy` then:
   - `supabase link --project-ref bikcjlomrjaxymifxogi`
   - finds the database (`scripts/supabase-db-url.sh`), takes an encrypted backup to R2
     (`scripts/db-backup.sh pre-migration`, step 20), then `supabase db push` (applies
     `supabase/migrations/*.sql` once each). Without `BACKUP_PASSPHRASE` it stops here.
   - `supabase secrets set` for `GEMINI_API_KEY`, `GEMINI_MODEL`,
     `GEMINI_FALLBACK_MODEL`, `AI_PROVIDER=gemini`, `AI_DAILY_LIMIT`, `ALLOWED_ORIGINS`
   - on the first run only: a Web Push (VAPID) key pair, stored as the function secrets
     `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (see step 10; nothing to do)
   - `supabase functions deploy` (`ai-extract`, `ai-enrich`, `ai-themes`, `ai-mnemonic`, `ai-report`, `ai-contrast`, `push-send`, `tts`, `account-delete`, `fetch-article`; JWT is verified inside the
     functions, so `verify_jwt = false` from `supabase/config.toml` is expected)
   - `supabase functions delete ai-image` / `ai-examples`: the on-demand picture and sentence
     functions removed in v0.5.2 (decision 0061); skipped when already gone
   - `select public.push_configure(<push-send URL>)`, which turns on the 15-minute reminder job
3. Both jobs must end green. If "Check secrets" fails, a secret from step 4 is missing.

Not done by the workflow on purpose: `supabase config push` (it would overwrite the
dashboard auth settings from step 3 with the local-development `config.toml`).

## 6. Check in the dashboard

1. **Table Editor**: tables `profiles`, `notes`, `senses`, `cards`, `review_logs`,
   `sources`, `settings`, `lexicon_terms`, `lexicon_senses`, `ai_usage`,
   `ai_chunk_cache`, `sync_horizon`; none shows "RLS disabled".
2. **Edge Functions**: `ai-extract`, `ai-enrich` and `ai-themes` are listed (not `ai-image` or
   `ai-examples`: removed in v0.5.2). **Secrets**
   (Edge Functions → Secrets) lists the variables from step 5.2.
3. **Integrations → Cron** (or **Database → Cron Jobs**): job
   `engapp-purge-tombstones`, schedule `17 3 * * *`. If it is missing (pg_cron was not
   enabled), enable **Database → Extensions → pg_cron** and run in **SQL Editor**:
   `select cron.schedule('engapp-purge-tombstones', '17 3 * * *', 'select public.purge_tombstones(30)');`
4. **SQL Editor**: `select * from public.tables_without_rls();` must return no rows.

## 7. Web app environment (Cloudflare Pages and local)

Cloudflare dashboard → **Workers & Pages → <PAGES_PROJECT> → Settings → Variables and
Secrets**, for **Production** and **Preview**, then redeploy:

| Name                            | Value                                                                      |
| ------------------------------- | -------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://bikcjlomrjaxymifxogi.supabase.co`                                 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key from step 3.5                                          |
| `VITE_CONTACT_EMAIL`            | the contact address shown in the privacy policy and on `/hesap-sil` (v0.4) |

Locally: create `.env.local` in the repository root with the same two lines
(`*.local` is git-ignored). Without these variables the app runs in guest mode only.
(`VITE_SUPABASE_ANON_KEY` is accepted as a fallback name.)

## 8. Smoke test

1. Open `<APP_URL>`, sign in with Google: you return to the app signed in; a row appears
   in **Authentication → Users** and in `profiles`.
2. Add a card by hand and wait for sync (or press "Şimdi senkronla"): rows appear in `notes`,
   `senses`, `cards` with your `user_id`.
3. Paste a short English text in "Metin yapıştır": candidates appear; `ai_usage` shows
   1 call for today; `lexicon_terms` / `lexicon_senses` get rows; `ai_chunk_cache` 1 row.
4. Paste the same text again: no new `ai_usage` call.
5. **Edge Functions → ai-extract → Logs**: one `ai-extract model call` line per real model
   call, with the model used (`gemini-3.8-flash` or the fallback).

## 9. Word-level job (v0.2)

`.github/workflows/level-jobs.yml` ("Level job") runs every night at 02:30 UTC and can be
started by hand (**Actions → Level job → Run workflow**; `dry_run` reports counts without
writing or calling the model, `max_calls` caps the run, `no_ai` runs only the first step).

1. **Resolve (no AI, every run).** Stores the level of every lexicon sense and the word
   frequency (`lexicon_terms.zipf`) of every term from the reference data.
2. **AI steps.** Level guesses for senses outside the word lists and the Turkish-learner check
   of the lists, about 100 model calls per night from the system budget
   (`AI_SYSTEM_DAILY_LIMIT`), never from a user's. The first nights work through the word lists;
   after that a night needs only a few calls. They stop after 40 minutes, so the last resolve
   fits in the job's 60 minutes; the next night continues. Details: docs/ai-pipeline.md
   ("Level job").

Step 1 needs only the project's service-role key: set the `SUPABASE_SERVICE_ROLE_KEY` secret
(step 4), or let the job read it through the Management API with `SUPABASE_ACCESS_TOKEN` (a
personal token has this access; a scoped token needs "API keys: read"). The key is masked in
the log and never stored. Step 2 also needs `GEMINI_API_KEY`; without it the run still ends
green, with a warning that the AI steps were skipped. If an AI step fails, the job still
resolves what was stored, then ends red.

The schedule only runs from `main`, and GitHub may start a scheduled run late or (rarely) drop
it. The level job reached `main` on 22 October after that day's 02:30 slot, so its first
scheduled run was the night of 23 October; until then all `lexicon_terms.zipf` were empty.
Nothing depends on that: the picture jobs read frequencies from the reference data directly
(decision 0037). See "Job health" (step 13) for how a job that stopped running shows up.

Check after the first run: the job ends green and its summary prints the counts; in **SQL
Editor**, `select count(*) filter (where zipf is not null), count(*) from public.lexicon_terms;`
shows most terms with a frequency, and
`select count(*) from public.ref_word_levels where tr_checked_at is not null;` grows each night.

To give guests, offline devices and the level test the corrections too (they use the level
file shipped with the app): **Actions → Level jobs → Run workflow** with **export_tr** ticked
(v0.5.3, decision 0073). It exports the corrections, rebuilds `data/levels/` and the level test
bank, runs the level-data tests and opens a pull request; merge it. By hand, the same is
`SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/system-jobs.ts export-tr`, then
`node scripts/build-levels.ts` and `node scripts/relevel-level-test.ts`. Words Turkish has
borrowed (mikrofon, penisilin) are one level easier from `data/levels/tr-familiar.tsv`; to
change that list edit `data/levels/tr-familiar-review.tsv` and run
`node scripts/build-tr-familiar.ts`.

## 10. Push reminders (v0.3)

Nothing to set up. The first deploy creates the Web Push key pair and keeps it in the function
secrets (never in the repository, never replaced: new keys would end every device's
subscription). The pg_cron job `engapp-push-send` (`*/15 * * * *`) calls `push-send`, which
sends at most one reminder per user-day (docs/decisions/0024-web-push.md).

Optional repository variable `VAPID_SUBJECT`: a `mailto:` address or `https:` URL the push
services can contact (default: the app URL).

Check after the deploy: **Edge Functions → Secrets** lists `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`; **Integrations → Cron** lists `engapp-push-send`;
`select function_url is not null from public.push_cron_config;` is true. In the app, Settings →
Bildirim → turn on, then "Deneme bildirimi gönder". `push_log` gets one row per user and day
a reminder was sent. If the cron job is missing (pg_cron or pg_net not enabled), enable both
under **Database → Extensions** and run
`select cron.schedule('engapp-push-send', '*/15 * * * *', 'select public.push_cron_tick()');`.

## 11. Account deletion and Google Play (v0.4)

Nothing to set up on the server: the `account-delete` function and `delete_user_data()` come with
the normal deploy (step 5). It needs no secret beyond the service role key every function has.

1. Set `VITE_CONTACT_EMAIL` (step 7) and redeploy the web app. Until it is set, `/gizlilik`,
   `/privacy` and `/hesap-sil` show "(iletişim adresi henüz eklenmedi)" instead of an address.
2. Check, signed out, that `<APP_URL>/gizlilik`, `<APP_URL>/privacy` and `<APP_URL>/hesap-sil`
   open directly (Cloudflare Pages serves `index.html` for every path).
3. Smoke test with a throwaway Google account: sign in, add a card, sync, then **Ayarlar → Hesap →
   Hesabımı ve verilerimi sil**. The account disappears from **Authentication → Users**,
   `select count(*) from public.notes where user_id = '<id>'` is 0, and **Edge Functions →
   account-delete → Logs** shows one `account deleted` line with row counts (no content).
4. Play Console (docs/play-store/):
   - **Privacy policy URL:** `<APP_URL>/gizlilik`;
   - **Data safety → Delete account URL:** `<APP_URL>/hesap-sil`; the rest of the form from
     `data-safety.md`;
   - **Content rating, Target audience (18+), Ads, App access:** `content-rating.md`;
   - **Store listing:** `listing-tr.md`, `listing-en.md`, images from `screenshots/` and `graphics/`;
   - **Closed test:** `testers-message-tr.md`.

## 12. Pictures (v0.4)

Pictures are drawn by Claude, only in bulk by the nightly job, and shipped to every user
(docs/ai-image.md, decisions 0029, 0030 and 0061: there is no "draw now" in the app any more).
Nothing breaks without them: until the key is set, the picture workflow ends with a notice.

1. **Key.** Create an API key in the Anthropic Console
   (`https://console.anthropic.com/settings/keys`) and add it as the repository secret
   `ANTHROPIC_API_KEY` (step 4). The picture workflow reads it directly; the deploy workflow
   copies it into the function secrets for the Claude text fallback and the daily story (never
   printed).
2. **Credit.** Set the repository variable `CLAUDE_MONTHLY_CREDIT_USD` to the monthly amount you
   want to spend on Claude (default 100). Pictures stop for the month at 80 % of it; every call
   is reserved before it is sent, so the cap holds even with many users at once. Also set a
   **spending limit** in the Console (**Settings → Limits**) as a second guard.
3. **Reviewer.** Find your user id in **Authentication → Users** (the row with your Google
   address, column UID) and set it as the repository variable `APP_ADMIN_USER_ID`. The next
   deploy adds it to `public.app_admins`. Without GitHub, run once in **SQL Editor**:
   `insert into public.app_admins (user_id) values ('<your user id>') on conflict do nothing;`
4. **Deploy** (step 5) so the migration and the secrets are in place.
5. **Pilot.** **Actions → Picture jobs → Run workflow**, job `pilot`: draws 50 random concrete
   words now and stores them for review. The log lists each picture with its cost and the total;
   the report is kept as the run's `pilot-report` artifact. Judge them in the app's review
   screen before letting the nightly job run on its own.
6. **Nightly.** `.github/workflows/images.yml` runs every night at 01:30 UTC: it collects the
   previous night's batch (checks, stores pictures for review) and scores new words. Extra runs every two hours until 12:45 UTC only collect, so a batch's pictures arrive soon after it finishes. It sends
   the next batch (half price, up to 2,000 pictures) every night: bulk drawing is on by default
   since the switch to watercolour pictures (`image-v2`, 2026-10-25), which also redraws every
   flat `image-v1` picture. To pause it, set the repository variable **`IMAGE_BULK`** to `false`
   (**Settings → Secrets and variables → Actions → Variables**). Other jobs by hand:
   `visualize`, `submit`, `collect`.
7. **Bulk order (İP9).** The nightly batch takes queued senses in this order: senses in your
   cards, then in other users' cards, then words within your level ±1 (your level in
   **Ayarlar → Seviye**) most frequent first, then the rest of the 5,000 most frequent words.
   Only meanings scored 1 to 3 for "can be drawn" are queued (`VISUAL_AUTO_MIN`; the model may
   still decline); a redraw from the review screen always comes first. Up to
   2,000 pictures a night (`count` / `--max`), always inside the monthly cap (decision 0037).
   `node scripts/img-report.ts` (job `report`) prints the counts that size the redraw: senses
   by visualizability, requests by state, pictures by prompt version and status.

Optional variables: `CLAUDE_IMAGE_MODEL`, `CLAUDE_CHECK_MODEL` (defaults in `_shared/image-models.ts`). The picture
workflow also needs the service-role key, exactly like the level job (step 9).

Check: in **SQL Editor**,
`select * from public.image_budget_status();` shows this month's cap and spending, and
`select status, count(*) from public.lexicon_images group by 1;` grows after each night.

## 13. Job health (v0.4)

Both nightly jobs (Level job, Picture jobs) write a heartbeat at the end of every run into
`public.job_runs` (service role only, no user data). Each run reads the others' rows: a job
without a good run for 36 hours shows a **warning** in the next run's log and summary
(`Job 'images' has not finished well for 49 hours`). By hand, in **SQL Editor**:
`select job, status, last_run_at, last_ok_at, runs, details from public.job_runs;`.

When a job is late: **Actions → the workflow** — is it disabled (GitHub disables schedules in
a repository without activity for 60 days: **Enable workflow**), did the last run fail (open
its log), is a secret missing? A run started by hand writes the heartbeat too.

Also nightly, by pg_cron: `engapp-purge-usage` (03:27 UTC) deletes read-aloud and picture
usage counters older than 90 days, as the privacy policy says. **Integrations → Cron** lists
it next to `engapp-purge-tombstones`; without pg_cron run
`select public.purge_usage_counters(90);` now and then.

## 14. Kelime Bankası (v0.4)

The word bank (decision 0038) is filled once by a job: Turkish meanings and an example sentence
for every word of the level lists (~10,000 rows), written to the shared `public.word_bank`
table that every device, guests too, downloads. Until it has run, the app's Kelime Bankası
screen says it is still empty (nothing else is affected).

Needs: the migration `20261026001100_word_bank.sql` deployed (step 5), `ANTHROPIC_API_KEY`
(step 12.1), and the service-role key exactly like the level job (step 9). It spends from the
same monthly Claude credit as the pictures (`CLAUDE_MONTHLY_CREDIT_USD`, 80 % cap); the whole
list is expected to cost about **$2** (upper bound reserved per batch ≈ $8).

1. **Plan.** **Actions → Word bank job → Run workflow**, job `plan`. Sends nothing; the log
   shows how many words are left, how many the shared dictionary already covers and the
   estimated cost. A `submit` with **dry_run** ticked also shows the reserved amount.
2. **Run.** Same workflow, job `run`: collects finished batches (none the first time), stores
   the words the dictionary covers, sends the rest as one Message Batch (half price) and
   prints the plan again.
3. **Collect.** A batch usually ends within an hour (at most 24 h). Run job `run` again: it
   checks the answers, stores the rows and sends again the few that were rejected. Repeat
   until `plan` shows 0 words left (normally two or three runs). Words rejected three times are
   left out (counted as `failed` in the log and in `word_bank_jobs`).
4. Optional: set the repository variable `WORD_BANK_NIGHTLY` to `true` to run step 3 every
   night at 03:45 UTC (useful when the lists change); leave it unset otherwise.

Optional variable: `CLAUDE_WORDBANK_MODEL` (else `CLAUDE_CHECK_MODEL`, else the default Haiku).

Check in **SQL Editor**: `select cefr, count(*) from public.word_bank group by 1 order by 1;`
and `select state, count(*) from public.word_bank_jobs group by 1;`. In the app, open
Ekle → "Kelime Bankası'nı aç": the list downloads once and then works offline.

### 14.1 Review pass (clean-up, decision 0040)

The first bank was written by Claude Haiku and about one meaning in twenty is wrong. The review
sends every bank row once more to a stronger model (Claude Sonnet 5.5 by default), 25 rows per
request, and applies its corrections: wrong meanings or examples are fixed, redundant meanings
dropped. Expected cost for the whole bank about **$1–2** (upper bound reserved ≈ $13.5, from
the same monthly Claude credit).

Needs: the migration `20261026001300_word_bank_review.sql` deployed (step 5), the same
secrets as above.

1. **Plan.** **Actions → Word bank job → Run workflow**, job `review-plan`. Sends nothing; the
   log shows the rows left to review, the number of requests, `estimatedUsd` and
   `upperBoundUsd`. (Or job `review` with **dry_run** ticked: the same.)
2. **Send.** Job `review` (dry_run off; `max` empty = all rows): collects nothing the first
   time, reserves the upper bound and sends one Message Batch.
3. **Apply.** After the batch ends (usually within an hour, at most 24 h) run job `review`
   again. The log shows `rowsChanged`, `sensesKept` / `sensesFixed` / `sensesDropped`,
   `rowsRetired`, `fixesRejected`, `retried`, `failed`, `stale`, the cost and up to 40 example
   changes (`lemma (pos) fix: old → new [reason]`): read them. The few rows with a rejected
   correction are sent again in the same run; run `review` once more for them. Done when
   `review-plan` shows `pending: 0`.

Changed rows reach devices on their next bank download (when the screen opens, at most every 15 minutes);
rows with nothing left are retired and disappear. Cards users already made keep their
own text. Optional variable: `CLAUDE_WORDBANK_REVIEW_MODEL`.

Check in **SQL Editor**: `select state, count(*) from public.word_bank_review group by 1;`
and, for the changes, `select lemma_norm, pos, outcome from public.word_bank_review where
previous_senses is not null limit 50;` (`previous_senses` holds the row before the change).

## 15. Pronunciation audio (pre-generated)

Every dictionary word and public example sentence is read aloud from an MP3 file made in
advance (decision 0042), in both accents, by Kokoro-82M running on the GitHub runners (no paid
API, no Gemini quota). The app fetches the file straight from the public `tts` bucket, so a
tap plays at once; only text that has no file yet goes to the `tts` function (Gemini, as
before). Until the job has run, everything works as before, just slower.

Needs: the migration `20261027000100_tts_mp3.sql` deployed (step 5; the job also lets the
bucket take MP3 files itself) and the service-role key exactly like the word bank job.

1. **Plan.** **Actions → Pronunciation audio → Run workflow** with **plan_only** ticked. Makes
   nothing; the log shows the number of words and sentences, what the bucket holds now
   (`mp3MB`, `wavMB`), what is missing, and the estimated size and CPU time.
2. **Run.** Same workflow, plan_only off, shards `8`: eight parallel jobs, about 1.5 hours for
   ~40,000 clips, ~550 MB (free on a public repository). Each clip is uploaded as soon as it is
   made, so a cancelled or failed job is simply run again: it skips everything already there.
3. **Optional clean-up.** Run once more with **prune_ondemand** ticked: deletes the older
   Gemini WAV files that an MP3 now replaces (they are no longer played).
4. Every Sunday at 04:30 UTC the job picks up new words and sentences (one job, at most 4,000
   clips). Set the repository variable `TTS_PREGEN_WEEKLY` to `false` to stop it. Since v0.5.3
   the word bank's example sentences are voiced too, and no run lets the audio pass
   `AUDIO_MAX_BYTES` (6 GB on R2: the free 10 GB is per account and the backups share it).

Check: `plan_only` again shows `missing: 0`. In the app, a speaker tap on a dictionary word
plays without the spinner; in the browser's network tab the request goes to
`/storage/v1/object/public/tts/<accent>/<hash>.mp3`, not to `/functions/v1/tts`.

## 16. Okuma kitaplığı (v0.5)

Short texts for each level, A1 to C1, with a Turkish translation and audio for every
sentence (decisions 0047, 0073). Claude writes and checks them in nightly batches. Until there are
texts, the library page says new texts are being prepared; nothing else changes.

Needs: the `ANTHROPIC_API_KEY` secret (step 12) and the service-role key, exactly as for
pictures.

1. **Deploy** (step 5), so that the migrations `20261101000500_text_budget.sql` and
   `20261101000510_graded_texts.sql` are in place.
2. **Cap.** This is optional. Since v0.5.3 the library draws on the shared monthly Claude
   budget (like pictures) and has its own monthly cap on top: 20 USD by default, the run's
   `cap_usd` input or the repository variable `GRADED_MONTHLY_USD`. A batch that would pass
   either cap is not sent. The app's own text cap (`CLAUDE_TEXT_MONTHLY_USD`) is left alone.
3. **Plan.** Go to **Actions → Graded library → Run workflow**, job `plan`. It sends nothing.
   The log lists the missing texts per level and topic (360 for the first plan) and the
   worst-case cost.
4. **Fill it once.** Run the workflow with job `bulk` (and `cap_usd` if not 20). It writes,
   checks and stores the whole plan in about 2–5.5 hours, then makes the audio. It is on by
   default: the workflow also runs every night at 02:15 UTC. It does these steps in order:
   - collects last night's batch;
   - checks coverage and quality, then stores the approved texts;
   - sends the next batch inside the cap;
   - makes the sentence audio;
   - prints a report.

   Set `GRADED_BULK` to `false` to pause. Other jobs by hand: `submit` (or **dry_run**),
   `collect`, `audio`, `report`.

5. Optional: `GRADED_PER_CELL` (texts per level and core topic on every level; default the
   library plan 8/8/8/7/5 on A1–C1),
   `GRADED_EXTENDED_PER_CELL` (default 0; e.g. `3` adds the extended topics such as food, film
   and law), `CLAUDE_GRADED_MODEL`, `CLAUDE_CHECK_MODEL`.

Check: in **SQL Editor**, `select * from public.image_budget_status();` shows this month's
shared cap and spending; the job log's `library_month` line shows the library's own. `select status, count(*) from public.graded_texts group by 1;` grows after each
night. In the app, **/kitaplik** lists the approved texts.

## 17. Article import and the Claude fallback (v0.5)

Nothing new to create: the deploy (step 5) applies `20261101000200_article_usage.sql` and
deploys `fetch-article`. Optional variables (step 4): `ARTICLE_DAILY_LIMIT`,
`CLAUDE_TEXT_MODEL`, `AI_CLAUDE_FALLBACK`.

- **Article import** needs no key: the server downloads the page itself (user agent
  `EngappReader/1.0`), returns plain text and stores nothing (decision 0044).
- **Claude first (v0.5.3, decision 0077)**: ai-extract, ai-enrich, ai-themes, ai-mnemonic,
  ai-report, ai-contrast and ai-story ask Claude Sonnet first, under the monthly text budget
  (`CLAUDE_TEXT_MONTHLY_USD`) and the user's share of it; Gemini answers whenever Claude
  cannot (the month or the share is used up, an outage, no key). It uses the
  `ANTHROPIC_API_KEY` secret that pictures already use; without it everything runs on Gemini
  as before. Each Claude call is booked in `text_budget` and logged as `text spend`.
- Check after deploy: **Edge Functions → fetch-article → Logs** shows `extracted` lines with
  sizes only, never an address.

## 18. Bugünün hikâyesi (v0.5)

Nothing new to create: the deploy (step 5) applies `20261101000800_story.sql` and deploys
`ai-story`. It needs the `ANTHROPIC_API_KEY` secret that pictures already use (without it the
app says the story cannot be written right now). Optional variables (step 4):
`STORY_DAILY_LIMIT`, `CLAUDE_STORY_MODEL`, `CLAUDE_TEXT_MONTHLY_USD`.

- One story costs about 0.01–0.02 US$ on Claude Sonnet (0.001 on Haiku before v0.5.3); every
  call is booked in the same monthly text budget as the reading library. When the month's
  budget is used up Gemini writes the story (without a Gemini key the app shows a calm message
  and nothing is sent).
- Only the day's 5–8 words, the level, the reading difficulty and up to three interests are
  sent; the story is not stored on the server (decision 0050).
- Check after deploy: **Edge Functions → ai-story → Logs** shows `ai-story model call` lines
  with counts only; `select * from public.text_budget_status();` shows the spending.

## 19. Pronunciation audio on Cloudflare R2 (v0.5)

The audio files (step 15) take about a third of the free 1 GB in Supabase, and the library
and new words keep adding more. Cloudflare R2 gives 10 GB free and charges nothing for
downloads, so the files move there (decision 0053). Nothing changes for you in the app, and
nothing is deleted from Supabase: the app plays from R2 first and uses Supabase whenever R2
does not answer, so there is always a way back. Until step 19.7 is done, everything stays on
Supabase exactly as before.

You only click in two dashboards (Cloudflare and GitHub); the copying is done by a workflow.

1. **Create the bucket.** Cloudflare dashboard → **R2 Object Storage**. The first time,
   Cloudflare asks you to turn R2 on (it may ask for a card; the free plan costs nothing up
   to 10 GB). Then **Create bucket** → name `engapp-audio` → location **Automatic** →
   **Create bucket**.
2. **Make it public.** In the bucket: **Settings → Public access → R2.dev subdomain → Allow**
   (type `allow` to confirm). Copy the address it shows, which looks like
   `https://pub-<letters and numbers>.r2.dev`. This is `<AUDIO_URL>` below. (A custom domain
   from the same page works too; then use that address.)
3. **Let the app read the files.** Same **Settings** page → **CORS policy → Add CORS policy**,
   replace the text with the lines below and **Save**. If you use your own app domain, add it
   to the list the same way.

   ```json
   [
     {
       "AllowedOrigins": [
         "https://engapp-65y.pages.dev",
         "https://localhost",
         "http://localhost:5173"
       ],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

4. **Create a key for GitHub.** **R2 Object Storage** main page → **Manage API tokens** (or
   **API → Manage API tokens**) → **Create API token** (an account token). Permission
   **Object Read & Write**, **Apply to specific buckets only** → `engapp-audio` → **Create**.
   Keep the page open: it shows the **Access Key ID** and the **Secret Access Key** only once.
   The **Account ID** is on the R2 main page (right side) and in the dashboard address.
5. **Add the GitHub secrets.** GitHub → **Settings → Secrets and variables → Actions →
   Secrets → New repository secret**, four times:

   | Name                   | Value                 |
   | ---------------------- | --------------------- |
   | `R2_ACCOUNT_ID`        | the Account ID        |
   | `R2_ACCESS_KEY_ID`     | the Access Key ID     |
   | `R2_SECRET_ACCESS_KEY` | the Secret Access Key |
   | `R2_BUCKET`            | `engapp-audio`        |

   Nothing changes in the app yet.

6. **Copy the files.** **Actions → Audio copy to R2 → Run workflow**:
   - first with **dry_run** ticked. It copies nothing; the summary shows how many files
     Supabase has and how many are left to copy;
   - then with **dry_run** off and **public_url** set to `<AUDIO_URL>`. It copies the files
     (about 40,000 small files; usually under an hour) and then checks 20 of them through
     `<AUDIO_URL>`, as the app would. It is safe to run again at any time: it only copies
     what is missing, so if it stops or times out, just run it again.

   Done when the summary says **left to copy: 0** and the public check is green. A red
   "CORS" message means step 3 is missing or has a typo.

7. **Switch the app to R2.** Do these three on the same day, in this order:
   1. GitHub → **Secrets and variables → Actions → Variables → New repository variable**
      `AUDIO_BASE_URL` = `<AUDIO_URL>`. From now on the audio jobs write new files to R2.
   2. **Actions → Supabase → Run workflow**. The `tts` function then finds and stores audio on
      R2 too.
   3. Cloudflare → **Workers & Pages → <PAGES_PROJECT> → Settings → Variables and Secrets** →
      add `VITE_AUDIO_BASE_URL` = `<AUDIO_URL>` for **Production** and **Preview**, then
      **redeploy** (step 7). The next Android build takes the GitHub variable by itself.

   Then run step 6 once more (dry_run off) to pick up files made in the meantime.

8. **Check.** On the phone, follow "R2 ses" in `docs/real-device-checklist.md`. On the web,
   in the browser's network tab a speaker tap loads `<AUDIO_URL>/en-US/<…>.mp3`.
9. **Later, by hand: free the Supabase space.** Wait at least two weeks with R2 in use and no
   audio complaints, then run step 6 with **dry_run** ticked: it must say **left to copy: 0**.
   Only then, Supabase dashboard → **Storage → tts** → open `en-US`, select all, **Delete**;
   the same for `en-GB`. Do not delete the `tts` bucket itself. The app keeps working: it plays
   from R2, and the `tts` function still makes the rare missing file. No workflow does this
   step for you, on purpose.

**Going back** (any time before step 9): delete the Cloudflare Pages variable
`VITE_AUDIO_BASE_URL` and redeploy, and delete the GitHub variable `AUDIO_BASE_URL`. The app
then uses Supabase only, as before. Files made while R2 was on are made again on Supabase by
the next audio job run (step 15), which sees them missing there.

## 20. Backups, limits and the nightly health check (v0.5.2)

Decision 0060; restore steps: `docs/runbook-backup-restore.md`.

1. Add the secret `BACKUP_PASSPHRASE` (step 4) and keep a copy outside GitHub.
2. Recommended: Cloudflare → **R2 → Create bucket** `engapp-backups` (no public access) →
   **Manage R2 API Tokens → Create API token** → *Object Read & Write*, only that bucket →
   secrets `R2_BACKUP_BUCKET`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`.
   `R2_ACCOUNT_ID` is the one from step 19.
3. GitHub → **Actions → DB backup → Run workflow** once and check that it ends green.
   It then runs every night (02:45 UTC): daily copies kept 14, weekly (Sunday) copies 8,
   pre-migration copies 10, none older than 56 days.
4. **Health check** (`ops-health.yml`, 06:30 UTC; decision 0076) runs `public.ops_health()`
   (budgets, refusals, stale holds, job heartbeats, failed pg_cron runs, database size, lexicon
   terms to review) and `public.ops_health_reliability()` (backup age, the job clock, users'
   errors, edge-function failures, AI fallbacks and quota refusals), and checks that the
   newest backup in R2 is under 26 hours old. A `fail` row fails the run. Turn on e-mail for
   failed runs: GitHub → your avatar → **Settings → Notifications → Actions → "Send
   notifications for failed workflows only"**.
5. Sync quotas (per user): `select * from public.sync_limits;` — change one with
   `update public.sync_limits set value = … where name = '…';` (no deploy needed).

## 21. Job clock and error reports (v0.5.3)

Decision 0076 (with a short Turkish checklist at its end).

1. GitHub → avatar → **Settings → Developer settings → Personal access tokens → Fine-grained
   tokens → Generate new token**: only the `engapp` repository, permission **Actions: Read and
   write**, nothing else, the longest expiry.
2. Repository secret `GH_DISPATCH_TOKEN` = that token (step 4).
3. **Actions → Supabase → Run workflow**: the deploy copies the token into Supabase Vault.
   From then on pg_cron starts the backup, the health check, the level, library and picture
   jobs on time; GitHub's own schedules only catch misses, and a run that finds tonight's work
   already done skips itself ("Skipped: …" notice).
4. Check: next morning the **Health check** run shows `gh_dispatch ok`. In the SQL editor:
   `select at, workflow, outcome, status_code from ops_dispatch_log order by id desc limit 10;`
5. Users' error reports: `select * from client_errors order by id desc limit 50;` (the health
   check prints only counts and fingerprints, its log is public).

## Manual deploy without GitHub (alternative)

From the repository root, with the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
installed and Docker not required:

```sh
supabase login                                   # opens the browser, once
supabase link --project-ref bikcjlomrjaxymifxogi # asks for the database password
supabase db push
supabase secrets set GEMINI_API_KEY=<key> GEMINI_MODEL=gemini-3.8-flash \
  GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite AI_PROVIDER=gemini AI_DAILY_LIMIT=200 \
  ALLOWED_ORIGINS=<APP_URL>,http://localhost:5173
supabase functions deploy --use-api
```

## Changing things later

- Model: change the GitHub variable `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` and re-run
  the workflow (or `supabase secrets set GEMINI_MODEL=...`). No code change. Secrets
  take effect on the next function invocation.
- Daily limits: `AI_DAILY_LIMIT`, `AI_DAILY_LIMIT_<FEATURE>`; monthly share: `AI_USER_MONTHLY_USD`,
  `AI_USER_MAX_SHARE`. Sync quotas live in the table `public.sync_limits` (step 20).
- New app domain: add it to Google (step 2.5 origins), Supabase redirect URLs (3.3) and
  `ALLOWED_ORIGINS` (4).
- Schema: add a new file under `supabase/migrations/` (never edit an applied one) and push.

## Local development and tests

- SQL tests: `supabase start` then `supabase test db` (pgTAP files in
  `supabase/tests/database/`). Needs Docker. For the Google provider in
  `config.toml`, set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
  `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in `supabase/.env` (any value works if you do not
  test Google sign-in locally; a real local login needs `http://127.0.0.1:54321/auth/v1/callback`
  as an extra redirect URI in Google).
- Functions locally: copy `supabase/functions/.env.example` to `supabase/functions/.env`,
  fill in `GEMINI_API_KEY`, run `supabase functions serve`.
- Integration test (`supabase/tests/integration/stack.test.ts`): runs only when
  `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_KEY`,
  `SUPABASE_TEST_JWT_SECRET` are set (legacy HS256 keys of a local stack) and the
  functions are served with `GEMINI_API_BASE` pointing at a fake Gemini that returns
  the fixtures (`/fake-gemini/models/...` and `/fake-gemini/calls`). Then `pnpm test`.
