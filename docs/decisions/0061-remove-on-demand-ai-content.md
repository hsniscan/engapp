# 0061 — Remove on-demand AI pictures and example sentences; dead code out

## Context

On 2026-11-01 the owner (Hasan) approved the v0.5.2 plan after the 2026-11-01 review. One of
his decisions: **pictures and example sentences are produced once, in bulk, and shipped as
content**. The app must stop asking a model for them on demand ("Görsel üret", "Yeniden üret",
"Yenisini üret", "Bağlam ekle", "Tüm kartlarım için hazırla"), while everything already made
keeps being **displayed**. The same plan asked for dead code to go (review `kod-kalitesi.md`:
about 26 unused exports, three copies of the AI error mapping, two `useOnline` hooks, two
different `targetLevel` exports).

Before this change:

- `ai-image` (decision 0030) drew one picture for a signed-in user, 10 a day, inside the
  monthly Claude budget; the word detail had "Görsel üret" / "Yeniden üret", a variant picker
  ("Bunu kullan") and "Bu görsel anlamı anlatıyor mu? Evet / Hayır" (decision 0031).
- `ai-examples` (decision 0013) wrote sentences for lexicon senses; a device-local queue
  (`example_jobs`) prepared them in the background for new cards, up to 50 calls a day, and the
  card had "Yenisini üret" and "Bağlam ekle"; Settings had "Tüm kartlarım için hazırla".
- The nightly bulk picture job (`scripts/img-batch.ts`, `images.yml`, decisions 0030, 0037)
  already drew pictures for the shared dictionary; there was no bulk sentence job.

## Decision

1. **Removed end to end:** the edge functions `ai-image` and `ai-examples` (with
   `_shared/image-instant.ts`, `_shared/examples.ts`, `examples-prompt.ts`, `examples-store.ts`
   and their tests, the `examples-docs-sync` test and `docs/ai-examples.md`); the clients
   `src/ai/examples.ts`, `requestImage` in `src/ai/image.ts`, `src/features/images/request.ts`,
   `src/features/examples/queue.ts`; the UI listed above; the deploy workflow's configuration
   for them (`IMAGE_DAILY_LIMIT`, `CLAUDE_IMAGE_MODEL`/`CHECK_MODEL`/`MONTHLY_CREDIT_USD` as
   function secrets). The deploy workflow now **deletes the two deployed functions** (idempotent),
   because `supabase functions deploy` never removes a function whose folder is gone and an old
   app version could otherwise keep spending the AI budget.
2. **Kept, because the bulk path needs it:** the nightly picture jobs, `image-pipeline.ts`
   (`drawSense` serves the pilot), the budget, the vision check of pending pictures, and the
   admin review screen `/admin/images` (it approves the bulk pictures). The shared sentence
   helpers moved to `_shared/sentences.ts` (mnemonic, contrast, report and story use them);
   `examples-contracts.ts` keeps only the context catalogue, level bands and the row type.
3. **Display stays:** cached pictures on cards, the picture card, the word detail and the
   leech sheet (shown only when a picture is cached), for guests and offline too; shipped
   sentences with translations, TTS, card-front rotation, like / skip / edit / reject; the
   user's own example sentence in the edit form. Context tabs now show only contexts that
   have sentences. "Görseli gizle" stays. Picks and "Hayır" answers synced from older versions
   still decide which picture is shown; the app no longer writes them (tests seed them with
   `src/test/legacyImageRows.ts`). The Settings context picker stays: it chooses which
   contexts a card's front rotates through.
4. **Dexie v37** drops `example_jobs` and the meta keys only it used (`examples_since`,
   `examples_backfill`, `example_calls:<day>`); test in `db.test.ts`. It was never synced or
   backed up, so nothing else changes.
5. **No Supabase migration.** `lexicon_examples_insert` / `_find`, `image_consume`,
   `image_user_has_sense`, `image_usage` and `image_request_users` stay: a future bulk sentence
   job can write through `lexicon_examples_insert`; account deletion and the 90-day purge still
   clean the per-user rows (`purge_usage_counters` reads `image_usage`); and this package could
   not run the pgTAP suite locally, so dropping objects other SQL refers to was not judged safe.
   Once the functions are deleted nothing calls the rest; a later migration may drop them.
6. **Dead code:** every export the review listed was checked by a reference scan over `src/`,
   `tests/`, `scripts/`, `supabase/` and removed when it had no reference (ImportGate,
   useStudyModeCounts, listNotes, …, see the commit); also the unused barrels
   `features/auth/index.ts`, `features/import/index.ts` and the `domain/svgSanitize.ts`
   re-export. One `aiRequestError()` in `src/ai/client.ts`; one `useOnline` /
   `subscribeOnline` in `src/lib/online.ts` (there were four copies); `candidates.targetLevel`
   is now `offerCeiling`. Seventeen i18n keys no code used left both `tr.json` and `en.json`.
   No npm dependency became unused.

## Why

- The owner's request: content is curated once (quality checked, reviewed) instead of being
  generated per tap, which also ends per-user AI cost and the "daily limit" messages.
- Deleting the deployed functions, not only the client buttons, is what actually stops the
  spending; leaving SQL in place is reversible and harmless.

## Consequences

- Words without shipped sentences or pictures show none until the bulk content covers them
  ("Bu anlam için henüz örnek cümle yok."). A bulk sentence job is the next step (not part of
  this package); the sentence prompt and contract to start from are in git history.
- `ai-examples` was the only writer of `lexicon_examples`; until the bulk job exists the table
  only holds the sentences written before v0.5.2.
- Supersedes the on-demand parts of decisions 0013 (sections 6 and the "Yenisini üret" /
  "Bağlam ekle" parts of 3), 0030 (the instant path) and 0031 (the variant picker, the
  Evet / Hayır question and "Görsel üret").
