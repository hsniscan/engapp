# 0020 — Turkish mnemonics, and topics and false friends from the extraction call

## Context

v0.3 İP2 adds "Anımsatıcı": a short Turkish association that helps a learner remember an
English word (a Turkish word that sounds like it, a tiny story, a picture to imagine).
The same package moves the extraction prompt to `extract-v5`, so the one extract call per
chunk also returns the text's topics and false friends of new senses (the V0.2 design
already had a place for both). Constraints:

- No user text may reach the model or a shared table (AGENTS.md; acceptance criterion 9:
  "user text never reaches the shared lexicon").
- A second request for the same meaning must cost 0 AI calls (criterion 9), for every user.
- Every suggestion can be edited, rejected or replaced by a new one ("Başka öner").
- When there is no good association the app says so instead of forcing a bad one.
- The free Gemini quota is shared: one call per request, no extra call for topics or
  false friends, and no live calls in tests.

## Decision

1. **Shared suggestions in `lexicon_pair_notes`.** Kind `mnemonic_suggestion`, pair
   `en-tr`, one row per suggestion of a lexicon sense (`content = {type, text_tr, why}`,
   `content_key` = the normalised text, model and `mnemonic-v1`). The table already had the
   unique key and the "model or curated" check (decision 0014); migration
   `20261023000200_mnemonics.sql` adds a shape CHECK for this kind, a `(sense_id, kind)`
   index, `lexicon_pair_notes_find` (signed-in users and the service role) and
   `lexicon_pair_notes_insert` (service role only, insert-or-skip). Clients cannot write
   the table.
2. **`ai-mnemonic(sense_id, more)`.** Shared table first: a sense with any row is answered
   from it without a model call or budget unless `more` is set. Otherwise one model call
   (`GEMINI_MODEL` / fallback from the environment) returns 0–2 suggestions, checked on the
   server: Turkish, 12–220 characters, the English term present (any inflection, also with
   a Turkish suffix), no near-duplicate. "Başka öner" passes the stored suggestions as
   `AVOID`; the request carries nothing but the sense id. A sense keeps at most 10
   suggestions; then "Başka öner" answers from the table. Details: `docs/ai-mnemonic.md`.
3. **"No good association" is an answer.** An empty first result stores a marker row
   (`content_key '-none-'`, `{type: 'none'}`), never sent to clients, so the next request
   is free as well; the response says `none: true` and the app shows "Bu kelime için iyi
   bir çağrışım bulunamadı" with "Kendin yaz".
4. **The user's choice is private.** A pick, an edit or the user's own text is one
   `user_content` row per sense of the user (`kind 'mnemonic'`, deterministic id from the
   sense id, `replaces_id` = the suggestion or null, `selected: true`). A rejection is a
   `content_feedback` row (`target_kind 'mnemonic'`, target = the suggestion id, `reject`),
   hidden for this user only; "Geri al" is a tombstone. Rejecting the chosen, unedited
   suggestion also clears the choice (and "Geri al" restores it). Both tables were already
   synced per user with RLS (decision 0013); no new user table. pgTAP
   `15_mnemonics.test.sql` checks that a user's text never appears in the shared tables.
5. **Device cache.** Dexie v13 adds `lexicon_pair_notes` (read-only cache, not synced,
   kept when switching or copying accounts like the lexicon cache). The detail sheet works
   offline from it; guests and senses outside the shared lexicon can still write their own.
6. **Where it shows.** "Anımsatıcı" section in the word detail (per sense); the chosen
   mnemonic in small type on the card back. `src/features/mnemonics` exports `useMnemonic`
   and `MnemonicHint` (hidden until tapped, since it gives the meaning away) for a later
   package to show it on the front of a card.
7. **extract-v5.** The extraction response gains `topics` (1–2 keys of
   `src/domain/topics.ts` per chunk; the edge function keeps a copy of the list, checked
   by a test) and, per new sense, `false_friend_tr` (a Turkish look-alike with another
   meaning, or null). Topics are stored per chunk on the import job and aggregated into
   `sources.topics` when the job is done (`aggregateTopics`, decision 0015). A false friend
   is checked (sounds like the term, different meaning), stored as a `false_friend` pair
   note with model and prompt version (the follow-up decision 0014 left open), returned on
   the candidate and cached on the importing device; the warning strip shows it after the
   hand-written list, which wins for the same Turkish word. The candidate selection is the
   same as `extract-v4`, so the recorded golden answers stay valid.

## Consequences

- Second and later requests for a sense cost no AI call for anyone; the first user pays one
  call from the shared daily budget.
- Model-written false friends reach other devices only through the import of a text with
  that word (on that device) — there is no pull of pair notes yet. Mnemonic suggestions
  reach every device through `ai-mnemonic` (free from the table).
- The Gemini response schema for `false_friend_tr` uses a nullable object (`type: ['object',
  'null']`); it was not tried against the live model in this package (no live calls).
- The weekly golden check of 20 words for mnemonics is still manual.
