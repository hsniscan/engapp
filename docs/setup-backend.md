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
| `SUPABASE_SERVICE_ROLE_KEY` | optional, for the level job (step 9): **Project Settings → API Keys** → the `service_role` key or a secret key (`sb_secret_…`). Without it the job reads the key with `SUPABASE_ACCESS_TOKEN`, which then needs API key read access |
| `ANTHROPIC_API_KEY`         | optional, for pictures (step 12): `https://console.anthropic.com/settings/keys` → **Create Key** → copy (starts with `sk-ant-`)                                                                                                     |

**Variables** tab → **New repository variable** (all optional; defaults in brackets):

| Name                        | Value                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS`           | `<APP_URL>,http://localhost:5173` [default: only `http://localhost:5173`, so **set this** for production] |
| `GEMINI_MODEL`              | [`gemini-3.8-flash`]                                                                                      |
| `GEMINI_FALLBACK_MODEL`     | [`gemini-3.5-flash-lite`]                                                                                 |
| `AI_DAILY_LIMIT`            | AI calls per user per UTC day [`200`]                                                                     |
| `AI_SYSTEM_DAILY_LIMIT`     | model calls per UTC day for system jobs (the level job), separate from users' budgets [`100`]             |
| `CLAUDE_MONTHLY_CREDIT_USD` | the monthly Claude credit in USD; pictures may use 80 % of it [`100`]                                     |
| `APP_ADMIN_USER_ID`         | your Supabase user id (step 12): who may open the picture review screen [none]                            |
| `IMAGE_DAILY_LIMIT`         | pictures a user may ask for per UTC day [`10`]                                                            |
| `CLAUDE_IMAGE_MODEL`        | model that draws pictures [`claude-opus-5-5`]                                                             |
| `CLAUDE_CHECK_MODEL`        | model that scores and checks pictures [`claude-haiku-5-5`]                                                |
| `CLAUDE_WORDBANK_MODEL`     | model of the word bank job (step 14) [`CLAUDE_CHECK_MODEL`]                                               |
| `WORD_BANK_NIGHTLY`         | `true`: the word bank job also runs every night (step 14) [off]                                           |

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
   - `supabase db push --linked --yes` (applies `supabase/migrations/*.sql` once each)
   - `supabase secrets set` for `GEMINI_API_KEY`, `GEMINI_MODEL`,
     `GEMINI_FALLBACK_MODEL`, `AI_PROVIDER=gemini`, `AI_DAILY_LIMIT`, `ALLOWED_ORIGINS`
   - on the first run only: a Web Push (VAPID) key pair, stored as the function secrets
     `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (see step 10; nothing to do)
   - `supabase functions deploy` (`ai-extract`, `ai-enrich`, `ai-examples`, `ai-themes`, `ai-mnemonic`, `ai-report`, `ai-contrast`, `push-send`, `tts`, `account-delete`; JWT is verified inside the
     functions, so `verify_jwt = false` from `supabase/config.toml` is expected)
   - `select public.push_configure(<push-send URL>)`, which turns on the 15-minute reminder job
3. Both jobs must end green. If "Check secrets" fails, a secret from step 4 is missing.

Not done by the workflow on purpose: `supabase config push` (it would overwrite the
dashboard auth settings from step 3 with the local-development `config.toml`).

## 6. Check in the dashboard

1. **Table Editor**: tables `profiles`, `notes`, `senses`, `cards`, `review_logs`,
   `sources`, `settings`, `lexicon_terms`, `lexicon_senses`, `ai_usage`,
   `ai_chunk_cache`, `sync_horizon`; none shows "RLS disabled".
2. **Edge Functions**: `ai-extract`, `ai-enrich`, `ai-examples` and `ai-themes` are listed. **Secrets**
   (Edge Functions → Secrets) lists the variables from step 5.2.
3. **Integrations → Cron** (or **Database → Cron Jobs**): job
   `engapp-purge-tombstones`, schedule `17 3 * * *`. If it is missing (pg_cron was not
   enabled), enable **Database → Extensions → pg_cron** and run in **SQL Editor**:
   `select cron.schedule('engapp-purge-tombstones', '17 3 * * *', 'select public.purge_tombstones(30)');`
4. **SQL Editor**: `select * from public.tables_without_rls();` must return no rows.

## 7. Web app environment (Cloudflare Pages and local)

Cloudflare dashboard → **Workers & Pages → <PAGES_PROJECT> → Settings → Variables and
Secrets**, for **Production** and **Preview**, then redeploy:

| Name                            | Value                                      |
| ------------------------------- | ------------------------------------------ |
| `VITE_SUPABASE_URL`             | `https://bikcjlomrjaxymifxogi.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key from step 3.5          |
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

To give guests and offline devices the corrections too (they use the level file shipped
with the app): `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/system-jobs.ts
export-tr`, then `node scripts/build-levels.ts`, and commit `data/levels/`.

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

Pictures are drawn by Claude (docs/ai-image.md, decisions 0029 and 0030). Nothing breaks
without them: until the key is set, the picture workflow ends with a notice and the "draw now"
button answers that pictures are not available.

1. **Key.** Create an API key in the Anthropic Console
   (`https://console.anthropic.com/settings/keys`) and add it as the repository secret
   `ANTHROPIC_API_KEY` (step 4). The deploy workflow copies it into the function secrets (never
   printed); the picture workflow reads it directly.
2. **Credit.** Set the repository variable `CLAUDE_MONTHLY_CREDIT_USD` to the monthly amount you
   want to spend on Claude (default 100). Pictures stop for the month at 80 % of it; every call
   is reserved before it is sent, so the cap holds even with many users at once. Also set a
   **spending limit** in the Console (**Settings → Limits**) as a second guard.
3. **Reviewer.** Find your user id in **Authentication → Users** (the row with your Google
   address, column UID) and set it as the repository variable `APP_ADMIN_USER_ID`. The next
   deploy adds it to `public.app_admins`. Without GitHub, run once in **SQL Editor**:
   `insert into public.app_admins (user_id) values ('<your user id>') on conflict do nothing;`
4. **Deploy** (step 5) so the migration, the `ai-image` function and the secrets are in place.
5. **Pilot.** **Actions → Picture jobs → Run workflow**, job `pilot`: draws 50 random concrete
   words now and stores them for review. The log lists each picture with its cost and the total;
   the report is kept as the run's `pilot-report` artifact. Judge them in the app's review
   screen before letting the nightly job run on its own.
6. **Nightly.** `.github/workflows/images.yml` runs every night at 01:30 UTC: it collects the
   previous night's batch (checks, stores pictures for review) and scores new words. It sends
   the next batch (half price) only when the repository variable **`IMAGE_BULK`** is `true`:
   set it (**Settings → Secrets and variables → Actions → Variables**) after you approved the
   pilot (plan: at least 80 % good). Without it the run ends with a notice and nothing new is
   drawn; to stop bulk drawing again, delete the variable or set it to `false`. Other jobs by
   hand: `visualize`, `submit` (sends a batch even without `IMAGE_BULK`), `collect`.
7. **Bulk order (İP9).** The nightly batch takes queued senses in this order: senses in your
   cards, then in other users' cards, then words within your level ±1 (your level in
   **Ayarlar → Seviye**) most frequent first, then the rest of the 5,000 most frequent words.
   Only meanings scored 2 or 3 for "can be drawn" are queued; a user request and a redraw from
   the review screen always come first. About 200 pictures a night (`count` / `--max`), so the
   2,000–2,500 planned senses take 1–2 months inside the monthly cap (decision 0037).

Optional variables: `IMAGE_DAILY_LIMIT` (pictures per user per day, default 10),
`CLAUDE_IMAGE_MODEL`, `CLAUDE_CHECK_MODEL` (defaults in `_shared/image-models.ts`). The picture
workflow also needs the service-role key, exactly like the level job (step 9).

Check: **Edge Functions** lists `ai-image`; in **SQL Editor**,
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
- Daily limit: `AI_DAILY_LIMIT`.
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
