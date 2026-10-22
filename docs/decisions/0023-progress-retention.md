# 0023 — Progress tracking: one retention rule, computed on the device

## Context

v0.3 İP5 (plan "İP5 — Gelişim takibi", Annex A.6, acceptance criterion 4). The stats screen
gets a "Gelişim" tab: retention by category, the recognition–production gap with a practice
round over the biggest gaps, and a 12-week series. The weekly report (İP7) must name the
weakest category with the same numbers, so the rule has to be one pure function both call.
Budget: < 200 ms of computation for 5,000 cards, no chart library.

## Decision

1. **The rule** (`src/domain/retention.ts`): from the answers that still count (undo rows and
   the answers they cancel removed; practice rounds write `practice_logs` only, so they never
   count), take per card and **local day** (day starts at `day_start_hour`) only the first
   answer, and only when the card was in state **Review** right before it. Retention = share
   of those answers rated other than Again. Early reviews count like any other answer.
2. **Minimum and interval.** A rate is shown, and a group can be weakest or strongest, only
   with n ≥ 20 (`MIN_ANSWERS`); otherwise the UI says "veri az" with the count. The Wilson 95 %
   score interval is shown in the row's tooltip, drawn as a whisker on the bar, and read out in
   the row's accessible name.
3. **Groups.** term type (word/phrase/pattern/affix), level (the note's level as the app shows
   it, `noteLevel`), topic (topics of the sources of the card's sense(s)), source, part of
   speech (lower-cased `senses.pos`), card type. A production/cloze card uses its own sense;
   a recognition card uses all live senses of its note. A card with several topics, sources
   or parts of speech counts once in each. Cards without a value go to a `none` group
   ("Elle eklenenler", "Konusu belli değil"…), which is shown but never weakest/strongest
   (nothing to act on). Deleted cards and notes are left out. The category view covers the
   last 90 days; the 12-week series covers its own weeks (Monday start).
4. **weakestGroup tie-break** (deterministic): lowest rate (compared exactly by
   cross-multiplying counts, no float ties), then more answers, then dimension order
   (term_type, level, topic, source, pos, card_type), then key. `strongestGroup` mirrors it.
   Twenty fixed scenarios (`retention.scenarios.test.ts`) pin it: 20/20.
5. **State before an answer without FSRS.** Replaying ts-fsrs for 50,000 logs takes ~0.5 s.
   With short-term scheduling on and every (re)learning step shorter than a day, ts-fsrs
   moves a card between New/Learning/Review/Relearning by rating and step index only, so
   `nextStudyState` replays that state machine instead (property-tested against `replayCard`).
   Day keys come from one zone-offset lookup per UTC day (`makeDayOf`, tested against
   `dayKeyOf` across DST switches and 30/45-minute zones). 5,000 cards × 11 logs: ~80 ms in
   the unit test. If FSRS_CONFIG ever gets a step of a day or more, the property test fails.
6. **Gap practice.** The existing practice mode gets a `'list'` source: `/practice?source=
   list&notes=a,b` (≤ 20 note ids), the hardest card of each note first. Notes qualify with
   ≥ 3 counted answers on each side and recognition better than production; largest gap
   first. Practice still writes `practice_logs` only.
7. **No schema change.** Everything is derived from existing tables; no Dexie version, no
   migration.

## API for the weekly report (İP7)

`loadRetentionInput(now)` (data) → `{data, facts, today}`; then the pure
`retentionByGroup(data, facts, dimension, {from, to})`, `retentionByAllGroups`,
`overallRetention`, `weakestGroup(groups)`, `strongestGroup(groups)`,
`recognitionProductionGap(data, facts, window)`, `biggestGapNoteIds`, `weeklySeries`.

## Why

One rule in one pure module keeps the tab and the report consistent and testable; counting
only first-of-day answers to Review cards measures memory, not learning steps or same-day
repetition. Wilson intervals behave at small n and near 0 %/100 %, where a normal
approximation does not.
