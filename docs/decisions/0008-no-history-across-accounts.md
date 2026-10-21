# 0008 — Study history never moves between accounts; a history reset

## Context

The plan asks three questions when an account already has data: birleştir (default), yerel
veriyi at, hesaptakini at. The linking flow asked the same when this device's data belonged to
ANOTHER Google account, and "birleştir" re-stamped every row, review logs included. Hasan signed
in with account A, then with account B, chose "birleştir", and B became a clone of A: same review
history, streak and stats. He only wanted the cards.

## Decision

1. **Guest data** (never linked to an account) keeps the plan's three choices. It is the same
   person's history, so merging it with history is right.
2. **Another account's data** offers two choices:
   - "Kartları kopyala (çalışma geçmişi olmadan)", the default (`copyCardsFromOtherAccount`).
     In one Dexie transaction: read that account's live notes, senses and the sources they
     reference; clear the local tables except device caches (chunk cache, lexicon cache, error
     log); link the device to the new account and apply its full snapshot; then add every note
     again through `addNoteWithSenses`. Copies get new ids, the new user_id and fresh HLCs,
     and every card is New with the normal unlock rule. Review logs, settings, outbox rows,
     import jobs/candidates and `daily_activity` of the other account are not copied; they
     stay on the server under that account.
   - "Bu hesabın verisiyle başla" (`discardLocalData`).

   "Birleştir" and "hesaptakini at" are not offered and `resolveLink` refuses them (checked
   against `meta.user_id`, not the dialog). `claimLocalData` refuses another account's rows.
   Leftover settings of another account (no notes) are dropped, not adopted.
3. **Duplicate terms** in a copy go through the normal add path: a term the account already
   has gets only the senses it is missing (matched by lexicon sense or meaning); exact
   duplicates are skipped and tags are merged. `possible_duplicate` exists for two notes that
   each carry history, where neither can be dropped. A copy has no history, so folding it into
   the existing note loses nothing and keeps the library free of duplicates. A term the account
   had deleted is reactivated, as when the user adds it by hand.
4. **"Çalışma geçmişini sıfırla"** (Settings → Veri, `resetStudyHistory`). Review logs are
   immutable, so every answer that still counts gets an undo row (`undo_of`), the same row
   `undoAnswer` writes. Cards are recomputed from the logs (New, production/cloze re-locked)
   and `daily_activity` is rebuilt, so stats, streak and the heatmap are empty. The server
   already accepts undo rows as ordinary log inserts, so no migration is needed; other devices
   recompute their cards when they pull the rows. The work runs in transactions of 200 notes
   and can be run again after an interruption (undone answers no longer count).

## Why

Study history describes one person's memory; copying it to another account makes its stats
false, and the other account's server data must never be destroyed because of local rows that
belong to someone else. Writing undo rows keeps the append-only log model and needs nothing new
on the server.

Cost: a reset of 2000 cards with 6000 answers adds about 6000 log rows and up to 2000 card rows
to the outbox (60+ push batches of 100). `takeOutboxItems` now reads the outbox page by page
and stops at the batch limit instead of reading all of it for every batch.
