# 0043 — The reader: synced texts, the knowledge model, encounters

**Context.** v0.5 makes reading the second way to meet words (plan İP1, appendix A.2, A.3, A.6):
every text the app gets (paste, PDF, article, photo, library, daily story) opens in one reader
that colours words by what the user knows, says how much of the text they know, lets them guess
and then look up a word, add it as a card with its sentence, and listen along. The contract
commits put a local-only `texts` table, an unsynced `encounters` table and stubbed
`loadKnowledge` on the base. Acceptance criteria 1 (speed), 2 (difficulty estimate), 10
(privacy) and 12 (nothing old breaks) apply.

**Decision.**

- **Synced, private tables.** `texts` and `encounters` are synced like notes: Dexie v29 adds
  them to the sync writer, outbox, engine, backup (schema 11), the account discard, guest
  adoption and the integrity check. On the server they are `public.user_texts` and
  `public.user_encounters` (migration `20261101000100_reader.sql`): RLS on `auth.uid()` for
  select, insert and update, no client DELETE (tombstones, purged by `purge_tombstones`),
  `ON DELETE CASCADE` from `auth.users` (account deletion), registry rows so `sync_push` and
  `sync_pull_v3` handle them with no new functions, and never returned to v0.1 pulls. The
  client keeps its table names and maps them at the wire (`src/sync/api.ts`
  `serverTableName` / `localTableName`). Both are `LATE_SYNC_TABLES`: rows wait in the outbox,
  without failed attempts, until the server lists the table. The v29 upgrade queues every text
  stored by v28 and asks for a one-time re-pull of settings, texts and encounters.
- **Multi-account rule.** Texts and encounters are one account's data: "kartları kopyala"
  copies neither (they are discarded with the rest of the other account's rows), and a guest's
  texts and encounters go to the account the guest signs in to, like their cards
  (`link.test.ts`). Nothing of a text is ever written to a shared table: the word sheet asks
  ai-enrich with the word alone, never the sentence, and listen-along never sends a user's
  sentence to the `tts` function (see below). SQL test `43_reader` checks that a push leaves
  `lexicon_*` and `ai_chunk_cache` unchanged.
- **Encounters per device.** A row is `<note>|<day>|<source>|<device>` with a count `n`. Two
  devices counting the same word on the same day each own their row, so last-writer-wins
  never loses a count; screens add the rows up. The server key is `(user_id, id)` (the id is
  derived, so two users may have the same one). A reader opening counts each of the user's
  notes in the text once, guarded by the router location key (plus the page load for the first
  entry), so re-renders, remounts and React StrictMode count nothing twice. Answering a card
  adds a `review` encounter in the same transaction as the answer; FSRS fields and
  `review_logs` are untouched. The word detail and the reader's sheet show "Bu kelimeyi N kez
  gördün: x kartta, y metinde", where x is the larger of the review encounters and the
  answers in `review_logs` (the counter starts with v0.5; the logs go back further).
- **Knowledge model** (`src/domain/knowledgeModel.ts`, pure; inputs gathered by
  `src/data/knowledge.ts`). `lemmatize`: the user's own word or "Biliyorum" word in any of its
  forms first, then a base form the word lists hold, then one the frequency data holds, else
  the word as written; contractions fold to their base ("won't" → "will"). `pKnown`: function
  words 1; the user's notes by stage (Pekişiyor, Öğrenildi, Kalıcı 1; Öğreniyor 0.35; a card
  never answered at most 0.35); "Biliyorum" words 1; otherwise the weekly level model's known
  share for the lemma's band (word-list level, else the wordfreq Zipf band), with the unknown
  share scaled down for very frequent words (×0.5 at Zipf ≥ 5, ×0.25 at 5.5, ×0.1 at 6: the
  model's share counts word types, running text is mostly the commonest of them); 0.6 when the
  level file is not on the device yet. Hyphenated words take their least known part. The band
  shares are cached per session and recomputed when the level, the answers or the known words
  change.
- **Tokeniser** (`src/domain/readerTokens.ts`, pure): paragraphs on blank lines, sentences with
  abbreviation and initials handling, words with offsets. Numbers, single letters, web and mail
  addresses, acronyms and capitalised words in mid-sentence are not counted; a capitalised
  sentence opener is a name too when the text never writes it in lower case. Coverage is the
  existing `measureCoverage`; the chip rounds the known share down so it never flatters.
- **The screen** `/oku/:textId` (immersive, its own top bar): calm marks (no mark for known
  and learned words, a dotted or thin underline for words being learned, a soft amber wash
  only for likely-new words; switchable, with a legend), "Bu metnin %N'sını biliyorsun", a
  tap opens a sheet that asks for a guess before showing the meaning (the user's card, Kelime
  Bankası, then the cached lexicon: all offline; ai-enrich only when none has it and the
  device is online and signed in), the cached picture, the sound and "Karta ekle"
  (`addNoteWithSenses` with the sentence and the word's span, so the card gets a cloze too).
  Phrases: the user's multi-word cards are found in the text (any form of the first word);
  any selection can grow by the word before or after it. "Dinleyerek oku" reads sentence by
  sentence and marks the sentence. Position and reading time (activity-based, idle gaps capped
  at 2 min) are saved when the screen is left or hidden; "Bitirdim", "Yeniden oku" and "Çok
  zor / Çok kolay" close a text.
- **Entry points.** Desteler gets a fourth segment, Okuma (Metinlerim, then İP5's
  `GradedLibraryList`); Bugün a quiet "Bugünün okuması" card (the last unfinished text, else
  `suggestedGradedTexts(difficulty, 1)`, else an invitation to paste); the paste and PDF flows
  an "Okuyucuda aç" button, and guests (who cannot use the AI import) a collapsed paste box
  under the sign-in prompt. Ayarlar → Çalışma gains Okuma: the difficulty (Rahat / Dengeli /
  Zorlayıcı, `settings.reading_difficulty`, default Dengeli) and the word colours
  (`settings.reader_highlight`).

**Why, and where this differs from the plan.**

- _Feedback offset._ The plan's "±0.01" nudge would move a 4 % text by 0.01 points: too small to
  notice. `settings.reading_offset` instead scales the estimated unknown share of words the
  user has no record of by `1 + offset`; each "çok zor" adds 0.1, each "çok kolay" takes 0.1,
  bounded to ±0.5. Changing a text's answer takes the old nudge back, so a text counts once.
  The user's own words and "Biliyorum" words are never moved by it.
- _Graded rows are synced._ The plan keeps `graded` texts out of `user_texts`. A library text's
  row holds the user's position, time and answer, which should follow them to another device;
  its body is shared content, so storing it is no privacy cost. Kinds are not filtered.
- _Body limit._ 300,000 characters (the client's `MAX_TEXT_CHARS`) instead of 200 KB, so a
  text the client accepts is never rejected by the server and stuck in the outbox.
- _Lemmatiser._ The Wiktionary morphology file in the repository is derivational (families),
  not inflectional, so lemmas come from the rule-based `lemmaForms` + irregular table the
  server's tokeniser already uses, checked against the client level file.
- _Encounter rows have sync fields and a device id_ (the contract's `EncounterRow` had none);
  `encounterId` keeps its three-argument form for callers that do not store rows.
- _No Web Worker._ Tokenising, lemmatising and colouring a 1,000-word text takes a few tens of
  milliseconds on the test machine (tests assert < 1 s for the whole view on the real level
  file), so the work stays on the main thread, memoised per text and knowledge change.
- _Listen-along voice._ A sentence plays from pre-generated audio when that is already in
  memory (library and story texts prefetch the next sentences), otherwise with the device
  voice. The user's own text is never sent to the `tts` edge function: it would put private
  text on the server and spend the TTS budget on audio nobody else can use.

**Deferred.**

- Reading minutes and words on İlerleme (plan bullet "okunan dakika ve kelime sayısı"): the data
  is stored (`read_ms`, finished texts); the İlerleme card is left for the progress screen's
  owner.
- Pre-generated audio for library sentences under their own keys (`graded/{id}/{i}.mp3`, İP5)
  is not looked up yet: listen-along uses the device voice for them until İP5 exposes those
  URLs.
- The Bugün suggestion links to Desteler → Okuma; opening a library text directly is İP5's
  (it should `saveText({ kind: 'graded', graded_id, body })` and navigate to `readerPath`).
- Undoing an answer does not take its review encounter back (the line shows the larger of the
  encounters and the answers, so it settles on the logs).
