# 0063 — v0.5.2: Kelimelerim, Ekle, Okuma and Profil behaviour fixes

## Context

The November 2026 review (`plan/gelistirme-raporu-2026-11/teknik-notlar/`: kelimelerim, ekle-yakala,
kesfet-okuma, profil-ilerleme) found bugs in data, logic and copy in four areas. The visuals are
redesigned in wave 2, so this change fixes behaviour and keeps UI changes to the wiring a fix
needs. No Dexie schema change was needed (version 39 stays free). One Supabase migration is
added for refunds.

## Decision

### Kelimelerim

1. **Bulk actions in one transaction** (`src/data/wordActions.ts`). Delete, suspend and
   unsuspend for many words run in a single `writeTx` with a progress callback. They only touch
   the selected rows the current filter shows. The confirm dialog freezes its count and says
   when selected rows are hidden. Every delete has "Geri al": rows deleted together share one
   `deleted_at`, and `restoreNotes` brings back only those rows. Deck delete has an undo too.
2. **"Biliyorum" for owned words.** It adds a `known_terms` row and soft-deletes the note. The
   review history stays, and an undo removes only the known rows it added. **"İlerlemeyi
   sıfırla"** soft-deletes the word's cards and makes fresh New copies. Review logs are never
   changed, and an unanswered reset can be undone.
3. **Five user-facing stages everywhere.** The library filter and smart decks use `WordStage`
   (new / learning / consolidating / learned / mastered). Decks store them under a new
   `filter.stages` key, plus the overlays `struggling` and `suspended`. `normalizeDeckFilter`
   maps the legacy `states`. An older client sees the unknown key and reports the deck as
   "newer" (the version-safe parser), so it does not misread it.
4. **New-only decks can be studied** ("Başla"). A deck name is at most 60 characters, matching
   the tag limit. The tag filter ignores case. Deck creation is guarded against a double
   create. Decks can be moved up and down and exported as CSV. A hand-picked deck's rename also
   renames its tag on the words.
5. **One shared clock** (`useNow`): one interval for the app instead of one per row. The list
   keeps its loaded rows and scroll position when the detail sheet opens: paging is keyed on
   the filter, not on `?note=`. The detail sheet asks before it drops unsaved edits.
6. **Word bank download.** A run already in flight is joined. Progress is reported after each
   page. A partial bank shows a banner with "Yeniden dene".
7. **Idioms are levelled above their words.** A multi-word entry that is not a pattern gets
   max(hardest word + 1, B1) (`supabase/functions/_shared/level.ts`).

### Ekle

8. **Daily limit parks the job.** An extraction job that hits the daily AI limit is parked
   until the next UTC midnight + 5 min instead of failing. It can also be previewed with the
   chunks already done. Every import job, of any kind, is listed at `/import` and in a toast
   when it finishes. Finished and failed jobs are never reused.
9. **Refunds.** `article_refund(uuid)` and `ai_refund(uuid)` (migration
   `20261103002000_usage_refunds.sql`, service_role only) give back a use when no article came
   out or the model failed. The server takes the user from the session as before.
10. Preview reconciliation, guest sign-in prompts, the Turkish-aware word-list header check,
    `MIN_CAPTURE_WORDS`, and counting picked texts by UTC day.

### Okuma

11. **Text glosses reach the word sheet.** The lookup order is the user's card → the text's own
    gloss (library `graded_bodies.glosses`, a story's glossary) → word bank → lexicon. The
    gloss works offline and for guests.
12. **Listening.** "Durdur" and leaving the reader also stop the server audio and, in the
    Android app, the native TextToSpeech (`stopNative`). There is a listening speed setting
    (0.75 / 1 / 1.25, applied to clips, server audio and the device voice), "Buradan dinle" in
    the word sheet, and a text size setting. Speed and size are per-device conveniences in
    localStorage (`engapp.reader.prefs`). An empty or blocked storage means the defaults.
13. **Turkish percent suffix** (`src/domain/trSuffix.ts`). The suffix is picked from the last
    word of the number as it is read aloud: "%91'ini", "%96'sını", "%100'ünü". It is used in the
    coverage line and the end-of-text summary ("2'sini ekledin" / "henüz eklemedin").
14. **Encounters count texts.** Each word counts once per text on a device: a meta key
    `reader_counted:<textId>` holds the counted note ids. Opening or reloading the same text
    counts nothing again. The line hides the part that is zero.
15. **No empty offline rows.** `openGradedText` fetches the body first and creates the row only
    when the fetch works. Find-or-create is one transaction. Offline, an unopened text shows
    "not on this device yet · Tekrar dene", and no row is made.
16. **Exact resume.** After resuming, the position stays pinned to the resumed sentence until
    the user scrolls, so it no longer creeps backwards on each open.
17. **Labels and numbers.** A picked text is "Kelimelerimle metin", and an earlier daily story
    is "Hikâye · 20 Eki". Library profile keys go through the reader's lemmatizer, so the list
    and the reader give the same %. When nothing is in the band, Keşfet offers the closest
    harder texts with an honest line (`stretchTexts`). The speaker plays the tapped form.
    "Biliyorum, işaretleme" in the word sheet marks a word as known (it works for names too),
    with an undo.

### Profil

18. **Restore and accounts.** A new backup records `account_id` in its header (not covered by
    the checksum; older files fall back to the rows' `user_id`). Every restored row is stamped
    with this device's account, or null for a guest, never the file's. A backup from another
    account throws `foreign_backup`. The dialog then offers only "Yalnızca kelimeleri al"
    (`importForeignBackupCards`, which reuses the "Kartları kopyala" path). Only the words move,
    as new cards; history, settings, texts and reports stay behind. A guest's restored rows are
    null, so `adoptGuestData` pushes them at the first sign-in.
19. **`sameRow` compares nested fields.** It uses `canonicalJson`. The old `JSON.stringify` key
    allow-list also filtered nested objects, so a restore kept stale decks, texts and settings.
20. **Onboarding.** The welcome has "Zaten hesabın var mı? Giriş yap". The onboarding is not
    finished there, and it ends once the account's words arrive. The deck step offline has
    "Şimdilik atla". Verbs read "Orta seviye fiiller (B1)" while the level is unmeasured.
21. **Smaller fixes.** An unreliable test leaves the level unmeasured, with its own hint. A
    holiday cannot start in the past (UI and `setVacation`), though the running one keeps its
    start. The report link counts report drafts. The Profil recall waits for the same 20 answers
    as İlerleme. A guest's report says the comment needs sign-in. The leech list is "Sık
    unuttukların", so "Zorlandıkların" means one thing. "Hesaptakini at" needs a confirm. The
    sign-out dialog can also wipe this device. The level-test length is "5 dakika, en çok 70
    soru" everywhere. The level card's screen-reader heading is no longer "Seviye, Seviye".

## Why

- Restore was the one path where review history could cross accounts. Stamping rows and
  refusing foreign history keeps the multi-account rule without a schema change.
- Counting encounters per text with a device-local meta key needs no new synced column. Rows
  are still LWW-safe per device and day.
- Reader speed and size are per-device comfort settings. Putting them in synced settings would
  need a settings column on the server for no cross-device value.

## Consequences

- An older client restoring a new backup ignores `account_id` (zod strips it).
- Decks using `filter.stages` show as "newer" on clients before v0.5.2 until they update.
- Encounter counts made before v0.5.2 (per opening) stay as they are. New counts are per text.
- Hasan must apply migration `20261103002000_usage_refunds.sql` and deploy the `fetch-article`
  and `ai-extract` edge functions (they call the refund RPCs).
