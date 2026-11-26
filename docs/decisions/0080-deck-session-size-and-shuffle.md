# 0080 — A deck session has a chosen size and shuffled new words

## Context

The owner (2026-11-26): "belirli bir desteyi çalışmak istediğimde o destede kaç kelime çalışmak
istediğimi seçebilmeliyim. Ayrıca her çalıştığımda hep aynı kelimeler gelmemelidir." A deck's
"Çalış" brought its due words plus whatever was left of the day's new-card budget, and new words
in the smart order, so the same first words came every time and the count could not be chosen.

## Decision

- The deck page asks "Bu çalışmada kaç yeni kelime?" (5 / 10 / 20, remembered on the device) when
  the deck has new words. The session URL carries `&new=N&seed=S`.
- With `deckNew`, the deck session brings N new words of the deck (minus those already answered
  in the session), outside the day's new-card budget; the due words of the deck come as before.
- With `deckSeed`, the deck's new cards are taken in a random order fixed by the seed
  (`shuffleKey`, FNV-1a), instead of the smart order: each "Çalış" picks other words, while the
  order holds within the session as the queue is rebuilt after every answer.

## Why

The user picks the deck and the amount on purpose; the daily budget protects the default daily
study, not an explicit choice. A seed per session keeps rebuilds stable and tests deterministic.
