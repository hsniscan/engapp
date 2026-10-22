# 0034 — "Paylaş → Engapp" (share target)

## Context

v0.4 İP6 (plan "İP6 Paylaş → Engapp", Annex A.6, acceptance criterion 10): text selected in any
app is shared to Engapp and lands in a card preview in under 10 seconds. One word → card preview
for that term; a sentence or more → the existing "metinden kelime çıkar" preview with the text as
the source sentence; a link → only the page title for now (full article import is v0.5).

## Decision

1. **One route for every entry: `/share?text=…&title=…&url=…`.** The Android app's
   `ACTION_SEND text/plain` intent filter (app-local `ShareTarget` plugin) and the installed PWA's
   Web Share Target (`share_target`, GET, in the manifest) both open it.
2. **Routing is a pure function** (`src/features/share/route.ts`, unit + property tests):
   - no link, ≤ 3 words → `term` (quotes and edge punctuation removed);
   - a link (from `url`, or the first `http(s)://` in the text) with at most 30 other words →
     `link`; its title is the share's subject/title, else the other words ("Title – url"), else
     none (the page shows the address and says full articles come later);
   - otherwise → `text` (a long passage that contains a link drops the link).
     Only `http(s)` counts as a link.
3. **Term:** redirect to `/add?term=…`; the manual form looks the term up in the lexicon and shows
   its meanings — that is the card preview.
4. **Text:** the page shows the text and, when signed in, creates the text import job at once and
   replaces itself with `/import/:jobId`. Candidates come with the sentence they were found in,
   which is the shared text. One job per text per session (StrictMode, re-renders). Guests keep
   the text on screen with the usual sign-in invitation (AI needs an account, decision 0002).
5. **Link:** title and address, a note that full article import comes later, and actions on the
   title (≤ 3 words: add as a card; longer: find its words). The page is not fetched: browsers
   block reading other sites' HTML, and server-side fetching is v0.5's article import.
6. **Android delivery:** `ShareTargetPlugin` turns the intent into a `shareReceived` event,
   retained until the web app adds its listener (cold start) and delivered at once when the app
   runs (warm start, `singleTask`). Replays from Recents and redelivery after process death are
   ignored; the web side de-duplicates by intent id. Text is capped at 300 000 characters (one
   import).

## Why

- A single route keeps Android, the PWA and tests on one code path; the e2e test drives it in the
  web build at 360 px.
- Starting the extraction without an extra tap is what makes "under 10 seconds" reachable; the
  chunk cache and the daily AI budget bound the cost of an accidental share.

## Limits

- Images, files and multiple items are not accepted (text/plain only).
- The page title is whatever the sharing app sends; many apps send none.
