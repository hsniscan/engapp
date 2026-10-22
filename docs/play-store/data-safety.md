# Play Console: Data safety form

Play Console → Policy → App content → Data safety. The answers below follow the form's order and
agree with the privacy policy (`src/legal/privacy.tr.ts`, published at `/gizlilik`). Each "Yes"
points to the code or table it comes from, so the form can be checked again when the data flow
changes. If the two ever disagree, fix the code, the policy and this file together (ADR 0035).

`<APP_URL>` is the production web address of the app (Cloudflare Pages).

## 1. Data collection and security

| Question | Answer | Why |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** | Signed-in users' learning data is synced to Supabase; AI text goes to Google Gemini. |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | The app talks only to HTTPS endpoints (Supabase, Cloudflare, Google). |
| Which methods of account creation does your app support? | **OAuth** (Sign in with Google) | `src/lib/supabase.ts` `signInWithGoogle`; no username/password (ADR 0002). |
| Delete account URL | `<APP_URL>/hesap-sil` | Web deletion with Google sign-in (`src/features/legal/DeleteAccountPage.tsx`). |
| Do you provide a way for users to request that some or all of their data is deleted, without requiring them to delete their account? | **Yes** | Deleting a card or word in the app deletes it on the server too (tombstone, purged after 30 days). URL field: leave empty, or `<APP_URL>/gizlilik#silme`. |
| Has your app been independently validated against a global security standard? | **No** | |

The app can be used without an account (guest mode): everything then stays on the device and
nothing in this form applies. That is why every data type below is **optional**.

## 2. Data types

Only the types marked collected are ticked in the form; everything else is **not collected**.

| Category | Data type | Collected | Shared | Ephemeral | Required? | Purposes |
| --- | --- | --- | --- | --- | --- | --- |
| Location | Approximate, Precise | No | | | | |
| Personal info | **Name** | Yes | No | No | Optional | App functionality, Account management |
| Personal info | **Email address** | Yes | No | No | Optional | App functionality, Account management |
| Personal info | **User IDs** | Yes | No | No | Optional | App functionality, Account management |
| Personal info | Address, Phone number, Race and ethnicity, Political or religious beliefs, Sexual orientation | No | | | | |
| Personal info | **Other info** (profile photo link from Google) | Yes | No | No | Optional | Account management |
| Financial info | all | No | | | | |
| Health and fitness | all | No | | | | |
| Messages | Emails, SMS or MMS, Other in-app messages | No | | | | |
| Photos and videos | Photos, Videos | No | | | | |
| Audio files | Voice or sound recordings, Music files, Other audio files | No | | | | |
| Files and docs | **Files and docs** (text of an imported PDF, its file name and page count) | Yes | **Yes** | No | Optional | App functionality |
| Calendar | Calendar events | No | | | | |
| Contacts | Contacts | No | | | | |
| App activity | **App interactions** (review answers and times, practice answers, level test results) | Yes | **Yes** | No | Optional | App functionality, Personalization, Fraud prevention, security and compliance |
| App activity | In-app search history | No | | | | Searching the library happens on the device only. |
| App activity | Installed apps | No | | | | |
| App activity | **Other user-generated content** (words, meanings, own example sentences, notes, decks, tags, pasted text) | Yes | **Yes** | No | Optional | App functionality |
| App activity | Other actions | No | | | | |
| Web browsing | Web browsing history | No | | | | |
| App info and performance | Crash logs, Diagnostics, Other app performance data | No | | | | The error log stays on the device (`src/data/errorLog.ts`), never sent. |
| Device or other IDs | **Device or other IDs** (random per-install id in review logs; push endpoint and browser name if reminders are on) | Yes | No | No | Optional | App functionality |

### Where each "collected" comes from

- **Name, email, profile photo link, user ID:** Supabase Auth from Google sign-in
  (`auth.users`; shown by `src/features/auth`). The user ID is the Supabase account id; the
  Google account id is kept by Supabase Auth as the identity.
- **Files and docs:** `src/features/import` reads the PDF on the device and sends the text in
  chunks to the `ai-extract` function; `ai_chunk_cache` keeps candidates and their sentences
  for 90 days; `sources` keeps title, file name and page count only.
- **App interactions:** `review_logs`, `practice_logs`, `level_tests`, `known_terms`,
  `weekly_reports`, card scheduling state in `cards`; `ai_usage` and `tts_usage` count calls per
  day to enforce the daily limits (that is the "fraud prevention" purpose: abuse limits, not
  profiling). Personalization: the level and interests choose which candidates are suggested.
- **Other user-generated content:** `notes` (with tags), `senses`, `user_content` (own example
  sentences and memory hints), `content_feedback` (liked or hidden AI content), `decks` and the
  pasted text sent to `ai-extract`.
- **Device or other IDs:** `device_id` in the review logs (a random id made at install,
  `src/data/meta.ts`), not the advertising ID or any hardware id; `push_subscriptions`
  (endpoint, keys, `user_agent`) when web reminders are on.

### Why "Shared: Yes" for three types

Play does not count transfers to service providers that process data on the developer's behalf
as sharing. Supabase, Cloudflare and the browsers' push services are such providers, so they do
not make anything "shared".

Google Gemini is used on the **free tier**, where Google's terms let Google use the submitted
content to improve its products and let human reviewers read it. That is more than processing
on our behalf, so the content sent to Gemini is declared **shared**:

- **Files and docs / Other user-generated content:** text pasted or read from a PDF for
  "Metinden kart çıkar"; a word added by hand (`ai-enrich`); words and short definitions for
  theme grouping (`ai-themes`); the word or sentence to read aloud (`tts`).
- **App interactions:** the weekly report comment (`ai-report`) receives counts derived from the
  review history (numbers only, no words). Declared shared to be safe.

If the project moves to the paid Gemini tier (Google does not use paid-tier prompts to improve its
products), these three rows can change to "Shared: No"; update the privacy policy at the same
time.

Not shared: the word images (v0.4 İP3) send only shared dictionary data (lemma, part of speech,
Turkish gloss, drawing hint) to Anthropic, never anything from a user's account.

## 3. Other answers on the same page

- **Is data collection required?** No: guest mode works without an account. Each type above is
  "optional (users can choose whether it is collected)".
- **Data is processed ephemerally?** No for all (it is stored for sync).
- **Advertising:** no ads SDK, no advertising ID. In App content → Ads: **No, my app does not
  contain ads**.
- **Selling data:** none.

## 4. Check before submitting

- `/gizlilik` and `/hesap-sil` open without signing in on `<APP_URL>` (e2e
  `tests/e2e/play-readiness.spec.ts`).
- `VITE_CONTACT_EMAIL` is set in the production build, so the policy shows a real address.
- The Play Console privacy policy URL is `<APP_URL>/gizlilik`.
