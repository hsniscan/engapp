# 0078 — Remove the estimated vocabulary size from the UI

## Context

The plan (Ek A.9, v0.2 İP8 "Sayaç") shows an estimated vocabulary size, "Tahmini kelime
hazinen", on İlerleme, on Profil and on the level test result: Σ (words of a level in the word
list × share of that level the user knows) + learned words outside the list. The owner said on
2026-11-26 that it shows ~4000 for him, far more than he knows, and that it hurts trust in the
app. The level ratios come from a yes/no test and are good enough to place a level, but
multiplying them by thousands of list words turns a small error into a large, very visible one.

## Decision

The word-count estimate is removed everywhere it was shown: the İlerleme tile (now "Seviyen":
the level, the level ladder and how much of the next level the user knows, in percent), the
Profil level card (the level only), the level test result (the ladder only), and the "en az N
kelime" floor on Profil. The explanation dialog, `domain/vocabSize.ts`,
`domain/progressView.vocabularyFloor` and `LevelOverview.vocab` are deleted. Copy that promised a
word count ("seviyeni ve tahmini kelime sayını öğren") now speaks of the level only.

`level_tests.vocab_estimate` stays in the schema and is still written (insert-only, synced, a
not-null column on Supabase): dropping it would need a Dexie version and a migration for no user
benefit, and the stored value is never shown.

## Why

A number that is visibly wrong costs more trust than it adds. The estimated CEFR level and the
per-level shares stay, because they are what the test actually measures.
