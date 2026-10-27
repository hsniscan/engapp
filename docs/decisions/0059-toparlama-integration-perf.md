# 0059 — v0.5.1 Toparlama: integration pass, lazy Supabase client, a calm Bugün start

## Context

After the five v0.5.1 branches (0054–0058) were merged, the review's last items were left:

- The start-up bundle was 518 KB gzip against a 525 KB budget; supabase-js (~52 KB gzip) loaded
  at start-up even for a guest who never signs in.
- With 10,000 cards, tapping "Çalışmaya başla" right after Bugün appeared took about 2 s to the
  first card (cold open of the session itself: about 1 s). A profile showed the time in
  IndexedDB: Bugün's secondary cards (goals over the whole history, the optimizer offer reading
  every review log, the weekly report, word stages, decks) were reading the whole history at
  the moment of the tap, and the session queued behind them.
- The dictation reconcile (every sense) ran at start-up; the "busy" check of the background jobs
  still only knew `/review`, not `/study` or `/practice`.

## Decision

1. **supabase-js on first use.** `src/lib/supabase.ts` exports `loadSupabase()` (dynamic
   import, one client) instead of a client built at import time; `isBackendConfigured()` reads
   the build config. `mayHaveSession()` checks for a stored `sb-…-auth-token` or the OAuth
   return (`?code=`): only then does the client load at start-up, so a signed-in start is
   unchanged; a guest's `onAuthChange` hears "no session" at once and is attached to the client
   when something loads it (sign-in, the word bank or graded-text download). Without readable
   storage it assumes a session, so nobody is signed out by mistake.
   `scripts/check-bundle.ts` fails when the client (`GoTrueClient`) is in the start-up files;
   the budget goes down to 500 KB (now ~466 KB).
2. **Bugün settles before its secondary reads.** The hero (today's study and activity) loads
   first, as before; everything else on Bugün waits until the hero has painted and the page has
   been quiet for 1.2 s (`useSettled`, `src/features/home/settle.ts`). A tap within that time
   opens the session with IndexedDB to itself. Measured with the perf spec, 10,000 cards: warm
   open 2.0 s → 0.36 s; 1,000 cards unchanged (~0.3–0.5 s). Unit tests set the wait to 0.
3. **Start-up maintenance after the first paint.** The dictation reconcile runs when the browser
   is idle, 4 s after start-up, never during a study session (`whenIdle`). Every background job
   (integrity check, repairs, weekly level, reports) now treats `/study`, `/review` and
   `/practice` as busy.

## Why

The plan's budget is "a session opens in under 1 s" on a phone; the user opens Engapp to study
and taps at once. Cheaper whole-history queries would help too, but the cards below the hero are
not what the user came for in the first second; waiting for them costs nothing visible. Loading
the client lazily removes a tenth of the start-up download for every guest without touching the
signed-in path.
