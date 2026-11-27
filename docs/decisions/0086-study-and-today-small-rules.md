# 0086 — Small study and Bugün rules after the 2026-11-26 review

## Context

The 2026-11-26 browser review (notes `calisma.md`, `profil-genel.md`) found several places where
the study session and Bugün said something that read as wrong to a new learner, although the
code did what it was written to do. Four of the fixes change a rule, not only a label.

## Decision

1. **"Zorlandıkların" needs a lapse** (`domain/practice.ts isHard`). A card counts as hard with
   2+ lapses or a practice miss in the last 14 days, as before. A high FSRS difficulty or an
   Again in the last 14 days now counts only once the card has lapsed (lapses ≥ 1). A first
   Again on a new word sets its difficulty above 7, so every word missed while first learned
   was listed: "Zorlandıkların 1" after the first session, 16 on guest day 9.
2. **"Başka bir kelimeyle mi karıştı?" only for a word once known**
   (`domain/confusables.ts asksConfusion`): after Again on a Review or Relearning card, never on
   a new or learning card the learner has just met.
3. **The session total is the cards answered plus the cards still to come**
   (`useReviewSession`). It used to be every card the queue had ever held, so a new card that
   the smart order swapped for another after an answer stayed counted (0/37 → 1/38). The
   learning steps still show apart ("+2 tekrar"); a card that really joins later still adds one.
4. **No account pitch in Bugün's reminder offer for a web guest** (`notify/reminderOffer.ts`).
   Bugün already asks a guest to sign in on the reading row ("Bugünün hikâyesi … Giriş yap");
   two sign-in prompts on one screen read as nagging. A web guest cannot get a reminder without
   an account, so the offer is not shown; Ayarlar → Bildirim still explains it.

Smaller copy and display rules from the same review, no decision needed beyond this list: the
summary's recall tile reads "Tekrarlarda hatırlama" and shows from 5 reviews; a first look at a
new word is not an "Aşama değişenler" row; a right pick from choices says why it suggests Zor;
the Bugün header names the study day (day start hour), as İlerleme does; the week dots show
days a protection or vacation kept the streak; a first level test says "Seviyen: B1"; the
onboarding preselects the level's verb deck for a measured B1+ level.

## Consequences

- Fewer words in "Zorlandıklarım" practice and on the Bugün shortcut, all of them words the
  learner once knew. A word that is only ever rated Zor, never forgotten, is no longer listed.
- The progress denominator can now shrink when a pending card leaves the queue (deleted
  elsewhere, swapped out); it never counts a card the learner will not see.
