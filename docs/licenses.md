# Data licences

Third-party data shipped with Engapp or stored by its backend. Code dependencies have their
own licences in `node_modules` and are not listed here. The in-app attribution is
**Ayarlar → Hakkında → Kaynaklar** (`src/features/settings/SourcesPage.tsx`, route
`/settings/kaynaklar`).

## Rule

Only data that is free to use **commercially** (attribution and share-alike are fine,
NonCommercial is not). Excluded on purpose: the Oxford 3000/5000, Cambridge English
Vocabulary Profile and Kelly lists (no commercial licence), and anything marked NC.

## Word levels (v0.2 İP2)

Built by `scripts/build-levels.ts` from pinned downloads; versions, URLs and SHA-256 sums are
also in `data/levels/manifest.json` and in the `ref_sources` table.

| Source                                            | Version                                          | Used for                             | Licence                                                                     | SHA-256 of the file used                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CEFR-J Wordlist (Tono Laboratory, TUFS)           | 1.5, via Open Language Profiles commit `d4e45b7` | A1–B2 levels (7 964 entries)         | Free for research and commercial use with proper citation; © Tono Lab, TUFS | `b0dd3c635f1c9a4fdf1490c7e5b7c48e8bbe55b652ad0c9860a95f98e10ae498` (`cefrj-vocabulary-profile-1.5.csv`)                                                            |
| Octanove Vocabulary Profile C1/C2 (Octanove Labs) | 1.0, same commit                                 | C1–C2 levels (2 120 entries)         | CC BY-SA 4.0                                                                | `18c33a407f2f89f7b8de9671c6d45fe3ea0bce45e7d2d7dcaab48d73e0f7b380` (`octanove-vocabulary-profile-c1c2-1.0.csv`)                                                    |
| wordfreq (Robyn Speer), English "large" list      | 3.1.1 (PyPI wheel)                               | Zipf frequency of 30 221 words (≥ 3) | Data CC BY-SA 4.0 (code Apache-2.0; not used)                               | wheel `4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473`; `large_en.msgpack.gz` `dffae8066b78dce0a6667cf5f58e567054f902674667090a7ac8a8a44628b05c` |

Download URLs:

- `https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/d4e45b75b38f27b30dfc5c44d8c571aec7e7092f/cefrj-vocabulary-profile-1.5.csv`
- `https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/d4e45b75b38f27b30dfc5c44d8c571aec7e7092f/octanove-vocabulary-profile-c1c2-1.0.csv`
- `https://files.pythonhosted.org/packages/py3/w/wordfreq/wordfreq-3.1.1-py3-none-any.whl`

Citations (also on the Kaynaklar page):

- The CEFR-J Wordlist Version 1.5. Compiled by Yukio Tono, Tokyo University of Foreign
  Studies. Retrieved from http://www.cefr-j.org/download.html (via Open Language Profiles).
- Octanove Vocabulary Profile C1/C2 (ver 1.0), Octanove Labs.
- Robyn Speer. (2022). rspeer/wordfreq: v3.0 (v3.0.2). Zenodo.
  https://doi.org/10.5281/zenodo.7199437. wordfreq includes SUBTLEX (Brysbaert et al.; free
  for any use with credit), OpenSubtitles 2018, Google Books Ngrams, Wikipedia, NewsCrawl,
  OSCAR and ParaCrawl data.

### CEFR-J terms: verdict

**Commercial use is allowed, with citation.** The Open Language Profiles repository that
publishes the CSV states: "CEFR-J vocabulary and grammar profile datasets can be used for
research and commercial purposes with no charge, provided that you cite the dataset
properly. The copyright belongs to Tono Laboratory at TUFS." Other descriptions of the list
say the same ("can be used for both research and commercial purposes with a proper
acknowledgement of the source"). The official site `cefr-j.org` could not be reached from
the build environment (21 Oct 2026), so its download page was not read directly; check it
before a commercial launch, and drop the list and fall back to Octanove (C1/C2), the AI guess
and frequency if the terms there ever say otherwise. There is no share-alike condition on CEFR-J
itself; the combined files are CC BY-SA because of Octanove and wordfreq.

### Share-alike: where the CC BY-SA data lives

The CC BY-SA data and everything derived from it is kept apart from the app's code and the
AI-built lexicon, and carries its own licence notice:

- Files: `data/levels/ref-word-levels.tsv`, `data/levels/ref-word-freq.tsv`,
  `data/levels/client-levels.tsv` (the level file shipped to the client, served as a separate
  asset) and `data/levels/level-tr.tsv` when exported. Each starts with a header naming its
  sources and the licence: CC BY-SA 4.0.
- Tables: `ref_word_levels`, `ref_word_freq` and `ref_sources` (migration
  `20261021001100_word_levels.sql`, data in `20261021001200_ref_word_data.sql`, whose header
  states the licence).
- The lexicon stores only facts derived per sense (`cefr`, `cefr_source`, `cefr_list`,
  `cefr_reason_tr`) and the term's Zipf value. Users see them in the app with the
  attribution above.
- The Turkish-learner corrections (`ref_word_levels.tr_*`, prompt `level-tr-v1`) are an
  adaptation of the list and are shared under the same licence.

Share-alike applies to these data files and their adaptations, not to the application code
that reads them.
