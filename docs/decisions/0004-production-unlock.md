# 0004 — Production/cloze cards unlock at Review

**Decision.** Keep the plan: a note's production (TR→EN) and cloze cards are
created locked and unlock when the recognition card first reaches FSRS state
Review (graduated from learning steps). Stored as `cards.unlocked`, and
re-derived from review logs on recompute so sync/undo stay consistent.
**Why.** Producing a word before recognising it is frustrating and inflates
lapses; recognition-first matches how the user learns new vocabulary.
