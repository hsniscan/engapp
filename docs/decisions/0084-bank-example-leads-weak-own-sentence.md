# 0084 — The word bank's example leads when the user's own sentence is weak

## Context

The 2026-11-26 review (item #5): 503 of 1,143 imported senses used the import's source sentence
as the card example with no Turkish translation; 162 were fragments ("ugly face", "difficult
problem") and some used another sense ("Root beer is my favorite kind of soda." for root =
kök). The card showed only that sentence, and a guest has no shared example sentences. The word
bank on the device (ADR 0038) has, for every sense, a checked example with its translation.

## Decision

- The user's own sentence leads only when it is a full sentence (four or more words, a capital
  first, . ! ? or … last) and the user has a Turkish translation for it
  (`domain/bankExample.ts`, `ownSentenceLeads`).
- Otherwise, when the sense matches a word bank sense, the bank's example leads: on the card
  (first in the rotation, front and back, translation on tap like other examples) and in the
  word detail ("Örnek"). A sense matches by its shared lexicon id, else by a common Turkish
  meaning part among the bank rows of its part of speech, else, for a one-sense note, when the
  bank has exactly one sense for the word. The bank sentence must contain the term.
- The user's sentence is not dropped: the back shows it under the bank example as "Senin
  örneğin", and the word detail keeps its "Senin örneğin" section. It leaves the card's
  rotation, so a fragment never stands alone on a card again.
- Read-only: nothing is written to the note or to the shared content; no schema change.

## Why

Deciding at display time fixes the 503 existing senses and any future import without a data
migration, and keeps the user's text where it was. The matching refuses to guess between
several bank senses, so a wrong-sense bank sentence is less likely than the import's own.
