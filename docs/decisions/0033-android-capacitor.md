# 0033 — Android app with Capacitor

## Context

v0.4 İP5 (plan "İP5 Android uygulaması", Annex A.6, acceptance criterion 9): Engapp must be an
installable Android app from Google Play — own icon, native Google sign-in, read-aloud that works
offline, device notifications, no browser UI — not a Chrome/TWA wrapper, and the web build on
Cloudflare Pages must keep working exactly as before. The owner also wants to sideload the app on
his own phone before any Play release.

## Decision

1. **Capacitor 8 (current major), bundled assets.** `capacitor.config.ts` (appId
   `io.github.hsniscan.engapp`, appName `Engapp`, `webDir: dist`) and the `android/` project from
   the Capacitor template. No `server.url`: the APK carries the same `dist/` the web gets, served
   from `https://localhost` (secure context: IndexedDB, Cache Storage, `crypto.subtle` work as on
   the web). Plugins, each for one job: `@capacitor/app` (back button, resume, exit),
   `@capacitor/local-notifications`, `@capacitor-community/text-to-speech`,
   `@capawesome/capacitor-google-sign-in` (Credential Manager). Status bar and safe areas use
   Capacitor 8's built-in `SystemBars` (edge-to-edge, `env(safe-area-inset-*)`, IME inset); the
   splash is the Android 12 splash API. No status-bar, keyboard or splash-screen plugin.
2. **One code base, native code only when native.** `src/native/platform.ts` `isNativeApp()`
   reads the bridge's `Capacitor.isNativePlatform()` (defined by the native bridge before page
   scripts run), so `@capacitor/*` code is never in the web's main bundle; `src/native/*` is
   loaded with `import()` in the app only. In the app: no service worker registration, no update
   toast, no Web Push UI, no install prompt.
3. **Sign-in:** Credential Manager account sheet → Google ID token (nonce: SHA-256 to Google, raw
   to Supabase) → `supabase.auth.signInWithIdToken({ provider: 'google', token, nonce })`. Google
   refuses OAuth pages inside a WebView, so the web redirect flow is never used in the app. The
   server client id is the existing _web_ client (`VITE_GOOGLE_WEB_CLIENT_ID`, build-time); Google
   only issues the token if Android OAuth clients with the package name and the signing SHA-1s
   exist (docs/setup-android.md). Guest mode is unchanged (decision 0002).
4. **Edge functions** accept the app's origin `https://localhost`: the deploy workflow always
   appends it to `ALLOWED_ORIGINS` (`CAPACITOR_ANDROID_ORIGIN` in `_shared/http.ts`).
5. **Read-aloud:** server audio first (decision 0028, unchanged). The device-voice fallback is the
   phone's TextToSpeech engine (the WebView has no usable `speechSynthesis`): guests, offline
   without a cached copy (no network wait), every failure. en-GB falls back to en-US.
6. **Reminders on the phone.** `@capacitor/local-notifications`, planned by
   `src/domain/reminderSchedule.ts` from the shared rule (`decidePush` / `pushSlot`,
   decision 0024): the earliest instant at which the server rule would send, assuming nothing
   changes. The rule only depends on the local wall-clock hour and the user day, so checking
   `now + 1 min` and every following local hour boundary finds that instant exactly; a property
   test compares it with `decidePush` in six time zones (DST and half-hour offsets included). The
   due count is the server's (studied, live, unsuspended, unlocked cards due before the day ends),
   read from Dexie (`src/data/reminder.ts`). Replanned after every answer (live query on
   `review_logs`), on settings changes, on resume and on sign-in. The switch is **per device**
   (localStorage); hour and mode are the account's `settings.notify` (same choice as on the web).
   Turning it on asks for the Android 13+ permission and removes all of the account's Web Push
   subscriptions (own rows via `push_unsubscribe`; retried, also when an account signs in later)
   with a notice, so one person never gets two reminders. Inexact alarms: the exact-alarm
   permission is removed from the manifest (Play allows it only for alarm/calendar apps).
7. **Back button:** close the open sheet/menu (Escape to the topmost Radix layer) → go back in the
   app's history → home when a screen was opened without history → exit only on home.
8. **Icons, splash:** `scripts/generate-icons.ts` also writes the adaptive icon (vector
   foreground, tile colour background, monochrome themed layer), legacy PNGs, the notification
   icon and the pre-Android-12 splash mark from `src/ui/brand/mark.ts`. Splash and window
   background use the canvas colour with a night variant.
9. **Build and signing (`.github/workflows/android.yml`).** JDK 21 + Android SDK, `pnpm build`,
   `cap sync`, unit tests, debug APK, release AAB, release APK. versionCode = workflow run number
   (a newer APK always installs over an older one and keeps its data), versionName =
   `package.json` version. The **upload key** (secrets) signs both the sideload APK and the Play
   bundle, so one SHA-1 serves the Android OAuth client for both; without the secrets the AAB is
   unsigned and the APK is signed with a throwaway key made in the run
   (`engapp-apk-unsigned-test`, guest mode only). A manual job uploads the signed AAB to the Play
   closed-testing track with `PLAY_SERVICE_ACCOUNT_JSON`. `scripts/make-upload-key.sh` creates the
   upload keystore on the owner's machine.

## Deviations from the plan (and why)

- **Several reminders planned ahead, not one.** The plan says "schedule the single next
  notification". A phone cannot run code at a given time, so with a single notification a user
  who ignores it gets nothing more until they open the app, while Web Push reminds every day. The
  app plans the next reminder plus up to six following days, each being the rule's answer given
  the previous one was shown and nothing was studied — still at most one a day, never at night or
  on vacation; any answer replaces them all.
- **Due count: the due cards, not the workload forecast.** The plan says "the İP3 forecast for the
  due count". The forecast is an expectation that assumes the user studies every day; a reminder
  fires only when they have not, so the exact count of cards due before the day ends (what the
  server counts) is the right number, and it keeps the text identical to Web Push's.
- **Reminders also for guests.** Local notifications need no server or account.
- **No Dexie schema change.** The per-device switch and the plan live in localStorage (device-only
  state, like the theme); Dexie versions 22/23 stay unused.
- **The upload key is not generated by an agent.** The plan (A.6) had the key made in the cloud
  container. Instead the owner runs `scripts/make-upload-key.sh` on his own machine, so the
  private key never exists anywhere else; CI only reads it from secrets.
- **Offline read-aloud** plays server audio that is already cached on the phone before falling
  back to the device voice (same voice as online, instant); with no cached copy the device voice
  speaks at once.

## Consequences and limits

- Not built or run on a device in the agent environment (no Android SDK there); CI builds it, and
  İP10's real-device checklist covers the rest.
- Inexact alarms may be delayed by Doze; reminders are planned at the start of the hour (at least
  one hour before the 22:00 quiet time).
- Play App Signing re-signs Play builds with Google's key: a sideloaded build (upload key) and a
  Play build cannot update each other; switching means uninstalling (sync first; a guest's data
  would be lost). Both SHA-1s go into Google Cloud.
- Answers given on another device are unknown to this phone until it syncs; its reminder may come
  although the user studied elsewhere that day (the server has the mirror-image limit).
