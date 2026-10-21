# 0013 — Example sentences: shared cache, open context list, private feedback

## Context

v0.2 İP5 (`plan/v0.2-plan.md`) adds example sentences in several contexts to every card:
on the back of a card, in the word detail, and rotating on the front. The plan sketched
four fixed tabs (Günlük · İş · Teknik · Resmi). The owner asked for a context set that is
not limited to those four and can grow. Other constraints:

- No user text may reach the model or a shared table (acceptance criterion 7).
- A sense that already has sentences must not cost an AI call (criterion 6); the daily
  budget is shared with imports (criterion 8: ≈ 3 calls for 20 new cards).
- Feedback and edits are the user's own data: synced between the user's devices, never
  across Google accounts (decision 0009), never visible to anyone else.
- Guest mode, offline use, backups, sync, extra study (İP1) and sense dedup (0011) keep
  working.

## Decision

1. **Shared, server-written cache.** `public.lexicon_examples` (sense, context, level band,
   English sentence, span, `translations` as `{"tr": …}`, model, prompt version, status).
   Every signed-in user reads it; only the `ai-examples` function (service role) writes it,
   through `lexicon_examples_insert` with `UNIQUE (sense_id, text_key)`. The request names
   lexicon sense ids only; the server reads lemma, part of speech and gloss itself, so the
   model never sees anything the user wrote. Prompt `examples-v1`, documented in
   `docs/ai-examples.md`.
2. **Level bands.** A1/A2 → A2, B1, B2, C1/C2 → C1. The client shows the band closest to
   the user's level when its own band has nothing for a context.
3. **Open context catalogue (deviation from the plan).** Twelve contexts — `daily`
   (Günlük), `conversation` (Sohbet), `work` (İş), `formal` (Resmi), `academic`,
   `technology`, `travel`, `health`, `money`, `culture`, `sports`, `nature` — defined once
   in `examples-contracts.ts` with the text the model reads. The database checks only the
   key format, so a new context is a code change. Defaults are four *registers* almost
   every word is used in (everyday, spoken, work, formal written) instead of the plan's
   "Teknik", which fits few words; "technology" is one of the topic contexts. The user
   picks 2–4 contexts for background preparation in Settings and can ask for any other
   one on a card ("Bağlam ekle"). The model may leave out a context that does not fit a
   word rather than force an unnatural sentence; the background queue does not ask for
   that pair again. Tabs show the selected contexts plus any other context that has
   sentences; the last tab used opens first. (Ordering by interests is İP7's.)
4. **Server validation.** The term must be in the sentence (any inflection; the server
   computes the span), ≤ 25 words / 300 characters, clean Latin text, a real Turkish
   translation, no duplicate or near-duplicate (≥ 70 % same words) of the sense's other
   sentences. Invalid items are dropped and counted; the rest are stored.
5. **Generic per-user tables.** `content_feedback` (`target_kind`, `target_id`, `verdict`
   like/skip/reject) and `user_content` (`kind`, `lexicon_sense_id`, `sense_id`,
   `context`, `replaces_id`, `text`, `translations`, `span`, `selected`) are registered
   sync tables with `conflict_key (user_id, id)`. İP6 stores mnemonics in `user_content`
   with another `kind`. Ids are derived from the target (UUID v8 of SHA-256), so a like on
   two devices is one row that last-writer-wins settles; "taking it back" is a tombstone.
   An edit replaces the shared sentence for that user only; a rejected sentence (and its
   edit) is never shown again. Skipped sentences stay visible at the end of the list but
   leave the card-front rotation.
6. **Background queue on the device.** `example_jobs` (Dexie, never synced). Senses of new
   cards are queued automatically; "Tüm kartlarım için hazırla" queues all. Batches of ≤ 8
   senses × ≤ 4 contexts, one tab, online and signed in only; at most 50 background AI
   calls per local day (cache answers free), so a 500-card backfill spreads over days.
   Interactive "Yenisini üret" / "Bağlam ekle" are not capped by the device (the server
   limit applies).
7. **Rotation.** `getCardView` returns `sentence`: the source sentence and the example
   sentences take turns by `card.reps`. Cloze cards rotate only among sentences where the
   term is located. The back of the card repeats the front's sentence. Example sentence
   translations wait for a tap unless `settings.example_tr_visible`.
8. **Sync and storage.** `lexicon_examples_pull` brings the sentences of the senses the
   user has (cursor `lexicon_examples_cursor`). Content rows wait in the outbox until that
   function has answered once (a client deployed before the migration does not burn
   attempts). Dexie schema **version 5** adds the four tables (version 4 is İP2's). Backup
   format **schema_version 5** carries the two content tables as optional keys (version
   4 left to İP2); older files restore unchanged, and overwriting from an older file keeps
   local feedback. Copying cards to another account leaves feedback and edits behind.

## Consequences

- New settings columns (`example_tr_visible`, `example_contexts`) are nullable: an older
  client that upserts settings without them stores null (= defaults), it is not rejected.
  Such a client would reset a changed choice to the defaults; acceptable while every
  device runs the same PWA build within a day.
- `lexicon_examples` grows with every word anyone learns; sentences can be retired
  (`status = 'retired'`) without breaking feedback rows that point at them.
- The background cap is per device; two devices could spend up to 2 × 50 calls on the same
  day before the server's daily limit stops them.
- Not done here: the 50-sentence manual quality rating (plan "Bitti ölçütü") needs real
  model output and a person; ordering contexts by interests waits for İP7.
