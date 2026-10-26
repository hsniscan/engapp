# 0052 — Smart review: interference guard, example rotation, streak protection, gentle reminders

Status: accepted (v0.5 İP10, branch `v05-smart`). Dexie 34, migration `20261101001000`, i18n
namespace `smart`.

## Context

Plan v0.5 İP10 and appendix A.6: related words should not be introduced on the same day;
each review should show a different example sentence, the user's own texts first; the streak
gets two automatic protections a month, next to the existing vacation mode, and one review a day
keeps it; reminders must not cause guilt and come at most once a day.

## Decision

### Interference guard (`domain/newOrder.ts`, `domain/queue.ts`, `data/smart.ts`)
- The smart order (ADR 0039) already treated these words as *soft* conflicts and took them
  anyway when nothing else was left. Three groups are now **hard**: at most one first-time card
  a day from one confusable pair (reported confusion, contrast card, false friend; ADR 0026),
  one normalised Turkish meaning (a shared `meaningAlternatives` item of `meaning_tr`, the same
  "same meaning" rule as `isSameMeaningTr`), or one synonym set.
- **Synonym set** (there is no synonym table): the note's own term plus the alternatives of its
  senses' lexicon `gloss_en`, normalised (`synonymKey`). "big" (gloss "large") and "large"
  share a key. İP9's `alt_en` lists, if they land, can be added to `NewNoteFacts.synonyms`.
- Cards introduced earlier today, in any study mode, count. The guard skips a blocked card
  and keeps scanning, so the daily count only drops when every card left is blocked (property
  test).
- **Carry:** a blocked card that was next in line is reported as `postponed`. The review
  session stores these cards in the device-local meta row `smart_carry`, and on a later day
  they come first (still guarded). Spelling and family conflicts stay soft, as before.
- **Deviation:** the insertion order ("Eklenme sırası") now has the guard and carry too
  (`selectAddedCards`). The data layer builds the order input for both orders.

### Example rotation (`domain/textSentences.ts`, `data/textSentences.ts`, `domain/examples.ts`)
- **Order:** the card's own sentence first, then sentences from the user's texts (`texts`;
  graded texts through `graded_bodies`, with their Turkish translation), then the stored
  example sentences. The card's own sentence also comes from the user's texts, so this follows
  both the brief and A.6.
- The search is local and simple: regular endings by word class, plus a short list of
  irregular forms. A miss means one sentence fewer, never a wrong form. Nouns only get the
  plural, so "bank" never matches "banker". At most 4 sentences of 20–260 characters, newest
  text first. Texts are read once and results are cached per word; any write to texts clears
  the cache.
- Text sentences are used only for notes with **one** live sense, because a found sentence
  cannot tell meanings apart.
- **No repeat:** the index is still seeded by `reps`. The sentence shown last is kept as
  `{reps, hash}` in device-local meta (`example_last:<card>`), and `pickRotating` steps over it
  when the list changed in between. The same `reps` shows the same sentence again.
- The translation is shown only when one exists. A small "Senin metninden" caption marks
  these sentences.
- **Privacy:** user text is never written to a synced or shared table. Meta holds a hash only
  (data test).

### Streak protection (`domain/streakFreeze.ts`, `data/streakFreeze.ts`)
- **Streak definition checked, unchanged:** a day counts when it has at least one answer
  (`isActive`: `reviews > 0`), separate from the daily goal.
- Two protections per calendar month. On app start and on Bugün, the missed days since the
  last active day are covered, but only if each month's allowance covers all of them.
  Otherwise the streak ends and nothing is spent.
- Vacation days are skipped and never use a protection. A covered day that later turns active
  (logs from another device synced late) or becomes a vacation day gives its protection back,
  so the two never double count.
- **Storage (deviation from A.6's "streak_freezes list"):** an optional column of the synced
  settings row, not a new table. It syncs per account through `writeTx` and HLC like every
  settings field, it is covered by the settings RLS, and settings never move between accounts
  (link tests extended).
  - The server check is `is_streak_freeze_list`: at most 48 day keys. pgTAP:
    `52_streak_freezes.test.sql`.
  - Dexie 34 re-pulls settings once.
  - Settings merge whole-row last-writer-wins. A protection lost to a concurrent write
    self-heals, because the next open plans it again.
- Bugün shows a calm note the day after a protection was used. Closing it is remembered on
  the device only.

### Gentle reminders
- The reminder text (Web Push and Android local) changes from "Bugün N tekrar seni bekliyor
  (~M dk)" to "Bugün N kart tekrara hazır, yaklaşık M dk.".
- A test keeps every reminder, notification and streak string (TR and EN) free of guilt,
  pressure and mascot phrasing.
- **One a day:** Web Push keeps its `push_log` rule. The phone planner now also applies an
  explicit `onePerDay` budget, so the reminder that asks a card (ADR 0048) is that day's
  reminder and never an extra one. Turning on the phone reminder already removes the
  account's Web Push subscriptions.

## Deferred / known
- Kotlin `CardReminders.restore` re-arms a reminder up to 12 h old after a reboot. It can fire
  inside quiet hours, though never as a second reminder of the same day. The fix belongs to
  the native code and was not built here (no Android toolchain).
- The synonym set is as good as the lexicon's English glosses.
- Irregular forms are a short list.
- The carry is per device.
- The new reminder copy reaches Web Push users only after `push-send` is redeployed.
