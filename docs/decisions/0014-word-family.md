# 0014 — Word families, root/affix cards and false friends (İP6, part 1)

## Context

The v0.2 plan (İP6) wants three things:

- an "Aile" row in word detail, with carded words bold and the others one tap away;
- root/affix cards ("-spect-" = bakmak);
- an orange false-friend strip on the card back ("actually ≠ aktüel").

The data comes from Wiktionary (via kaikki.org), MorphyNet and a hand-written list. The plan
also lists AI mnemonics and a `false_friend_tr` field in the extract/enrich prompts. Both depend
on other work packages (İP5 `user_content`, İP2 `extract-v3`), so they are not part of this step.

Owner rules:

- every source must be free and allow commercial use;
- large generated data stays out of the client bundle;
- guest mode, offline use, sync, backups, extra study and sense dedup must keep working;
- study history never moves between Google accounts.

## Decision

1. **Sources and licences.** The sources are wordfreq 3.1.1 (vocabulary: the 30,000 most frequent
   words), MorphyNet v1 (derivations) and Wiktionary etymologies via kaikki.org (evidence for roots
   and affixes). All three are CC BY-SA and were checked at the source; see
   `docs/licenses/morphology.md`. The output file is CC BY-SA 4.0 and carries its notice. Every
   download is pinned by checksum. Licences, versions and checksums are recorded in
   `data/reference/morphology.sources.json`.

2. **kaikki.org mirror (temporary).** kaikki.org was blocked from the build sandbox, so the
   committed file was built from a pinned SQLite mirror of the same kaikki English extract
   (`thymesis-dictionary` release `kaikki-en-v1`, same licence). The mirror has etymology text
   only. The official extract also has etymology templates, which `build.ts` already reads. The
   "Build morphology data" workflow runs the official variant, and its output should replace the
   committed file.

3. **Noise rules instead of raw MorphyNet.** Raw MorphyNet links unrelated words: compounds,
   inflections, and lookalikes such as moon → month. Its families also chain into one blob of
   thousands of words. Edges are kept only when they meet all of these conditions:
   - both words are in the vocabulary;
   - the affix is in the curated inventory (about 85 affixes);
   - the derived word keeps its base;
   - each word has one parent.

   A root needs both the spelling and the evidence: *special* does not get `-spect-`, because its
   etymology does not name *specere*. Families larger than 40 words are dropped, and so are
   morphemes carried by fewer than 3 words.

   Result: 2,598 families (7,142 words) and 133 morphemes across 7,744 words. 28 of the 30-word
   test set show a family (the bar is 25).

4. **The client reads a static file, not tables (deviation).** The plan says `ref_*` tables. They
   exist (migration `20261022000200`) and are loaded by `load-sql.ts` for server-side use. The
   app, however, reads `public/data/morphology-<sha>.json`:
   - about 345 KB, about 87 KB gzipped;
   - not in the bundle and not precached;
   - fetched the first time a word detail or root card needs it;
   - kept in Dexie `ref_cache`, keyed by checksum.

   This also works for guests and offline, which a `ref_lookup` RPC cannot. It needs no RLS
   round trip per word detail, and a new build simply has a new checksum. `ref_cache` is a
   device cache: it survives an account switch or copy, because it holds no user data.

5. **The false-friend list is a reviewable Markdown table (deviation).**
   - `data/reference/false-friends.en-tr.md` holds 149 pairs, each with what both words mean,
     "tam/kısmi" and an optional note. It is our own text.
   - The app parses it at runtime in a lazy 17 KB chunk, which the service worker precaches, so
     it also works offline. A malformed row fails the tests with its line number.
   - The same table is loaded into the shared `lexicon_pair_notes` table (`kind = 'false_friend'`,
     `curated = true`). The upsert is keyed on (pair, kind, term, sense, content key). Removed rows
     are retired, never deleted.

6. **`lexicon_pair_notes` is term-level, with an optional sense.** A false friend belongs to a
   spelling, not to one lexicon sense: *actually* misleads in every sense. `sense_id` is still
   available for AI notes that are tied to one sense. Signed-in users can read the table; only
   the service role writes to it. It is stamped from `lexicon_seq`, like the lexicon, so a later
   `lexicon_pull` can deliver it. An AI row must name its model and prompt version.

7. **Feedback is device-local for now (deviation).** "Gizle" and "Hatalı" write to Dexie
   `pair_note_feedback`, which is cleared on an account switch, so feedback never crosses
   accounts. Rows have `sent_at = null` so they can be sent once İP5's `content_feedback`
   exists. Nothing the user does changes the shared rows.

8. **Root/affix cards.**
   - An affix card is a note with `term_type = 'affix'`. The server constraint is widened and
     `sync_push` accepts it.
   - It has only the recognition card: `ensureSenseCards` creates no production or cloze card for
     it, and switching a note to or from affix adds or removes them.
   - The term is the morpheme's form ("-spect-"). The sense holds the Turkish meaning, the English
     gloss and the kind as `pos`.
   - The back shows the morpheme's note and the user's words that carry it. The front has no
     speak button.

9. **When a root card is suggested.**
   - The suggestion appears in word detail, for a morpheme of that word that at least 3 of the
     user's live words carry, counting inflected spellings.
   - It is not shown when the user already has a card for that morpheme, or has closed the
     suggestion (`meta.family_dismissed_morphemes`).
   - Roots come before prefixes, and prefixes before suffixes; only the first is shown, so the
     sheet does not nag.

   The plan did not fix where the suggestion appears. Word detail is where the family already is.

10. **One tap on a faded family word.**
    - The app looks up the word in the shared dictionary: the device's `lexicon_cache` first, then
      `ai-enrich`. The server only calls the model when the dictionary lacks the word.
    - The word is added with its first meaning, and a toast shows that meaning.
    - Guests have no dictionary, and the lookup can fail offline. In both cases `/add?term=…` opens
      with the word filled in.

11. **Turkish morpheme meanings (`morpheme-tr-v1`) come from a script, not a nightly edge function
    (deviation).**
    - 133 morphemes need about 7 calls, once. The script runs locally or in the workflow with the
      `GEMINI_API_KEY` secret.
    - The output, `data/reference/morpheme-meanings.tr.json`, is committed and reviewable. Each item
      records its model and prompt version. Rerunning skips items that are already done.
    - Before the job has run, the app falls back to the short hand-written meaning in `inventory.ts`.
    - The prompt and schema are in `docs/ai-pipeline.md`, and a test keeps them in sync.

12. **Dexie version 6.** Version 6 adds `ref_cache` and `pair_note_feedback`. It sits on top of
    version 3 (versions 4 and 5 belong to İP2 and İP5, and Dexie allows gaps). An older app version
    cannot read an affix note: its zod check rejects the note, logs it as `sync.pull invalid
    notes/…`, and moves the cursor past it. If the error log has such a row, the upgrade resets
    `sync_cursor` to 0, so the note arrives on the next pull. Rows are merged by HLC, so
    re-pulling changes nothing else. Without such a row, the cursor is kept and no extra download
    happens.

## Consequences

- Data rebuilds are a manual workflow run. A maintainer reviews and commits the artifact, then
  loads `reference-data.sql` into Supabase with the service role. Nothing deploys itself.
- The first word detail on a new device downloads about 87 KB. A device that has never opened one
  while online shows no family row offline; everything else works.
- Backups do not include `pair_note_feedback`. A restored device shows hidden warnings again.
- Follow-ups:
  - `lexicon_pull` should deliver `lexicon_pair_notes` to clients, because the curated list is
    currently read from the bundle;
  - `content_feedback` should send dismiss/report;
  - `false_friend_tr` from `extract-v3`/`enrich-v2` should be written into `lexicon_pair_notes`
    with model and prompt version;
  - AI mnemonics should be stored as `kind = 'mnemonic_suggestion'` / `user_content`.
