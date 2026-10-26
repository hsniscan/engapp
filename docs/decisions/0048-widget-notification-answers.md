# 0048 — Home-screen widget, answers from the reminder, Android 16

## Context

v0.5 İP6 (plan "İP6 Widget ve bildirimden cevap", appendix A.7, acceptance criterion 9: the
widget's due count is at most 30 minutes late and its word works offline) and the reduced İP7
(owner decision 25 Oct 2026: only compileSdk/targetSdk 36 and closed-test readiness; the public
Play release, in-app review and new store screenshots are deferred).

## Decision

### Widgets (Jetpack Glance)

1. **Two widgets, Jetpack Glance 1.1.1 (Apache-2.0)** in the app module, Kotlin 2.2.21 with
   the Compose compiler plugin (also Apache-2.0); kotlinx-coroutines-android (Apache-2.0) for the
   suspend update calls.
   - **2×1 "Tekrara başla"**: the "Kelime çalışma" due count (learning steps + reviews, the
     same number as the home screen's `word.due`), a short line ("tekrar bekliyor" / "N yeni
     kelime hazır" / "bugünlük tamam"); a tap opens `/study?mode=word`.
   - **4×2 "Günün kelimesi"**: the Turkish meaning first, "İngilizcesi için dokun"; the tap
     reveals the English term (serif, like the app); the next tap opens the app on that word
     (`/library?note=<id>`, the note detail sheet). Text only (no picture). A small "N tekrar"
     chip shows the due count.
   - Palette from `src/ui/tokens/tokens.css` as Glance day/night colour providers, so the
     widgets follow the system's dark mode (warm paper / warm charcoal, ink-blue accent).
2. **Data: one JSON value, written by the web app.** `widget_state` in `@capacitor/preferences`
   (8.0.1, MIT; SharedPreferences group `CapacitorStorage`):
   `{v, day, due, new_count, day_end, word: {tr, en, note_id} | null, next: {…same for tomorrow…}, updated_at}`.
   This extends the brief's `{due, word, day, updated_at}` with `next` and `day_end`: the
   widget re-reads the state every 30 minutes (`updatePeriodMillis`, the Android floor) and
   switches to `next` by itself after the day boundary, so a phone whose app stays closed
   overnight still shows the right day (criterion 9). After more than a day without the app the
   count shows "–" with "güncellemek için aç" instead of a wrong number. The widget never reads
   the database and needs no network.
3. **Word of the day** (`src/domain/widget.ts pickWordOfDay`, pure, tested): among words whose
   stage is Öğreniyor or Pekişiyor (ADR 0041) and that have a meaning, the one with the highest
   FNV-1a hash of `(day, note_id)` (rendezvous hashing). Deterministic per day, independent of
   order, and stable when other words join or leave. Today's word is kept for the rest of the
   day even if it moves to Öğrenildi (the previous state is passed in). Tomorrow's word is
   precomputed into `next`.
4. **One reveal state** (`engapp_widget` SharedPreferences, key `revealed` = `"<day>|<note_id>"`):
   a single string, so it resets by itself when the word changes.
5. **When the state is written** (`src/native/widget.ts`): after every answer, undo or card
   change (a Dexie liveQuery, debounced 2 s — so after every study session too), after each
   sync run, on app resume, and at the day rollover while the app is open; each write is
   followed by `WidgetBridge.refresh()` (Glance `updateAll`). A notification answer redraws the
   widgets at once, and the widget subtracts queued "Bildim" answers until the app applies them.

### Answers from the reminder notification

6. **The plain reminder stays on `@capacitor/local-notifications`; a reminder that asks a card
   is planned by an app-local plugin** (`ReminderAnswers`, Kotlin). Deviation from A.7 (which
   named local-notifications action types): that plugin's action buttons are activity
   PendingIntents, so every button opens the app and the notification cannot change in place.
   Our receiver gets broadcast PendingIntents instead, so "Cevabı gör" updates the same
   notification with the meaning and "Bildim" / "Bilemedim", and the answer never needs the app.
   Alarms are inexact (`setAndAllowWhileIdle`, no exact-alarm permission, like the plain
   reminder), stored in SharedPreferences and re-planned after a reboot or an app update
   (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`; anything older than 12 h is dropped, so a phone
   that was off for days does not show a stack of reminders). Same ids (1001…), same channel,
   same rule (`planReminders`, at most one a day): the JS port only routes each planned
   reminder to one of the two plugins.
7. **Which card** (`pickReminderCards`, pure): one recognition card in Review that is due by the
   reminder time, most overdue first, each card at most once across the planned chain. Learning
   steps are left to the study screen. All texts come from `tr.json` (`widget.notify.*`).
   Lock screen: `VISIBILITY_PRIVATE`.
8. **Queue and replay.** A button appends `{id, card_id, rating: Good|Again, at}` to a JSON
   array in SharedPreferences (`engapp_answers`, `commit()` before the receiver returns; at
   most 200). `id` is a UUID v7 made on the phone. On app start and every resume, JS replays
   the queue oldest first through `replayQueuedAnswer` (`src/data/actions.ts`), which shares
   one code path with `answerCard` (`writeAnswer`: log, `applyRating`, unlocks, day counts), with
   the button time as `reviewed_at`. The queue id becomes the review log id, so a replay after a
   crash finds the log and changes nothing (idempotent); then the items are acknowledged and
   removed. review_logs stay append-only. An answer older than the card's last review (given
   offline while another device answered) is inserted in its place and the card replayed from
   its logs, exactly like a sync that brings an older log; an answer from yesterday counts on
   yesterday. A deleted or suspended card is skipped; a time in the future is clamped to now.
   The log's `duration_ms` is 0 (unknown), so it does not distort the pace estimate.
9. **Setting:** Ayarlar → Bildirim → "Bildirimden cevap ver" (per phone, default on, stored with
   the reminder's device state). Off: plain reminders only.

### Android 16 (targetSdk 36) and closed-test readiness

10. `compileSdk` / `targetSdk` were already 36 (Capacitor 8). Checked against the plugins in
    `package.json`: every Capacitor 8 plugin (`@capacitor/android` 8.5.3, app 8.1.2,
    local-notifications 8.3.1, preferences 8.0.1, text-to-speech 8.0.2, Capawesome Google
    sign-in 0.1.4) builds with `compileSdk 36`, AGP 8.13, Java 21. Behaviour changes:
    - **Edge-to-edge** can no longer be opted out of: the app already draws edge-to-edge
      (`SystemBars insetsHandling: 'native'`, `viewport-fit=cover`, safe-area padding). Nothing to change.
    - **Predictive back**: `onBackPressed` is no longer called; Capacitor's App plugin uses an
      `OnBackPressedCallback`, which our `backButton` handler (ADR 0033) relies on. No change; the
      back gesture is on the checklist.
    - **Notification permission** (Android 13+) is asked when the reminder is turned on; the new
      receiver checks it before posting.
    - **Exact alarms**: not used (`SCHEDULE_EXACT_ALARM` stays removed); both reminder paths are inexact.
    - **Large screens**: orientation/resizability locks are ignored at sw ≥ 600 dp; the app sets none.
    - **16 KB pages**: the app ships no native libraries.
11. CI (`.github/workflows/android.yml`): JDK 21 and `setup-android` unchanged; Gradle fetches
    platform 36 and the Kotlin/Glance artifacts. The new Kotlin unit tests run in the existing
    `:app:testDebugUnitTest` step (`org.json:json`, public domain, test-only).

## Why

- Writing one JSON value from the web app keeps every rule in `src/domain` (tested, shared with
  the web) and the native code small: the widget is a view, the queue is a list.
- Replaying through the same answer path with the queue id as log id gives "replay equals a
  live answer" and idempotence by construction, without a second scheduler.
- Own receiver for the asking reminder: the only way to answer without opening the app.

## Deviations and notes

- Widget strings live in `android/app/src/main/res/values/strings.xml` (Turkish), not in
  `tr.json`: the widget draws while the app is closed and the picker label must be a resource.
  The notification texts do come from `tr.json`.
- Dexie: no version bump needed (no new table; 32 stays unused).
- Plan A.1 named branch `feat/widget` and Dexie 31; this package used `v05-widget` per the wave brief.

## Deferred

- Picture of the word on the widget (only text now); widget preview images for the picker.
- Measuring the answer time on the notification (`duration_ms` 0 for now).
- In-app review, public Play release, store screenshots (İP7, owner decision).
- Gradle could not be run in the agent environment (Google Maven unreachable): the pure Kotlin
  parts (queue, reminder payload, widget model) were compiled and their 17 JUnit tests run on a
  plain JVM; the Glance/Android parts are first compiled by the Android workflow.
