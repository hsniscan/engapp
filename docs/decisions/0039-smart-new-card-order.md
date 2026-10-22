# 0039 — Smart new-card order ("Akıllı yeni kart sırası")

**Context.** New cards were introduced by insertion order (`created_at`, then id). The owner
noticed that two accounts with the same cards get the same new words in the same order, and
that the order ignores everything the app knows about the learner: their level, how common a
word is, what they are working on right now, and which words are easy to mix up. The queue
is rebuilt on every session open and after every answer, so whatever replaces the order must
stay cheap (1,000 cards: session open < 1 s; 10,000 cards: < 2 s cold).

## Acceptance criteria (and their tests)

1. Default order "Akıllı (önerilen)"; "Eklenme sırası" keeps the old order exactly. A synced
   setting (`settings.new_card_order`, null = smart). — `src/data/newOrder.test.ts`,
   `SettingsPage.test.tsx`, `syncMerge.test.ts`, Dexie v25 test, pgTAP
   `39_new_card_order.test.sql`.
2. Level fit: about 60 % at the learner's level X, about 30 % below X (closest level first),
   at most 10 % at X+1, nothing above X+1 while anything at or below X+1 is left. Unknown
   level counts as X+1 (the smart-extraction rule, decision 0018). — property tests in
   `src/domain/newOrder.test.ts`.
3. Frequency: inside a band the more common word (zipf of the client level file) first.
4. The user's own signals: a word typed in by hand in the last 7 days comes first (oldest
   first, whatever its level); cards of a source the user works on lead their band and are
   never held back for good. — property and example tests.
5. Interference: two confusable notes are not introduced on the same day while another card
   can take the place: same word family, same lemma, an obvious derivation, a shared Turkish
   meaning, near spelling (the confusables rule), a reported confusion, a contrast card and
   its terms, a cached false friend. Cards introduced earlier today count. — tests per kind
   and a property test.
6. Per-user variation: two accounts with the same cards get different orders; the same user
   gets the same order all day (re-opening the session continues the sequence). — property
   tests (domain) and a data test that answers two new cards and rebuilds.
7. Every queue invariant holds: daily limit + extra allowance, one card per note per day,
   1 new per 5 reviews, catch-up ramp, burying, suspended/locked/deleted cards, no new cards
   in "ahead" mode. — a property test comparing counts and item kinds with insertion order.
8. Speed: existing perf tests pass (`perf.test.tsx`, `actions.test.ts`, e2e `perf.spec.ts`
   with 1,000 and 10,000 cards); new domain and data perf tests.

## Decision

**Domain (`src/domain/newOrder.ts`, pure).** `selectNewCards(fresh, limit, blocked, input)`
chooses today's new cards greedily:

- *Bands.* Each card's note falls into `priority` (hand-added in the last 7 days), `same`,
  `lower`, `next` or `above`. A hand-added note older than 7 days and a note of an active
  source are never `above` (at most `next`): the user chose them, so they trickle in.
- *Mix.* The next card comes from the band with the largest shortfall against its share
  (same 0.6, lower 0.3, next 0.1; a band with nothing left gives its share to the other one).
  `next` is only eligible while `10 · (next + 1) ≤ n + 1`, or when nothing at or below X is
  left; `above` only when `same`, `lower` and `next` are all empty. Hand-added priority cards
  are not counted in the mix.
- *Score inside a band* (higher first): zipf (2–7 → 0–1; unknown 0.35) + waiting time
  (up to 0.4 after 60 days) + active source 2 + hand-added 0.4 − 0.25 per extra level below X
  + 0.05 for a recognition card + jitter ±0.15. All fixed for the day: ages count from the
  day's start.
- *Jitter.* `jitter = hash(seed, card id)`, `seed = hash(user id | day key)` (a guest uses
  its settings creation time). Different per user and per day, stable within a day.
- *Interference.* A candidate confusable with a note chosen today (or introduced earlier
  today) is skipped while another usable card exists; lookups go through keys (family, lemma,
  meaning, 5-letter stem, symmetric-delete spelling variants, pair partners) and are then
  checked exactly (`confusable`), so the check is cheap. Order of fallbacks: a confusable card
  at the level comes after a non-confusable X+1 card, then confusable cards are taken after
  all (the limit is filled when the pool allows), and `above` last.
- *Stability.* The cards introduced earlier today seed the counts and the conflict set, so the
  greedy run after k introductions continues with exactly the cards the first run chose after
  them (property-tested).

`buildQueue` calls it when `ctx.newOrder` is set; the 1-per-note rule (via `blocked`), the
limit and the 5:1 interleave are unchanged. The result carries `newReasons` (manual, source,
level, gap, stretch, beyond) for a later "neden bu kelime?" hint.

**Data (`src/data/newOrder.ts`).** `newOrderInput` runs inside `getStudyQueue`'s transaction
and reads the facts of the notes of today's new cards (`noteFacts`: resolved level, zipf,
hand-added = no live sense has a source, the first source, word family, lemma, Turkish
meanings, contrast terms), the active sources (created in the last 14 days, or a word started
from them in the 7 days before today — computed once per day and only when a pool word has a
source), reported confusions (`user_content` kind `confusion`) and cached false friends
(`lexicon_pair_notes`, the look-alike's English words). Note rows are cached per app session
and dropped on any write to `notes`, `senses`, `lexicon_cache`, `lexicon_pair_notes`,
`user_content` or `ref_cache` (Dexie's `storagemutated`, which also covers other tabs);
answers write none of these, so the rebuild after an answer reads nothing new. Large first
reads use one `getAll` per table instead of a lookup per key.

`loadTodayFacts` also returns `introducedNoteIds` (notes of the cards first answered today).

**Setting.** `settings.new_card_order` (`'smart' | 'added'`, nullable; null/absent = smart),
in Ayarlar → Çalışma under the daily limit ("Yeni kelime sırası: Akıllı (önerilen) / Eklenme
sırası"). Server: migration `20261026001200_new_card_order.sql` (nullable text with a check;
an older client's push without the key keeps it, `_sync_upsert`). Client: zod pull schema
(`.catch(null)` for unknown values), patch schema, `LATE_COLUMNS` (`fillLateColumns`), Dexie
v25 re-pulls settings once. Backups carry it as an optional field (no schema version bump,
like `show_image_front`). Not copied to another account beyond what settings already are.

## Why

- **Greedy with quotas instead of a global sort.** The level rule is about the *day's set*
  (shares), and interference is about pairs *within a day*; a single score cannot express
  either. Greedy selection over pre-sorted bands is O(n log n + limit · scan) and makes the
  within-day stability a simple prefix property.
- **The smart-extraction shares (decision 0018)** so the import preview and the queue agree on
  what "for you" means. Sixty percent rather than exactly 55 % keeps integer days natural
  (10 → 6/3/1) and stays above the 55 % floor.
- **Hand-added words first.** Typing a word in is the strongest intent signal the app gets;
  they come oldest first so a burst of additions is not starved by later ones.
- **Active sources lead their band but do not break the level rule.** A text the user is
  reading should not wait behind an old pile, but a C2-heavy import would otherwise flood a
  B1 learner; such words come as X+1 (at most 10 %).
- **Seed from user + day.** Different accounts differ; the same account is stable all day and
  across devices (the seed is computed, not stored).

## Deviations and limits

- **The level file is not fetched by the queue.** Awaiting a fetch inside the live query loses
  Dexie's zone, and parsing it delayed a cold start's first card by ~100 ms. The order uses the
  file once something else loaded it (the card's level badge does on the first card); before
  that, levels stored with the lexicon count. The part of the day's order not shown yet may
  then change; what was shown stays consistent (introduced cards seed the selection).
- **Word families** come from the morphology file only when the family screens cached it
  (`ref_cache`); otherwise the derivation rule (a common prefix of at least 5 letters and 70 %
  of the shorter word) stands in. The curated false-friend list lives in a feature module and
  is not used (only false friends cached in `lexicon_pair_notes`).
- **Same lemma, different sense** of one note is already covered by "one card per note per
  day"; the lemma key catches two notes of one lemma.
- **With a daily limit below 10, X+1 words never come** while words at or below X are left
  (10 % of fewer than 10 rounds down). This is the "sparingly" of the rule.
- **"Neden bu kelime?"** is not shown yet; the reasons are computed (`newReasons`).
- Inside a Dexie transaction a helper that returns at once from a cache must not be awaited
  (it can drop the zone and commit the transaction early); the data module reads cached
  values synchronously and awaits loaders only on a miss.
