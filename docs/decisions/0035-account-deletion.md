# 0035 — Account deletion, privacy policy and Play readiness

**Context.** Google Play requires a privacy policy URL, a way to delete the account and its
data both **in the app and on the web** (without reinstalling), a Data safety form that matches
the policy, a content rating, and, for a new personal developer account, a closed test with 12
testers for 14 days (v0.4 plan, İP7, criterion 11, Annex A.7). Until now Engapp had sign-out and
a JSON export but no deletion, and no privacy policy.

## Decision

### Server: `account-delete` edge function

- `POST /functions/v1/account-delete` with `{confirm: "delete-my-account-and-data"}`
  (`_shared/account-delete-contract.ts`). The user id comes only from the verified JWT
  (`createAuthenticator`, AGENTS.md rule 5); `verify_jwt = false` in `config.toml` as for every
  function, the check is inside. The fixed phrase guards against a stray or replayed call with
  just a token.
- **Order, every step idempotent** (`_shared/account-delete.ts`):
  1. Storage objects under `<user id>/` in every bucket (`account-delete-store.ts` lists the
     buckets and removes recursively, 1000 per call). Today there are none: the only bucket,
     `tts`, holds shared dictionary audio named by a hash, and private audio is never stored
     (ADR 0028). The step is there so a future per-user bucket is covered by the convention.
  2. `public.delete_user_data(user)` (migration `20261025000700`): one transaction under the
     same per-user advisory lock as `sync_push`, so a push from another device cannot write
     between the deletes. Returns the rows removed per table (logged as counts only).
  3. The auth user (`auth.admin.deleteUser`, hard delete), which also ends every session and
     refresh token. "User not found" counts as done.
  A retry after a failure at any step finishes the job. The token is checked with
  `getClaims` (signature and expiry), so a repeated call with a still-valid token after success
  finds nothing and answers `account: "already_gone"`; once the token expires the call is a 401,
  which the client reports as "not signed in". Another device whose access token is still valid
  cannot bring rows back after step 3: every insert needs the `auth.users` row its foreign key
  points to, so its `sync_push` fails until it is signed out.
- **Which tables: from the catalog, not a list.** `public.user_owned_columns()` returns every
  public table column with a foreign key to `auth.users`; `delete_user_data` deletes by each.
  Every user table already has `ON DELETE CASCADE`, so step 3 alone would also remove the rows;
  the explicit step 2 makes the deletion visible, testable and complete even if step 3 fails.
  The SQL test `22_account_delete.test.sql` guards the convention: every `user_id` column in
  `public` must have a cascading foreign key, and the shared tables must have no user column.
- **Shared lexicon (verified).** `lexicon_*`, `ref_*`, `ai_system_usage`, `sync_tables` and
  `push_cron_config` have no user column (catalog test), and the test seeds a lexicon entry
  through `lexicon_upsert` as the deleted user and checks it is still there afterwards. They hold
  dictionary content only (AGENTS.md rule 5, `docs/ai-pipeline.md` "Rules"): no user's sentence
  and no record of who caused an entry. Deleting them would break other users' cards and remove
  nothing personal, so they stay; the privacy policy says so ("Ortak sözlük").
- Function, migration and tests are additive; `deploy-supabase.yml` gets the function in its
  `deno check` loop (`functions deploy` already deploys every function).

### Client

- **Ayarlar → Hesap** gets one more row (`AccountDeleteRow`):
  - signed in: **"Hesabımı ve verilerimi sil"** → dialog listing what is deleted, what is not
    (shared dictionary; other devices keep their local copy until they are wiped or the app is
    removed), a "JSON yedeğini indir" button (the existing export), and a typed confirmation;
  - guest or signed out: **"Bu cihazdaki verileri sil"** (local wipe only, no server call).
- **Typed confirmation word "SİL"** (`domain/deletion.ts`): compared after NFC, trim and both
  Turkish and English lower-casing, so "sil", "SIL" (a keyboard without İ) and "SİL" all work.
- `deleteAccount` (`features/account/deletion.ts`): server first; only after it confirms is the
  device wiped (`wipeLocalDatabase`: every Dexie table in one transaction; the `engapp-tts`
  audio cache; the `engapp.*` localStorage keys; the push subscription in the browser) and the
  session signed out locally (`signOut({scope: 'local'})`: the server session is already gone).
  If the server call fails nothing local is touched and the dialog says so. After the server
  succeeded, a failing local step is logged and the flow still signs out.
- The page then **reloads** to `/hesap-sil?durum=silindi` (or `?durum=cihaz`): a full reload
  drops every in-memory state (React Query caches, the sync engine, timers) that still refers
  to the old account. The sync engine also checks `meta.user_id`, which the wipe removed.

### Public pages: `/gizlilik`, `/privacy`, `/hesap-sil`

- Lazy routes outside the app shell (`routes.unshift` in `app/router.tsx`, additive), with their
  own `PublicLayout`: logo, "Uygulamaya dön", footer links; same tokens, fonts and themes as the
  app. They start no connected feature: no sync, no push, no outbox; `/hesap-sil` only starts
  auth (`startAuth()`). "Uygulamaya dön" is a plain `<a href="/">` (full load) so the shell
  starts fresh, especially after a deletion.
- They work on Cloudflare Pages (SPA fallback to `index.html`, like every route) and inside the
  native app (same bundle; İP5's WebView serves the SPA).
- `/hesap-sil` (web deletion): signed out it explains what is deleted and offers Google sign-in
  (redirect back to `/hesap-sil`); signed in it shows the account (name, e-mail) with "Bu sen
  değil misin? Çıkış yap", and the same dialog with `wipe: 'if-linked'`: this browser is wiped
  only when its local data belongs to the deleted account (`meta.user_id`), so deleting from a
  shared or other person's browser never destroys that browser's guest data. The JSON backup is
  not offered there (this browser may hold nothing).
- **Policy text** lives in `src/legal/privacy.tr.ts` and `privacy.en.ts` as structured data
  (sections, paragraphs, lists, with `**bold**`, `[link](/path)` and `{{email}}`), rendered by
  `LegalText`. Long legal prose is content, not UI strings, so it is not in the i18n files
  (headings and UI around it are). Turkish is binding; English is a translation.
- **Contact e-mail** from the build-time `VITE_CONTACT_EMAIL` (`src/legal/contact.ts` checks
  the format). Without it the pages show a visible "(iletişim adresi henüz eklenmedi)"
  placeholder rather than a made-up address. The controller name is `CONTROLLER_NAME` in
  `src/legal/types.ts`.

### Privacy policy sources (each statement is backed by code)

| Statement | Source |
| --- | --- |
| Guest mode sends nothing to the server | `features/auth/startConnected.ts` (sync, push, AI need a session); e2e "guest wipe makes no backend calls" |
| Google gives name, e-mail, photo link, account id | Supabase Auth Google provider; `features/auth/session.ts` reads `full_name`, `avatar_url` |
| Learning data synced (list in the policy) | `sync_tables`, user tables in `supabase/migrations/*` |
| Sources keep title, file name, page count only | `sources` table columns |
| Random per-install device id in logs, not an ad id | `data/meta.ts` `getDeviceId`; `review_logs.device_id` |
| AI text to Gemini; candidates cached ≤ 90 days | `ai-extract`, `ai_chunk_cache`, purge job |
| Daily usage counters | `ai_usage`, `tts_usage` |
| Push: endpoint, keys, user agent, sent days | `push_subscriptions`, `push_log` |
| No analytics; error log stays on device | no analytics SDK in `package.json`; `data/errorLog.ts` is Dexie only |
| Supabase in the EU (Ireland) | project region eu-west-1 |
| Gemini free tier: Google may use the content, human review | Gemini API terms for unpaid services; config uses the free tier |
| Word images send only dictionary data to Anthropic | v0.4 İP3 design (plan "Claude API ve maliyet"); **check when İP3 is merged** |
| Tombstones purged after 30 days; AI cache, AI usage, push log after 90 | `purge_tombstones(30)`, purge functions in migrations |
| Deletion removes everything and the account | this ADR; `22_account_delete.test.sql` |
| Encrypted in transit; row-level security; keys only on server | HTTPS endpoints; `tables_without_rls()` test; AGENTS.md rules 3–4 |
| Not for under-18s | Gemini API terms require 18+ users (owner to confirm) |

### Play listing kit (`docs/play-store/`)

- `listing-tr.md`, `listing-en.md`: name, short and full description with measured lengths;
  only features that exist; no ranking or price claims.
- `data-safety.md`: every question of the Data safety form with the source of each answer.
- `content-rating.md`: IARC answers, target audience 18+, the AI-generated content policy,
  the other App content forms.
- `testers-message-tr.md`: WhatsApp invitation for the 12 × 14 days closed test.
- `scripts/store-shots.ts`: six 1080×1920 screenshots in both themes plus the 512×512 icon and
  the 1024×500 feature graphic, rendered by Playwright's Chromium from seeded demo data with a
  made-up demo account against the e2e fake backend (no network, no live AI call). The images
  are committed under `docs/play-store/screenshots/` and `graphics/`.

## Deviations from the plan

- **Data safety file path**: `docs/play-store/data-safety.md` instead of
  `docs/play-data-safety.md`, so the whole listing kit is in one folder.
- **`/privacy` (English)** added next to `/gizlilik`: the Play reviewers and Google's policy
  team read English; the Turkish text stays binding.
- **App name**: "Engapp – İngilizce Kelime Kartları" is 34 characters, over Play's 30-character
  limit. `listing-tr.md` proposes "Engapp – İngilizce Kelimeler" (28); the owner chooses.
- **18+ audience** (not in the plan): follows from the Gemini API terms and keeps the app out
  of the Families policy, which the free Gemini tier would not meet.
- **Deletion is explicit then cascading** rather than "delete the auth user → cascade" alone
  (A.7): same result, but a partial failure can be retried and the rows removed are reported.
- **Not done (deferred):** an in-app "report this AI content to the developer" action
  (`content-rating.md`); the native app's Google sign-in on `/hesap-sil` depends on İP5
  (Capacitor; until then the web page is used in a browser).

## Consequences

- Any new user table must reference `auth.users (id) on delete cascade` (the SQL test fails
  otherwise); it is then deleted with the account without touching this code.
- Any new data flow (a new AI call, a new processor, a new stored field) must update
  `privacy.tr.ts`, `privacy.en.ts`, `PRIVACY_UPDATED` and `docs/play-store/data-safety.md`
  together.
- Other devices of a deleted account keep their local copy (they cannot be reached). Their
  session can no longer be refreshed and sync stops; the user can wipe them with "Bu cihazdaki
  verileri sil" (or by removing the app). The dialog and `/hesap-sil` say this.
