# Word families, roots and affixes: reference data

This folder builds the reference data behind the "Aile" (word family) row, the root/affix card
suggestion and the affix cards (İP6, ADR 0014). The data comes from free, commercially usable
sources only. Their licences are listed in `docs/licenses/morphology.md`.

| Step | Command | Output |
| --- | --- | --- |
| 1. Build | `node scripts/build-morphology/index.ts --etymology kaikki` (or `mirror`) | `public/data/morphology-<sha10>.json`, `src/features/family/morphologyAsset.ts`, `data/reference/morphology.sources.json` |
| 2. Turkish meanings (one-off, AI) | `node --env-file=<secrets> scripts/build-morphology/meanings.ts` | `data/reference/morpheme-meanings.tr.json` |
| 3. Rebuild to merge the meanings | step 1 again | same as step 1 |
| 4. Load into Supabase (service role) | `node scripts/build-morphology/load-sql.ts > ref.sql`, then `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ref.sql` | `ref_*` tables, curated rows in `lexicon_pair_notes` |

When outbound traffic goes through a proxy, run the commands with `NODE_USE_ENV_PROXY=1`. The scripts need
Node 24, which runs `.ts` files directly and provides `node:sqlite`.

## Sources and pipeline

1. **Vocabulary.** The wheel of [wordfreq](https://github.com/rspeer/wordfreq) 3.1.1 (PyPI) gives
   the 30,000 most frequent purely alphabetic English words.
2. **Derivations.** [MorphyNet](https://github.com/kbatsuren/MorphyNet) `eng.derivational.v1.tsv`
   (`inspect → inspection, -ion`) is filtered by `cleanEdges`:
   - both words must be in the vocabulary;
   - the affix must be in `inventory.ts`;
   - no compounds or inflections;
   - the derived word must keep its base;
   - each word gets a single parent.

   The families are the connected components of the edges that remain.
3. **Etymologies.** Wiktionary etymologies are used through kaikki.org:
   - They confirm roots. *inspect* gets `-spect-` only because its etymology names Latin *īnspiciō*; *special* does not.
   - They add affixes from Wiktionary's surface analysis ("equivalent to in- + -spect").
   - **kaikki**: the official extract (about 2.7 GB, includes templates).
   - **mirror**: a pinned SQLite copy of the same data (etymology text only). kaikki.org was not reachable from the build sandbox, so the committed file was built from the mirror. The GitHub workflow "Build morphology data" runs the kaikki variant.
4. **Inventory.** `inventory.ts` is the hand-made list of prefixes, suffixes and roots. Each entry has:
   - its MorphyNet aliases;
   - its part-of-speech rules;
   - for roots, a spelling pattern, an etymology-evidence pattern and an exclusion list;
   - a short Turkish meaning, which the app shows until the AI meanings exist.

   A morpheme is kept only if at least 3 words carry it.

Every download is checked against the SHA-256 pinned in `sources.ts`. The kaikki extract changes
weekly, so its checksum is recorded in `morphology.sources.json` instead of being pinned.

## Turkish meanings (`morpheme-tr-v1`)

`meanings.ts` sends the kept morphemes, 20 per request, to Gemini. The prompt and the validation live in
`supabase/functions/_shared/morphemes.ts`, and the prompt is copied verbatim in `docs/ai-pipeline.md`.

- **Secrets.** The key and model names come only from the environment: the `GEMINI_API_KEY` secret and the `GEMINI_MODEL` variable in GitHub.
- **Reruns.** Already explained morphemes are skipped, so a rerun makes 0 calls; pass `--force` to redo them all.
- **Review.** The owner can edit `morpheme-meanings.tr.json` by hand. Set `"reviewed": true` on an entry after checking it.

## Reviewing the false-friend list

`data/reference/false-friends.en-tr.md` is a plain Markdown table. The app parses it at runtime
(`src/domain/pairNotes.ts`), and the tests fail with the line number if a row is malformed.
`load-sql.ts` copies the list into `lexicon_pair_notes`.
