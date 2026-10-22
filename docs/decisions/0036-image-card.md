# 0036 — Picture recall cards ("Görselden hatırlama")

## Context

v0.4 İP8, acceptance criterion 8: a new card type shows the approved picture of a sense and
the learner recalls the English word. It may open only for a sense whose recognition card has
become "öğrenildi" (FSRS Review) and that has an approved picture; it is graded by FSRS like
every card. The owner approved "on by default". Constraints: offline-first (pictures live in
the Dexie `images` cache, ADR 0031), several devices per account, review logs are never
changed, and copying cards to another account copies no history (ADR 0009). We also have to
show whether picture cards help.

## Decision

1. **A new card type, not a mode.** `cards.card_type = 'image'`, `sense_id` = the user's sense,
   ordinary FSRS fields, answers in `review_logs`. The front shows the picture and the part of
   speech in Turkish ("isim"), prompt "Görseldeki kelimeyi bul"; the back reuses the production
   back (word, IPA, speak button, meaning beside the picture, the sentence, examples). No
   first-letter hint and no English gloss on the front: they would give the word away.
2. **Which picture.** The user's chosen picture (any status: they picked it), else the first
   approved picture they did not reject (`domain/imageCards.ts` `imageCardPicture`). A picture
   still in review never makes a card by itself (the plan says "onaylı"); a hidden one never
   does. The card back keeps İP3's `pickImage`.
3. **When it exists.** `planImageCards` (pure, property-tested) decides per sense: wanted when
   the setting is on, sense and note are live, the note is not recognition-only (root/affix,
   contrast), the sense is in the shared lexicon and a picture as in 2 is cached. Not wanted
   when the picture is hidden, every cached picture is rejected, only pictures in review are
   cached, the server listed none, or the setting is off. **Unknown** (nothing cached and the
   server not asked) changes nothing: a new device that has not fetched pictures must not
   tombstone cards another device made.
4. **Locked like production.** A picture card is created locked and unlocks through the
   existing `deriveUnlocked` rule (recognition card first reaches Review; once studied it
   stays open). It is a New card, so it counts against the daily new-card limit and the
   one-card-per-note-per-day rule spaces it from its siblings.
5. **Removing is a tombstone; bringing back revives the same row.** Hide, "Hayır" for the last
   usable picture, server removal or the setting off tombstone the live picture card(s) of the
   sense (a leech reset copy included). When the picture comes back the latest row is revived
   with its FSRS state; its logs were never touched. Suspend was not used: it is the user's own
   action (and the leech reset's) and must stay theirs.
6. **Derived id.** The card id is a UUID v8 over ("cards", "image", sense id), like the user's
   picture choice rows. Two devices that both see a new picture write the same row (HLC merge)
   instead of two cards. Hashing runs before the write transaction; the plan is re-read inside
   it.
7. **When it runs.** `data/imageCards.ts` `reconcileImageCards` after every picture fetch run
   (also the "fresh", offline and signed-out outcomes, so a setting or senses pulled by sync
   apply; after a real fetch with `serverHasNone` for senses the server listed nothing for),
   after choosing, hiding or answering "Bu görsel anlamı anlatıyor mu?" (for that sense), and
   when the setting changes. Dexie v22 only re-pulls `cards` and `settings` (an older version
   dropped picture cards and the column); the cards of already cached pictures are made by the
   first run after start-up, since an upgrade transaction cannot use the sync writer.
8. **Offline.** The study queue leaves out picture cards whose picture is not on the device
   (`imageCardsWithoutPicture`); the session also skips one whose picture the sanitizer refuses
   at render time, for the rest of the session. A practice round that meets one shows it like a
   production card (the meaning), never an empty frame.
9. **Setting.** `settings.image_cards boolean null` (migration
   `20261026000800_image_cards.sql`); absent or null = on, false = off. It is a late column with
   "unset" = missing/null only (`syncMerge.ts`), so a stored false wins over an older client's
   push. UI: Ayarlar → Görünüm, "Görselden hatırlama kartları", next to İP3's picture setting.
10. **Measurement (criterion 8).** `domain/retention.ts` `pictureRecallComparison`: with the
    existing counting rule (first answer of a day to a card in Review, MIN_ANSWERS = 20 per
    side), production-card answers of senses that have a live picture card vs. those that do
    not, over the Gelişim window (90 days), plus the picture cards' own rate. Production cards
    are the fair yardstick: both groups have one and it asks the same thing. Shown on Gelişim
    in one sentence only when picture cards exist, with a note that picture senses are mostly
    concrete words (an observation, not an experiment).
11. **Accounts.** Copying cards to another account re-adds notes (ADR 0009); picture cards are
    not copied but made again by the next run, New and locked, with no logs. Picture choices
    and verdicts stay behind as before (ADR 0031).

## Consequences

- Server change: the `cards.card_type` check gains `'image'`, `settings.image_cards` is added.
  Older app versions skip pulled picture cards as invalid rows (logged), which is harmless.
- The weekly report groups by card type too; `'image'` is not in `REPORT_GROUP_KEYS`, so a
  weakest/strongest picture-card group is reported unnamed (no edge-function change needed).
  Adding a Turkish name later needs a deploy of the report function.
- `getStudyQueue` reads the picture tables when picture cards are among the candidates
  (a Map lookup per card, the choice rows once).
- Home and load counts (`features/home/queries.ts`, `data/load.ts`) still count a picture card
  whose picture is missing offline; the session then shows one card fewer than announced.

## Acceptance criteria and tests

| Criterion | Test |
| --- | --- |
| Opens only for a recognised sense with an approved/chosen picture | `domain/imageCards.test.ts` (rule, properties), `data/imageCards.test.ts` |
| FSRS like any card, logs never changed | `data/imageCards.test.ts` (answer, hide/show keeps logs) |
| Created on picture fetch, removed on hide/reject/server removal/setting off | `data/imageCards.test.ts`, `features/images/fetcher.test.ts` |
| Default on, can be turned off, syncs | `features/images/ImageCard.test.tsx`, `supabase/tests/database/23_image_cards.test.sql`, e2e |
| Offline: missing picture → skipped | `data/imageCards.test.ts`, `ImageCard.test.tsx` (`canShow`) |
| No history across accounts | `features/auth/link.test.ts` |
| With/without comparison | `domain/pictureRecall.test.ts`, `ImageCard.test.tsx` |
| Dexie v22 | `data/db.test.ts` |
| End to end at 360 px, both themes, axe | `tests/e2e/image-card.spec.ts` |
