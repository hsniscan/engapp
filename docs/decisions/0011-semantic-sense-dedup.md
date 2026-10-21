# 0011 — One sense per meaning: Turkish meaning overlap as the duplicate rule

## Context

Hasan's note for "invitation" had two noun senses with the same example sentence ("Thank you
very much for the invitation."): "a polite request to attend an event" → davetiye, davet and
"a polite request to go somewhere or do something" → davet. They are one meaning.

How it got there (from the code; the server rows were not inspected):

- **Lexicon.** New senses were matched to existing ones only on the English gloss (same
  `gloss_key`, Jaccard ≥ 0.8, or containment of ≥ 3 tokens). The two glosses share 2 of 7
  tokens, so the second wording became a second lexicon sense. Re-importing the 2000-word
  list after `extract-v2` asked the model again for every entry. It either ignored
  KNOWN_SENSES or was never shown the sense: the 300-sense cap was filled term by term in
  alphabetical order, so a long word-list chunk could leave later terms out. Concurrency
  (three chunks in flight) allowed the same thing between requests, because every request
  checked the senses it read before its model call. Enrich's "Başka anlam ara" had the
  same gloss-only check.
- **Note.** The "zaten var" mark (same lexicon sense, meaning or sentence) only set the
  preview's default selection. "Tümünü seç" selected those rows again, a second job's
  status was computed before the first was confirmed, and before the list-prefix fix the
  two runs could store different prefixes of the same sentence. `addNoteWithSenses`, which
  runs when the user confirms, skipped only the same lexicon sense id or the exact same
  meaning, so "davet" next to "davetiye, davet" was added. The idle list-prefix repair then
  made both sentences identical.

## Decision

1. **Rule.** Two senses of one term are the same when they have the same part of speech and
   their Turkish meanings share a whole alternative (`isSameMeaningTr`: "davet" ~ "davetiye,
   davet"; not "banka" ~ "kıyı", "çalışmak" ~ "işlemek", "nehir kıyısı" ~ "deniz kıyısı").
   Such senses would make the same production card. The check needs no model call.
2. **Server.** `resolveNewSenses` (extract and enrich) reuses such a sense. `lexicon_upsert()`
   (migration `20261021001000`) takes the lexicon advisory lock and repeats the check
   against committed rows, so concurrent requests reuse each other's senses. Extract keeps
   one candidate per term and sentence (a known ref first). KNOWN_SENSES are picked round
   robin. **No prompt change and no version bump:** the guard catches what the prompt rule
   would ask for, and a bump would re-extract every cached chunk.
3. **Client.** Import candidates are deduplicated by term and sentence (the sense the user
   has, then a known sense, then confidence). `userStatusOf` and `addNoteWithSenses` apply
   the rule; confirmed imports also skip a sense whose sentence the note already has.
4. **Existing data.** A one-off idle repair (`repairDuplicateSenses`) soft-deletes
   unstudied duplicate senses through the normal actions, so the change syncs. Studied
   senses are never touched. Server lexicon rows are **not** merged in a migration, because
   users' senses point to them by id. lexicon_pull is not filtered either, since hiding rows there
   would be a lexicon merge by another name.

## Why

The Turkish meaning is what the learner studies. When it overlaps, a second sense is noise
whatever the English says, and the check is free. Merging on any shared word inside an
alternative would merge real senses ("nehir kıyısı" / "deniz kıyısı"), so only whole
alternatives count. The rule can merge two English senses that Turkish words the same way.
That is accepted: their cards would be the same anyway.
