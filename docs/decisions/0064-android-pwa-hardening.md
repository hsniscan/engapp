# 0064 — v0.5.2: Android and PWA hardening (camera, backup, back button, R8, 16 KB, share a photo)

## Context

The 2026-11-01 review (`plan/gelistirme-raporu-2026-11/teknik-notlar/android-pwa.md`) found that
the Android shell and the PWA mostly behave, but some things would fail on a real phone or in
Play review:

- **Y1** "Fotoğraf çek" opened the gallery on Android 11+: Capacitor's file chooser looks up a
  camera app with `resolveActivity`, and package visibility hides it unless the manifest
  declares an `IMAGE_CAPTURE` query.
- **O1** `allowBackup="true"` with no rules: Auto Backup copied the WebView storage (the
  Supabase refresh token in localStorage, the device's sync id and the outbox in IndexedDB) to
  Google Drive and restored them on another phone. It also stops without a word above 25 MB,
  and 5,000 cards already take 23.6 MB.
- **O4** The back button at Bugün called `exitApp()` (`finish()`), so every return was a cold
  start. A renderer killed in the background took the app down with it.
- **O2** Guests in the app saw the browser warning ("the browser may delete your data"):
  `persist()` returns false in a WebView, but app data is only lost on uninstall or Clear
  storage.
- **O3** Nothing handled Dexie `versionchange`. An old tab kept running against a schema that a
  newer tab had upgraded.
- **O6/O7/Y4** The release build was not shrunk, CI had no Android lint, the third-party Play
  upload action was on a moving tag, and nothing checked 16 KB page-size alignment of the ML Kit
  native libraries (Play rejects misaligned 64-bit libraries for apps targeting Android 15+).
- **O8** The planned Play name was 34 characters; Play allows 30.
- **D1/D2/D6/D9** The PWA had no shortcuts and precached 3.6 MB. A shared image could not
  reach OCR. The system splash ended before the page's first frame.

## Decision

1. **Camera.** `AndroidManifest.xml` declares
   `<queries><intent><action android:name="android.media.action.IMAGE_CAPTURE"/></intent></queries>`.
   Still no `CAMERA` permission: the system camera app takes the photo.
2. **No Android backup.** `allowBackup="false"`, `fullBackupContent="false"`, and
   `dataExtractionRules` (`res/xml/data_extraction_rules.xml`) that exclude every domain from
   both cloud backup and device-to-device transfer. On Android 12+, `allowBackup="false"` alone
   still allows device-to-device transfer, which is why the rules exist. We chose this over
   partial rules because:
   - a partial restore (cards without the session, or without the device id) is a state the
     sync code has never been tested in;
   - the 25 MB cap would quietly drop the backup for exactly the heavy users who need it;
   - the app already has two supported paths to a new phone: the account (sync) and its own
     backup file (Profil → Ayarlar → Veri). The native guest notice (point 4) points to them.
   The cost: a guest who never makes a backup loses their data when changing phones. The same is
   true on the web.
3. **Back and renderer.**
   - At the root the back button calls `App.minimizeApp()` (`moveTaskToBack`). `decideBack`
     now returns `'minimize'`.
   - `MainActivity` adds a `WebViewListener`. When `onRenderProcessGone` fires, the activity is
     recreated with a fresh WebView. Nothing is lost: the data is in IndexedDB, and shared
     intents are marked consumed. If the renderer is lost a second time within 30 s
     (`RendererRecovery`, unit-tested), the activity finishes instead of looping.
4. **No browser-eviction wording in the app.** In the native app, `watchFirstCard` skips
   `persist()`. A guest gets a neutral one-time notice instead ("Uygulamayı kaldırırsan ya da
   verilerini temizlersen kelimelerin silinir. Hesap aç ya da yedek al.") with a backup button.
   Ayarlar → Veri shows "Verilerin nerede?" in place of the persistent-storage row.
5. **Schema replaced by another tab.** `watchDbReplaced` (`src/data/db.ts`) handles
   `versionchange`. It closes the connection with auto-reopen disabled and returns false, which
   skips Dexie's default handler (that one closes and silently reopens). It then calls back once.
   `src/app/pwa.ts` shows a persistent toast ("Engapp başka bir sekmede güncellendi"). Its
   Yenile button activates a waiting service worker first, so the reload does not bring back
   the old code. A delete from another tab is handled the same way.
6. **R8, lint, 16 KB, pinned action.**
   - Release builds use `minifyEnabled true`, `shrinkResources true` and
     `proguard-android-optimize.txt`. `proguard-rules.pro` keeps the Capacitor plugins
     (repeating Capacitor's consumer rules), `@JavascriptInterface` members, Glance
     `ActionCallback` constructors (instantiated by name), the Credential Manager Play-services
     provider (the rule from the Credential Manager docs) and ML Kit component registrars. It
     also keeps line numbers; the mapping file travels in the AAB.
   - `res/raw/engapp_keep.xml` keeps the notification icon that the local-notifications plugin
     finds by name.
   - CI runs `:app:lintRelease`, uploads the report as `engapp-lint-report` and annotates
     failures. It is **advisory** for now (`continue-on-error`): nobody could run lint on this
     code before (no Android SDK in the build sandbox). Once a report comes back clean, remove
     `continue-on-error` to make it blocking.
   - `scripts/check-16kb.sh` runs as a **blocking** CI step on the release APK. It checks two
     things for every `lib/arm64-v8a` and `lib/x86_64` `.so`: the ELF LOAD segment alignment is
     at least 2^14 (as in Android's `check_elf_alignment.sh`), and `zipalign -c -P 16` passes.
     The script was tested on synthetic 4 KB and 16 KB libraries.
   - `r0adkll/upload-google-play` is pinned to `e738b9dd8f2476ea806d921b64aacd24f34515a5`
     (v1.1.5, the commit `v1` pointed to on 2026-11-01).
7. **ML Kit version.** `com.google.mlkit:text-recognition` stays at **16.0.1**. Google Maven
   (dl.google.com) was not reachable from the build sandbox, so its metadata could not be read.
   Packages updated in 2025 and 2026 that care about 16 KB pages (for example
   `react-native-vision-camera-ocr-plus` 2.1.1, published 2026-10-29, which builds its own code
   with flexible page sizes) still depend on 16.0.1, so it is very likely the current,
   compliant release. The blocking CI check (point 6) settles it on the first build: if it
   fails, bump ML Kit to the newest version in Google Maven, or Play Console → App bundle
   explorer shows which library fails.
8. **Play name.** `Engapp – İngilizce Kelimeler` (28 characters; `docs/play-store/listing-tr.md`).
   The launcher label stays `Engapp`.
9. **Share a photo into OCR.**
   - `MainActivity` accepts `ACTION_SEND` with `image/*`. `ShareTargetPlugin` copies the
     stream off the UI thread into `cache/shared-images/`, keeping only the newest share and at
     most 25 MB (`SharedImage`, unit-tested). It then sends a retained `imageShared` event with
     the path.
   - `src/native/share.ts` turns the path into a WebView URL (`Capacitor.convertFileSrc`) and
     opens `/fotograf` with it in router state.
   - `OcrPage` fetches the file, reads it once and then drops the state, so Back or a reload
     does not read it again.
10. **Splash until first frame.** `MainActivity` installs the core-splashscreen API. It keeps
    the splash until the WebView reports `onPageCommitVisible`, for at most 2.5 s. This covers
    WebView start-up. A blank canvas can still show while the JS bundle parses; releasing the
    splash from React would need a plugin call and was left out.
11. **PWA.**
    - The manifest has three `shortcuts`: Çalış `/study`, Kelime ekle `/add` and Oku
      `/kesfet?f=okuma`.
    - pdf.js (`assets/pdf-*.js`, about 430 KB) and the Anki reader worker (about 150 KB) are
      no longer precached. They are cached on first use (`engapp-import-readers`), the way the
      pdf.js worker already was (0008). If those imports are opened offline before their first
      use, the user sees the existing "reader could not be downloaded" message.
    - Precache drops from 203 entries / 3.63 MB to 201 / 3.06 MB.
12. **Store screenshots script.** `scripts/store-shots.ts` follows the five-place app:
    Bugün, study front and back (`/study?mode=word`), Kelimelerim, the reader, words from a
    text, Keşfet and İlerleme (8, Play's maximum). The sync label is now "Eşitleme durumu:
    Eşitlendi". The script ran end to end. The images were not committed, because they will be
    taken again after the redesign.

## Not done (and why)

- **D3** (`file_paths.xml` `external-path "."`): the share and download paths
  (`src/native/files.ts`, Documents first) need checking on a device before narrowing.
- **D4** (route whitelist for `EXTRA_ROUTE` from the widget bridge), **D5** (widget previews),
  **D8** (versionCode on CI re-runs): small, but outside this pass.
- **Y3/O5** (Bugün performance) belong to 0062.
- PWA `screenshots` in the manifest: added after the redesign, together with the store
  screenshots.

## Consequences

- An R8 release needs one device smoke test before the first Play upload: share text and a
  photo, the selection menu, both widgets, the reminder buttons, OCR, Google sign-in and TTS.
  If something is stripped, Play's crash reports show readable stack traces.
- The first CI run tells us whether ML Kit is 16 KB-aligned and what lint finds.
- Users of the app who relied on Android's Drive backup (guests on a new phone) now need the
  app's own backup or an account. The native notice tells them.
