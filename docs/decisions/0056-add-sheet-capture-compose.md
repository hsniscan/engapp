# 0056 — Add sheet, one capture result, "Kelimelerimle metin oluştur"

## Context

v0.5.1 "toparlama" (plan/v0.5.1-toparlama-raporu.md, sections 2–4, "Ekle"). The (+) sheet had
grown into a list of eleven rows with two kinds of "word" entry and no clear text group. Every
way of bringing a text in (paste, PDF, article, photo, subtitle, share, selection) ended
differently: some opened the reader, some started an AI extraction without saving the text
(the words then lost the text they came from), shared text started an extraction on its own,
and guests met a sign-in wall before they could even read. The quick sheet (`/quick`) showed
"unknown word" for a word already on the user's own cards, and the quick add saved the typed
word without looking it up. The owner asked for a way to practise chosen words in a text
("Kelimelerimle metin oluştur") with a limit of five a day.

## Decision

1. **Add sheet in four groups** (`features/add/AddSheet.tsx`): *Kelime ekle* (type a word: it is
   looked up on the device, then by yapay zekâ when signed in; saved in the sheet; "Elle
   düzenle" opens `/add?term=`), *Metin ekle* (paste, PDF, article, photo, subtitle),
   *Kelimelerimle metin* (`/metin-olustur`) and *İçe aktar* (Anki, CSV / word list, backup).
   `openAddSheet(section?)` opens it at a group; a click event argument is ignored, so
   `onClick={openAddSheet}` still works. Ready-made decks and the word bank left the sheet (they
   live in Keşfet / Kelimelerim).
2. **One capture result** (`features/add/CaptureActions.tsx`, `capture.ts`): every text capture
   ends on the same two choices: "Okuyucuda aç" first (anyone, offline) and "Bu metindeki
   kelimeleri çıkar" (signed in; guests see one honest line and a sign-in button). **Both save
   the text first.** The extraction job keeps it in `import_jobs.text_id` (local only, not
   synced: no Dexie version), and the job card and the preview show "Metni oku". A capture is
   saved once per session per body; a deleted text is saved again.
3. **Shared text never starts an extraction by itself**: `/share` shows the text and the two
   choices. A shared link still fetches the article for a signed-in user; a guest reads
   "Makale getirmek için giriş yap" with the paste path next to it.
4. **`/add`** is "Kelime ekle" (the hand-written form) without a tab, "Metin ekle" with
   `?tab=paste|pdf`. The two `<aside>`s (word bank, Anki) are gone, which also fixes the
   duplicate-landmark a11y finding. The form follows `?term=` when the address changes.
5. **Quick sheet** shows the meanings on the user's own cards (`QuickPreview.mine`) and asks the
   AI only when nothing is known at all (`useTermLookup`, shared with the sheet).
6. **"Kelimelerimle metin oluştur"** (`/metin-olustur`, `features/compose/`): pick 3–8 of one's
   own words from three lists (due today, hard, recently added) or a search, choose form
   (story, dialogue, news, email), length (short, medium), difficulty and a topic; the text
   opens in the reader with its words marked, glossed and three questions. It reuses ai-story
   with `source: 'picked'` (docs/ai-story.md, prompt `picked-v1`), a separate daily counter
   (`story_usage.picked`, migration `20261102000300_picked_texts.sql`,
   `PICKED_STORY_DAILY_LIMIT`, default 5) and a lower minimum of three targets. On the device a
   picked text is a `story` text with `story.source = 'picked'` and never counts as the day's
   story. Guests can pick; making the text needs sign-in.
7. **CSV / word list import** (`/import/csv`): a CSV, TSV or typed list (`term - meaning`,
   `term;meaning;example`) becomes the user's own notes through the normal add path. No AI.

## Deviations from the report

- The daily request is sent without `source`, `genre` and `length` (`storyWireBody`) so the
  app keeps working against an ai-story that is not deployed yet; a picked request against an
  old server fails with `invalid_input` and the screen shows the error.
- The native quick panel's "extract" still goes through `/share` (now the choice screen)
  instead of starting a job directly, because the native host has no session.
- The nav wiring (Ekle tab section, Desteler ⬇ → `openAddSheet('import')`, Keşfet link to
  `/metin-olustur`) is left to the navigation package; the route handles carry
  `navSection: 'add'` for it.

## Consequences

- Deploy order: migration, then the `ai-story` function, then the app.
- `OpenInReaderButton`, `ReaderPasteFallback` and `ReaderPasteBox` in
  `features/reader/OpenInReader.tsx` are no longer used by these flows.
- Strings added or touched say "yapay zekâ", not "AI".
