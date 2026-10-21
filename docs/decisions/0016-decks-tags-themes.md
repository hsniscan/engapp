# 0016 — Tags, smart decks and AI theme grouping (İP8, part 1)

## Context

Hasan's word list grows past a few hundred words and the Cards screen is one long list. The
v0.2 plan (İP8) asks for bulk tagging, saved "smart decks" that can feed a practice round,
and an AI step that groups the words into themes. The vocabulary-size counter and the Anki
import are later parts of İP8 and are not in this change. The plan is a reference, not a
contract; this record lists what was built and where it differs.

## Decision

1. **Tags stay on the note.** No new tag table: `notes.tags` already syncs, so bulk tagging
   is a batch of ordinary note updates (one transaction, one outbox row per changed note).
   Tags compare case-insensitively with Turkish rules (`İş` = `iş`) and a note keeps the
   first spelling. New tags are capped at 40 characters; a note that would pass the
   server's 50-tag limit is left unchanged and reported ("n kelimede yer kalmadı"), never
   rejected later by sync.
   - Cards screen: "Seç" → select words → "Etiket" opens a sheet with every tag as a
     tri-state checkbox (all / some / none of the selection) and a search-or-create field.
     It works with the thumb on a phone; the bulk bar keeps the suspend action icon-only
     there.
   - Word detail: the existing tag field now suggests known tags.
   - Added beyond the plan: rename and delete a tag everywhere (Decks page → "Etiketler").
     A rename merges into an existing tag and updates deck filters that use it; a delete
     leaves decks as they are (they then match fewer words).
2. **A smart deck is a saved filter, not a list.** `decks(id, name, filter jsonb, sort, …)`
   with the standard sync columns. No note ids are stored, so a deck never goes stale and
   two devices never fight over membership; it is evaluated on the device over live notes.
   - Filter version 1 (`domain/deckFilter.ts`): `states`, `tags` + `tagMode`,
     `addedWithinDays`, and the reserved `levels` (İP2) and `topics` (İP7). Different keys
     AND, values of one key OR.
   - **Status names and meaning differ from the plan.** The plan's "review" is stored as
     `learned` (a word-level status, not FSRS's card state; Relearning counts as
     `learning`) but labelled "Tekrarda", the word the card badges already use;
     "struggling" ("Zorlandıklarım") is not a card state but an overlay that uses exactly
     the practice "hard" rule, so the deck and the "Zorlandıklarım" practice round agree;
     `suspended` means every live card of the word is suspended, and
     such a word has no other status (it would otherwise appear in "Yeni" and never be
     studied).
   - **Reserved keys use resolvers.** `levels` / `topics` are evaluated only when
     `deckContext()` (`src/data/decks.ts`) supplies `levelOf` / `topicsOf`. Until İP2/İP7
     are wired in, such a deck is treated like one from a newer version (no count, an "update
     the app" note) instead of showing a wrong count.
   - **Forward compatibility.** A higher `v` or any unknown key means "made by a newer app":
     the deck is listed but not evaluated, the editor keeps its JSON untouched (only the name
     can change), and it is never re-normalized away.
   - The editor shows a live count. Deck chips sit above the Cards list (`?deck=` in the
     URL), with "Pratik" and "Düzenle" links for the active deck. Decks can be reordered
     with "Yukarı/Aşağı" in a menu (no drag and drop on phones).
   - **Practice.** `deck` is a new practice source (`/practice?source=deck&deck=<id>`, also
     on "Biraz daha çalış"); `practice_logs.mode = 'deck'`. Only decks with practicable
     words are offered.
3. **Server: one migration, no RPC change.** `20261022000400_decks.sql` creates the table
   (name ≤ 200, filter an object ≤ 8 KB, standard RLS without DELETE, stamp trigger) and
   adds one row to `public.sync_tables`. The registry from İP1 does the rest. pgTAP:
   `supabase/tests/database/11_decks.test.sql` (17 tests); the registry assertion in
   `05_practice_logs.test.sql` became a subset check so later tables do not break it.
4. **Two client sync mechanisms for tables added after v3** (not in the plan; see
   `docs/sync-strategy.md`):
   - Deck rows wait in the outbox, without spending attempts, until the server's registry
     lists `decks` (read once per run while rows wait, then remembered). Deploy order does
     not matter.
   - A device that ran an older v0.2 build already pulled deck rows with `sync_pull_v3`,
     dropped them and moved its cursor. The Dexie upgrade that adds `decks` records a
     one-time re-pull of that table from 0 up to the cursor. Without it, decks made on a
     newer device would never reach that one.
5. **Dexie version 8**, not the plan's number, so the parallel packages (İP2 v4, İP5 v5,
   İP6 v6, İP7 v7) can be merged in any order. It adds `decks` and the local
   `theme_previews`.
6. **Backups: format 4.** Backups include `decks`. Files of format 1–3 still restore; a
   file without `decks` leaves the device's decks alone (an overwrite restore does not
   delete them).
7. **Accounts.** Decks are filters, not study history, so "Bu cihazdaki kartları kopyala"
   copies another account's live decks under new ids (skipping names that already exist).
   Nothing else about the account rules changes (ADR 0009).
8. **AI themes (`ai-themes`, prompt `themes-v1`).**
   - **Privacy by refs.** The client sends only `{ref, lemma, gloss_en}`: a short ref
     (`w1`…`w200`), the term and the English gloss of its first sense. No note ids, Turkish
     meanings, sentences, sources or tags. The device maps refs back to notes.
   - 200 words per call, one call = one unit of the daily AI budget. A run sends at most
     1,000 words (5 calls), untagged words by default (switch: "Etiketli kelimeleri de
     dahil et"), newest first; fewer than 6 words is not offered. The screen shows how many
     calls a run uses before it starts, and can be cancelled between calls; a run cut short
     (daily limit, network) keeps the groups it already has.
   - **Personal and uncached.** The server validates (known refs, one group per word,
     cleaned Turkish names, ≥ 2 words, ≤ 12 groups) and returns. Nothing is cached or written
     to the shared lexicon: themes of one user's list are not lexicon facts.
   - **Preview stored locally.** The merged groups live in Dexie `theme_previews` (never
     synced) so the user can leave and come back ("Kaldığın yerden devam et") without paying
     again. They approve, rename, remove words from, or reject each group; "Kaydet" turns
     the kept groups into tags in one transaction. It is cleared on discard, after saving,
     and with the account's local data.
9. **Navigation.** The Decks page (`/decks`) is reached from the Cards screen (the "Desteler"
   link next to the chips); the bottom navigation is unchanged.

## Known gaps

- Rejected theme groups are not remembered; a new run may suggest them again.
- The bottom navigation does not highlight "Kartlar" on `/decks` and `/decks/themes`.
- `levels` / `topics` have no editor controls yet; they are kept when present and become
  evaluable after the İP2/İP7 wire-up (one place: `deckContext()`), after which the editor
  needs two more chip groups.
- A device that skipped practice rows before updating still misses them (ADR 0010); the
  re-pull mechanism here could fix that by adding `practice_logs` to a future upgrade.
