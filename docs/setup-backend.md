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

| Name                    | Value                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | `https://supabase.com/dashboard/account/tokens` → **Generate new token** → name `github-actions` → copy (starts with `sbp_`) |
| `SUPABASE_DB_PASSWORD`  | the database password from step 3.6                                                                                          |
| `GEMINI_API_KEY`        | the key from step 1                                                                                                          |

**Variables** tab → **New repository variable** (all optional; defaults in brackets):

| Name                    | Value                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS`       | `<APP_URL>,http://localhost:5173` [default: only `http://localhost:5173`, so **set this** for production] |
| `GEMINI_MODEL`          | [`gemini-3.8-flash`]                                                                                      |
| `GEMINI_FALLBACK_MODEL` | [`gemini-3.5-flash-lite`]                                                                                 |
| `AI_DAILY_LIMIT`        | AI calls per user per UTC day [`200`]                                                                     |

`ALLOWED_ORIGINS` is the list of web origins allowed to call the AI functions
(comma-separated, exact, no trailing slash). Preview deploys on other origins cannot
call AI unless added here.

## 5. Deploy

1. GitHub → **Actions → Supabase → Run workflow** → branch `main` → **Run workflow**.
   (It also runs by itself on every push to `main` that changes `supabase/**`.)
2. The `test` job runs the Deno type check and the SQL security tests on a temporary
   local database; `deploy` then:
   - `supabase link --project-ref bikcjlomrjaxymifxogi`
   - `supabase db push --linked --yes` (applies `supabase/migrations/*.sql` once each)
   - `supabase secrets set` for `GEMINI_API_KEY`, `GEMINI_MODEL`,
     `GEMINI_FALLBACK_MODEL`, `AI_PROVIDER=gemini`, `AI_DAILY_LIMIT`, `ALLOWED_ORIGINS`
   - `supabase functions deploy` (`ai-extract`, `ai-enrich`, `ai-examples`; JWT is verified inside the
     functions, so `verify_jwt = false` from `supabase/config.toml` is expected)
3. Both jobs must end green. If "Check secrets" fails, a secret from step 4 is missing.

Not done by the workflow on purpose: `supabase config push` (it would overwrite the
dashboard auth settings from step 3 with the local-development `config.toml`).

## 6. Check in the dashboard

1. **Table Editor**: tables `profiles`, `notes`, `senses`, `cards`, `review_logs`,
   `sources`, `settings`, `lexicon_terms`, `lexicon_senses`, `ai_usage`,
   `ai_chunk_cache`, `sync_horizon`; none shows "RLS disabled".
2. **Edge Functions**: `ai-extract`, `ai-enrich` and `ai-examples` are listed. **Secrets**
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
