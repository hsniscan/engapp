# Word-family reference data: sources and licences

The owner's rule is that every source must be free and allow commercial use. Share-alike
licences (CC BY-SA) are fine. NonCommercial, research-only and "no derivatives" licences are not.
Each licence below was checked against the source itself on 2026-10-21, not taken from secondary
listings.

| Source | What we use | Licence (where checked) | Verdict |
| --- | --- | --- | --- |
| [wordfreq](https://github.com/rspeer/wordfreq) 3.1.1, Robyn Speer | The 30,000 most frequent English words (selection and ordering only) | Data: CC BY-SA 4.0. Code: Apache-2.0. Checked in the wheel's `METADATA`, "License" section. | OK: commercial use allowed, share-alike |
| [MorphyNet](https://github.com/kbatsuren/MorphyNet) v1, commit `378144f`, Batsuren, Bella and Giunchiglia (SIGMORPHON 2021) | English derivation pairs (`eng.derivational.v1.tsv`) | CC BY-SA 3.0. The README at that commit, section "License", links to creativecommons.org/licenses/by-sa/3.0; the repository has no LICENSE file. | OK. BY-SA 3.0 §4(b) lets an adaptation use a later version with the same elements, so the output can be CC BY-SA 4.0 |
| Wiktionary via [kaikki.org](https://kaikki.org) / wiktextract, Tatu Ylonen | Etymology text and templates (evidence for roots and affixes) | Wiktionary text: CC BY-SA 4.0 and GFDL (dual licensed). kaikki.org redistributes it under the same terms. | OK under CC BY-SA 4.0 (we do not rely on the GFDL) |
| [thymesis-dictionary](https://github.com/ZexiKuang/thymesis-dictionary) release `kaikki-en-v1` (repository commit `674989f`) | SQLite copy of the kaikki English extract. Used for the committed build because kaikki.org was blocked in the build sandbox | The README, section "License", says "Derived from Wiktionary via Kaikki/Wiktextract and distributed under Creative Commons Attribution-ShareAlike (CC BY-SA)". No LICENSE file. | OK: same Wiktionary content, same licence. Temporary: rebuild from kaikki.org in the GitHub workflow |
| `data/reference/false-friends.en-tr.md` | 149 English↔Turkish false friends | Written for Engapp; not copied from another list | Our own content |
| `data/reference/morpheme-meanings.tr.json` | Turkish explanations of the morphemes | Generated with Gemini by the `morpheme-tr-v1` job; reviewable | Our own content (generated output) |

Do not add a new source until you have checked its licence the same way. Some well-known
morphology resources are licensed for research only or have no licence at all, so they must not
be added. Examples are CELEX, which is distributed by LDC under a licence agreement, and
etymology websites without a licence.

## What this means for the app

`public/data/morphology-<sha>.json` is an adaptation of the CC BY-SA sources. It is published under
**CC BY-SA 4.0**, and `public/data/morphology-LICENSE.txt` carries the notice. The app is not an
adaptation: it only reads the file. Its own code licence is therefore unaffected, but the attribution
must stay visible. It is shown in the file itself, in the licence notice, and in the family section's
"Kaynak" note.

Source versions and checksums are recorded in `data/reference/morphology.sources.json`.
