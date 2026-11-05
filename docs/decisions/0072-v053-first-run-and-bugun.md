# 0072 — v0.5.3 "Öğren ve doldur": first run, offline word bank, reminder offer and a calmer Bugün

## Context

The v0.5.2 usage review (`plan/oneriler-2026-11/teknik-notlar/kullanim.md`, items 1–4, 6–9)
found that a new guest's first five minutes were rough:

- Adding the 500-word starter deck took ~32 s (500 transactions of ~65 ms). The first word
  made `needsOnboarding()` false, so the deck step unmounted and the guest stared at the empty
  home with no progress. Keşfet's level decks (up to 2,765 words) took over a minute and could
  not resume if the app was closed.
- The offline word bank was only fetched when Kelime Bankası / Keşfet opened, so the reader and
  the add sheet told guests to sign in for words the app ships; the add sheet did not even pick
  the rows up when they arrived.
- A 15-second "Tarayıcı verileri korumayı kabul etmedi" toast covered "Cevabı göster" on the
  very first card.
- After the first round only learning steps waited ("10 kart 11 dk sonra") and Bugün offered
  nothing to do; the daily reminder was never offered.
- Bugün stacked an amber backup banner above the hero every day, three prompt cards below it,
  and they arrived late (layout jump). Kelimelerim said "11 kart bugün" where Bugün said 51.

## Decision

1. **Bulk add (A1).** `addNotesBulk()` runs the exact `addNoteWithSenses` rules for many inputs
   in one Dexie transaction per 200 (the body became `addNoteInTx(w, …)`; the writer got
   `setNow()` so each word keeps its own `now + i` stamp and creation order). 450 words take well
   under a second in tests. `addSuggestedDeck` and `addFromWordBank` use it.
   A **job row in `meta`** (`deck_add_job`: name + bank ids) is written before and deleted after;
   `resumeDeckAdd()` re-runs the same add (idempotent: present words are skipped) at start-up.
   `features/decks/deckAddRunner.ts` keeps one add at a time with shared progress, so the
   onboarding, a deck page and the start-up resume never double up. No schema change (Dexie 40
   and the migration range stay unused).
2. **Onboarding stays mounted (A1).** A device flag `onboarding.adding` makes
   `needsOnboarding()` true while the deck goes in, and `HomeScreen` renders the onboarding even
   though words exist. The deck step shows "Ekleniyor… n / N" with a bar; after a restart the
   flag brings the step back and the add resumes there.
3. **Word bank in the background (A2).** `startWordBankPrefetch()` runs once the app is idle:
   online only, not on `saveData`, `cellular` or 2G (Network Information API; absent = allowed),
   and again on every `online` event until the bank is complete. The fetch already resumes after
   the device's cursor. A miss in the add sheet or the reader still fetches on demand whatever
   the connection. `fetcher.ts` bumps a "bank changed" epoch after a run that stored rows; the
   add sheet's live query and the reader's lookup depend on it, so they run again by themselves.
   While that download runs the add sheet says "aranıyor", never "giriş yap".
4. **Reminder offer (A4).** A note in Bugün's slot after the first finished session
   (`review_logs` non-empty and nothing ready now): "Yarın sana hatırlatayım mı?" with an hour
   (default: the hour just studied, clamped to 09–21). Android: saves `notify.mode = fixed` and
   the hour, then `enableReminder()` (permission asked on that tap). Web: Web Push for a
   signed-in user where supported; a web guest gets "Hesap aç". Any answer is stored on the
   device (`reminderOffer`) and the offer never returns; the switch stays in Ayarlar → Bildirim.
   It lives on Bugün, not in the session summary, because the review feature belongs to the
   study work package.
5. **Storage warning (A5).** `watchFirstCard()` no longer toasts. It asks `persist()` on the
   first note and again at most weekly while the browser says no (Chromium grants it later for
   an engaged or installed app). Profil shows one calm `StorageNotice` for a web guest whose
   data is not persisted and for every guest of the Android app, with "Yedek al" and "Hesap aç";
   closing it hides it for 30 days. Ayarlar → Veri keeps the full row.
6. **"Beklerken" (A6).** When `ready === 0 && later > 0`, a short list under the hero: "+5 yeni
   kelime" (`addExtraNew`, only when new cards are not paused), "Kısa bir metin oku" (Keşfet →
   Okuma) and, with reminders off, "Hazır olunca haber ver" (one local notification, id 1090, at
   the next learning step; Android) or the reminder setting (web).
7. **Bugün declutter (A7).** One note slot holds every prompt: the rule note, streak, load,
   reminder offer, backup reminder, FSRS offer, interests, level change, then the daily-goal
   prompt; only the first that renders shows. The backup reminder left `RootLayout` (no banner
   above the hero) and shows on one day, then rests for a week. A skeleton holds the place below
   the hero until the slot and the reading card are ready. Kelimelerim's "N kart bugün" now
   reads `useTodayStudy().left`, the number on Bugün's ring.
   Copy: the welcome lists the three counted steps and says the first session follows; the level
   test opened from the onboarding (`?from=onboarding`) starts at once, counts "5 / 70" and ends
   with "Devam et".

## Consequences

- One transaction per 200 words holds the database for a moment per chunk; other writes wait
  that long (tens of ms). A chunk is all or nothing, so an interrupted add leaves whole words.
- A guest on mobile data only gets the bank when a lookup misses (then it downloads at once).
- The reminder offer is device-local: a second device asks once more.
- Nothing to deploy: no Supabase migration, function or workflow.
