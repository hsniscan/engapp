# 0046 — "Engapp" in the text-selection menu and the quick sheet

## Context

v0.5 İP4 (plan "İP4 Seçili metin menüsü ve hızlı kart", appendix A.4, acceptance criterion 5):
a word selected in any Android app gets "Engapp" next to Kopyala / Paylaş. Tapping it shows a
small sheet at the bottom of the screen (meaning, audio, picture, "Karta ekle") without opening
the main app, in under 3 seconds from Chrome. A long selection goes to the reader or to word
extraction. Own code only; extend the app-local `ShareTargetPlugin` (decision 0034) rather than
adding a third-party plugin.

## Decision

1. **Android: a second, translucent activity with its own bridge.** `QuickCaptureActivity`
   (a `BridgeActivity`) has the `ACTION_PROCESS_TEXT` `text/plain` filter, label "Engapp", a
   translucent theme without splash or window animation, `excludeFromRecents`, its own
   `taskAffinity` and `singleTop`. It starts its WebView on `/quick` (a copy of the bundled
   `capacitor.config.json` with `server.appStartPath`, loaded through the public
   `CapConfig.loadFromFile`, `QuickConfig.java`). Same scheme and host as the main app, so the
   same IndexedDB: the card is saved by the sheet itself and the main app is not opened. The
   window and the WebView are transparent; `BridgeActivity`'s forced opaque theme is kept out by
   overriding `setTheme`.
2. **Delivery through `ShareTargetPlugin`.** The plugin now also turns `ACTION_PROCESS_TEXT`
   into a retained `processTextReceived` event (cold start: held until the page listens;
   `onNewIntent`: delivered at once), de-duplicated by intent id on both sides. New methods:
   `host()` (is this the quick activity), `finishQuick()`, `openInApp({ path | shareText })`.
   `EXTRA_PROCESS_TEXT_READONLY` is read and passed on as information only: Engapp **never**
   returns text (`setResult(RESULT_CANCELED)` always), whether the field is read-only or not.
3. **One route for Android and the web: `/quick?text=…`,** outside the app shell (no
   navigation), lazy chunk. Routing is pure (`src/features/quick/route.ts`) and reuses the share
   target's `routeShared`/`cleanTerm`, so a selected word and the same word shared become the same
   term: ≤ 3 words → term; a link → handed to `/share`; longer → text.
4. **The term sheet looks on the device first:** Kelime Bankası (also under the word's likely base
   forms, `lemmaForms`: "postponed" → "postpone"), then the lexicon cache; the cached picture of
   the first sense that has one; audio through the existing pronunciation path. Only when the
   device knows nothing, the user is online and signed in, the existing ai-enrich lookup runs
   (once per term per session; it answers from the shared lexicon before any model call, rule 6).
   Offline or as a guest the sheet says so and offers "Anlamını kendim yazayım" (`/add?term=`).
5. **"Karta ekle" uses the existing add paths:** bank words through `addFromWordBank` (the bank's
   own example sentence comes with it, as on the bank screen), dictionary senses through
   `addNoteWithSenses` with **no source sentence** (a selected word has none). After saving the
   sheet shows a short confirmation (1.2 s) and closes: `finishQuick()` on Android (back to the
   calling app), history back on the web.
6. **Long selections:** "Okuyucuda aç" saves the text with `saveText({ kind: 'paste' })` and opens
   `readerPath(id)`; "Kelimeleri çıkar" hands the text to the existing share flow. Inside the
   quick activity both open the main app (`openInApp`: an `OPEN_PATH` intent with an allow-listed
   address — `/oku/:id` or `/add?term=` only, checked in Java and in the web app — or an ordinary
   `ACTION_SEND` share, text capped at 100 000 characters for the binder) and close the sheet.
7. **No flash of the canvas:** `index.html`'s pre-paint script marks `<html data-quick-host>`
   when the native app starts on `/quick`; `index.css` then paints html/body transparent.
8. No Dexie version, no migration, no new dependency.

## Why

- A second bridge is the only way to save a card "without opening the main app" (criterion 5):
  routing the main activity to a translucent `/quick` would bring the whole app's task forward
  and leave it in Recents. The cost is a second WebView start; the route chunk is small and
  everything it shows comes from IndexedDB, so the 3-second target is met by a margin on a
  mid-range phone (to be measured on a real device, İP11).
- Reusing the share target's cleaning and routing keeps one definition of "a word" for shares
  and selections; the e2e tests drive the same route in the web build.
- The allow-list for `OPEN_PATH` matters because `MainActivity` is exported: another app could
  send that action, but it can only open a reader text by id or the add form.

## Deviations from the plan

- The plan's table names Dexie 29 for İP4; nothing new is stored (texts use the v28 contract),
  so no version is used.
- The PWA share target keeps sending ≤ 3 words to `/add?term=` (decision 0034 unchanged); the
  quick sheet is available to it at `/quick?text=` whenever we choose to switch.

## Deferred / known limits

- No Gradle build in this environment (no Android SDK; dl.google.com is blocked): the pure-Java
  helpers (`QuickIntents`, `SharePayload`) were compiled and their JUnit tests run with `javac`;
  the activity, plugin and manifest changes need the CI Android build and a check on a phone
  (cold start from Chrome, warm start, dark mode, back button, Recents).
- The sheet does not sync by itself; the card is in the outbox and goes up the next time the
  main app runs (as for any offline add).
- A selection inside a sentence does not carry that sentence (Android passes only the selected
  text); selecting the whole sentence gives the extraction flow, which keeps it as the source.
