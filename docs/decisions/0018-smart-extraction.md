# 0018 — Smart extraction: the level rule on the device, extract-v4

## Context

v0.2 İP4 (plan "İP4 — Akıllı çıkarma", Annex A.7, acceptance criterion 5). The owner's rule:
for a learner at level L the pre-selected candidates are at least ~55 % at L, at most 10 % at
L+1, the rest from lower levels and **never** above L+1; words the learner already knows or
has cards for are never pre-selected, and that list is compared on the device and never sent
to the server. The preview shows "Senin için", "Kolay" (closed, `show_easy_candidates`) and
"Biliyorsun", with a "Biliyorum" action. İP3 (known terms, level test) is built in parallel.

## Decision

1. **Prompt `extract-v4`.** İP2's `extract-v3` is not deployed yet, but each package goes live
   on its own, so the selection change gets its own version: the chunk caches (device and
   server) are keyed by it and must not hand back v3 selections. The user message gains
   `TARGET_LEVEL` (L+1, C2 stays C2), computed by the server from the request's `level`; the
   request itself is unchanged (`{text, chunk_hash, level}`). "WHAT TO SELECT" asks for mostly
   L, about one in ten at L+1, nothing above, lower items that learners at L often miss for
   the rest. The response schema is unchanged. İP7 will add `topics` and bump again.
2. **The device decides, the model only proposes.** One pure function,
   `planCandidates()` in `src/domain/candidates.ts`, decides section and default selection.
   It runs once, when a job's last chunk is recorded, inside the same Dexie transaction
   (`classifyJobCandidates`, `src/data/smartExtract.ts`); known terms and the level file are
   loaded just before it. A candidate's level is the lexicon sense's stored level (server rule
   with the AI guess and the Turkish-learner correction), else the same rule on the client
   level file, else unknown.
3. **Quota: the largest set that keeps both ratios.** All eligible L items are selected; L+1
   items up to 10 % and lower items fill up while L stays ≥ 55 % (`selectionQuota`, integer
   arithmetic, checked against brute force and by property tests). Consequences of the strict
   reading: with fewer than 10 selected words no L+1 word fits; **with no L word nothing is
   pre-selected** (the preview says so and points to "Kolay"): the quota is never filled with
   harder or only easier words. An unknown level counts as L+1 (Annex A.7). Lower items are
   picked closest level first (an A2 word is likelier to be new to a B1 learner than an A1
   word).
4. **Sections.** `for_you`: the selected items, then L+1 items that did not fit (unselected,
   still visible: they are the learner's next step, not "easy"). `easy`: lower items that did
   not fit. `known`: see 5. `too_hard`: above L+1 — for prose only counted in the summary line
   ("…aday önerilmedi", plan), for vocabulary lists shown in a closed "Seviyenin üstünde"
   section (see 6). Never pre-selected in any case.
5. **Known = a live note for the term (any sense) or a known term.** A candidate whose term
   already has a note is never pre-selected, also when it would add a new meaning
   (`user_status: add_sense`), which v0.1 pre-selected: the owner's rule says "words … you have
   cards for". The badge "Yeni anlam olarak ekle" stays, and the row can still be selected.
6. **Vocabulary lists.** The model still returns every entry (unchanged list rule; a
   2 000-word list keeps all its entries). The device applies the same rule, so a list does
   not pre-select hundreds of easy words, but nothing is hidden: entries above L+1 are shown
   in their own closed section, every section has "Tümünü seç", and list entries keep the
   list's order inside a section. (Pre-selecting a whole list would break the owner's
   never-above-L+1 rule.)
7. **Order** (deviation from Annex A.7, which sorts by Zipf ascending): more occurrences in the
   whole text first (inflected forms of a word count; an expression counts its surface), then
   the **more** frequent word, then text order. Of two words of the same level met equally
   often, the more frequent one is the more useful card. Stored as `rank`; `order` keeps the
   chunk order (resume and duplicate handling still rely on it).
8. **"Biliyorum"** moves the candidate and the term's other candidates in the job to
   `known`, unselects them and calls `markKnown(term, 'preview')`. No re-balancing of the rest
   of the selection (the ratios govern the default; afterwards the user is choosing).
9. **İP3 interface without İP3.** `src/data/knownTermsProvider.ts` is the only seam: a
   provider `{getKnownTermKeys(): Promise<Set<string>>, markKnown(term, source)}` with a default
   of an empty set and a no-op. Since the v0.2 merge the default is İP3's `getKnownTermKeys` /
   `markKnown` (`src/data/knownTerms.ts`); both key a word by `normalizeTerm`, like
   `notes.term_norm`. A "Biliyorum" is a `known_terms` row with source `preview`, so it
   counts in the vocabulary counter and appears in "Bildiğim kelimeler". When the preview
   opens, `refreshKnownCandidates` moves rows of words marked known since the job ran
   (another device, the level test, another preview) to "Biliyorsun".
10. **Storage.** Dexie v10 (v5–v9 belong to the other packages): `import_candidates` gains
    `cefr`, `cefr_source`, `bucket`, `from_list` and `rank` (local only, not indexed); the
    upgrade puts rows of older jobs in `known` ("zaten var") or `for_you`, selection unchanged.
    `settings.show_easy_candidates` is synced (migration `20261022000600_smart_extract.sql`),
    nullable with default false: an older app inserts its settings row without the key, and a
    push without the key keeps the value (İP2's `_sync_upsert`). The client type and schema
    take it as optional, so older backups keep their checksum. (The v0.2 merge's single backup
    format 8 is the first that can carry it; no released client knows 8, so an older client
    refuses such a file as newer instead of reporting a checksum error.) The switch is in Ayarlar → Çalışma; the preview's "Kolay" disclosure opens
    and closes per visit.
11. **Golden set.** Five texts in `data/golden/extract/` (news, a work e-mail, popular science,
    a story, a 30-entry vocabulary list) and the words a simulated learner already has.
    `scripts/golden-extract.ts record` runs the real pipeline against Gemini for B1 and B2 and
    stores the model's answers; `src/domain/candidates.golden.test.ts` replays them offline in
    every test run, asserts the criterion per text and over the set, and keeps
    `docs/quality/golden-extract.md` as a file snapshot. Levels there come from the client
    level file (no database), i.e. without the nightly Turkish-learner corrections. Recorded on
    21 Oct 2026 with `gemini-3.5-flash-lite` (the primary model was unavailable): B1 79 % at
    level / 3 % B2 / 18 % lower; B2 60 % / 5 % / 35 %; nothing above L+1, no known word
    selected; the list kept all 30 entries.
12. **Unselected rows are no longer dimmed.** v0.1 faded an unselected row's content to 70 %
    opacity; with nearly every row pre-selected that was rare, but now most rows start
    unselected and the faded muted text fails WCAG AA contrast (axe, light and dark). The
    checkbox and the card border show the selection.
13. **Numbering.** Migration `20261022000600_*`, pgTAP file `13_smart_extract.test.sql` (built
    as `18_…`, after this record, to avoid clashing with the parallel packages' files;
    renumbered in the v0.2 merge).

## Consequences

- A text with no word at the learner's level pre-selects nothing; the learner picks from
  "Senin için" (L+1) or "Kolay". This is the rule as written; if it feels too strict in use,
  the place to relax it is `selectionQuota` (one function, one test file).
- The model's selection is still capped at 30 per prose chunk; the device can only choose
  among what the model returned. The prompt asks for few L+1 items, so most chunks give
  enough L items.
- Server and device share nothing new about the learner: the known-terms list stays on the
  device (asserted by a queue test that inspects the AI request).
