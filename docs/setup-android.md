# Android app setup (Capacitor)

Everything the owner must create or set so the Android app builds, signs, lets users sign in with
Google, installs on a phone (sideload) and, later, goes to Google Play. Design and reasons:
`docs/decisions/0033-android-capacitor.md` (app) and `0034-share-target.md` (Paylaş → Engapp).
Values in `code style` are typed or copied exactly; placeholders look like `<THIS>`.

Fixed values:

| What                      | Value                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| Package name (app id)     | `io.github.hsniscan.engapp`                                      |
| App name                  | `Engapp`                                                         |
| Upload key alias          | `engapp`                                                         |
| WebView origin of the app | `https://localhost` (allowed by the edge functions after step 4) |
| Workflow                  | `.github/workflows/android.yml` (Actions tab → **Android**)      |

Summary of what the owner sets (details below):

| Where              | Name                             | Value                                          | Needed for                                 |
| ------------------ | -------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| GitHub → Variables | `GOOGLE_WEB_CLIENT_ID`           | the existing **web** OAuth client id (step 1)  | Google sign-in in the app                  |
| GitHub → Secrets   | `ANDROID_KEYSTORE_BASE64`        | content of `engapp-upload.jks.base64` (step 2) | signed APK (`engapp-apk`) and signed AAB   |
| GitHub → Secrets   | `ANDROID_KEYSTORE_PASSWORD`      | the keystore password you chose (step 2)       | same                                       |
| GitHub → Secrets   | `ANDROID_KEY_ALIAS`              | `engapp`                                       | same                                       |
| GitHub → Secrets   | `PLAY_SERVICE_ACCOUNT_JSON`      | service account JSON key (step 7)              | optional: upload to Play from the workflow |
| Google Cloud       | Android OAuth client(s)          | package + SHA-1 of each signing key (step 3)   | Google sign-in in the app                  |
| GitHub → Actions   | re-run the **Supabase** workflow | —                                              | edge functions accept `https://localhost`  |

GitHub path for secrets and variables: repository **Settings → Secrets and variables →
Actions**, tab **Secrets** or **Variables**, **New repository secret / variable**.

## 1. Web client id → GitHub variable `GOOGLE_WEB_CLIENT_ID`

The app asks Google for an ID token whose audience is the **existing web OAuth client** (the one
created in `docs/setup-backend.md` step 2.5 and pasted into Supabase). Supabase already trusts
that client id, so nothing changes in Supabase.

1. Google Cloud console → **APIs & Services → Credentials** (or **Google Auth Platform →
   Clients**), open the **Web application** client `Engapp Supabase`, copy its **Client ID**
   (ends in `.apps.googleusercontent.com`). The client **secret** is not needed.
2. GitHub → **Variables** → `GOOGLE_WEB_CLIENT_ID` = that client id. It is public (it is in every
   OAuth URL), so it is a variable, not a secret.

The id is compiled into the web bundle as `VITE_GOOGLE_WEB_CLIENT_ID`. If it is missing, the build
still succeeds (with a warning in the log) and the app shows "Bu sürümde Google girişi
ayarlanmamış…" instead of the account sheet. **Never** use an Android client id here.

## 2. Upload key (once, on your own computer)

The upload key signs both the APK you sideload and every bundle uploaded to Play, so one SHA-1
works for sign-in on both. **If it is lost, the sideloaded app cannot be updated any more and
Play needs an upload-key reset**: keep two backups (e.g. a password manager attachment and an
offline USB stick) of the `.jks` file and its password.

1. Needs `keytool` (any JDK 17+). With Android Studio it is in its bundled JBR:
   - Windows: `C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe`
   - macOS: `/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool`
   - Linux: `<android-studio>/jbr/bin/keytool`
     Put that `bin` folder on `PATH`. On Windows run the script from **Git Bash** (comes with Git
     for Windows) or WSL.
2. From the repository root, with a folder **outside** the repository:
   ```
   scripts/make-upload-key.sh ~/engapp-keys
   ```
   It asks for a password twice (at least 12 characters; not shown while typing), then writes
   `engapp-upload.jks` and `engapp-upload.jks.base64` into that folder and prints the
   certificate's **SHA-1** and **SHA-256**. Copy the SHA-1 (it is not secret). The script refuses
   to overwrite an existing key or to write inside the repository.
3. GitHub → **Secrets**:
   - `ANDROID_KEYSTORE_BASE64` = the whole content of `engapp-upload.jks.base64` (one line)
   - `ANDROID_KEYSTORE_PASSWORD` = the password from step 2
   - `ANDROID_KEY_ALIAS` = `engapp`
     The key password equals the keystore password (PKCS12), so there is no separate secret.

To print the fingerprints again later:
`keytool -list -v -keystore ~/engapp-keys/engapp-upload.jks -alias engapp` (asks for the
password). Every signed workflow run also prints them in the **Signing key** step and the
**Name and check the outputs** step.

## 3. Google Cloud: Android OAuth clients (needed for sign-in in the app)

Google issues an ID token to an Android app only if an **Android** OAuth client with the app's
package name and the SHA-1 of the certificate that signed the installed APK exists **in the same
Google Cloud project as the web client** from step 1. The app never sends the Android client id;
Google matches package + signature by itself. Create one client per signing key:

| Client name               | Package name                | SHA-1 certificate fingerprint                            | When                          |
| ------------------------- | --------------------------- | -------------------------------------------------------- | ----------------------------- |
| `Engapp Android (upload)` | `io.github.hsniscan.engapp` | upload key SHA-1 (step 2)                                | now — sideloaded `engapp-apk` |
| `Engapp Android (Play)`   | `io.github.hsniscan.engapp` | Play **app signing key** SHA-1 (Play Console, see below) | once the app exists on Play   |
| `Engapp Android (debug)`  | `io.github.hsniscan.engapp` | your local `~/.android/debug.keystore` SHA-1             | optional, local debug builds  |

Steps for each: Google Cloud console (project of the web client) → **APIs & Services →
Credentials → Create credentials → OAuth client ID** (or **Google Auth Platform → Clients →
Create client**) → Application type **Android** → name, package name, SHA-1 → **Create**. Nothing
needs to be copied from the result.

- Play app signing SHA-1: Play Console → the app → **Test and release → Setup → App signing** →
  "App signing key certificate" → **SHA-1 certificate fingerprint**. (The "Upload key
  certificate" shown there is the one from step 2.)
- Debug SHA-1 (only if you build in Android Studio):
  `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`.
  The `engapp-debug-apk` artifact is signed with the CI runner's fresh debug key and cannot sign
  in; use it only for debugging.
- OAuth consent screen: while it is in **Testing**, only the listed **Test users** can sign in
  (also in the app). Add the testers or **Publish app** (`docs/setup-backend.md` step 2.4).
- Supabase: no change. **Authentication → Sign In / Providers → Google** keeps the **web**
  client id in "Client IDs", and **Skip nonce checks** stays **off** (the app sends a nonce).
- Changes in Google Cloud can take a few minutes to apply.

## 4. Edge functions: allow the app's origin

The app's pages come from `https://localhost`. The deploy workflow now always appends it to
`ALLOWED_ORIGINS`. Re-run **Actions → Supabase → Run workflow** once after this branch is
merged so the functions (AI import, audio) accept requests from the app. No secret changes.

## 5. Build: run the workflow

- It runs on every pull request that touches the app, and by hand: **Actions → Android → Run
  workflow** (branch `main`; leave "Upload the signed AAB to Google Play" unticked).
- About 10 minutes. Then open the run → **Artifacts**:

| Artifact                   | What                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engapp-apk`               | release APK signed with the upload key: **install this on your phone**                                                                                                                                            |
| `engapp-apk-unsigned-test` | only when the step 2 secrets are missing: release APK signed with a throwaway key made in that run. Installs and works in guest mode; **Google sign-in does not work**, and it cannot be updated by any later APK |
| `engapp-debug-apk`         | debug build (WebView debugging is off), for developers                                                                                                                                                            |
| `engapp-aab`               | bundle for Google Play; signed only when the upload key secrets exist                                                                                                                                             |

- File names are `engapp-<version>-<versionCode>`: `version` comes from `package.json`,
  `versionCode` is the workflow run number, so every new run's APK has a higher versionCode and
  installs over the previous one keeping all data. (Local builds use versionCode 1; do not
  install a local release build over a CI build.)
- The job summary says which key signed the APK; the log prints its SHA-1/SHA-256.

## 6. Sideload on your own phone (before Play)

1. On the phone, open the GitHub run page in Chrome (signed in to GitHub), tap the
   **engapp-apk** artifact. It downloads a `.zip`.
2. Open **Files** (Google Files or the phone's file manager) → Downloads → tap the zip →
   **Extract**. Inside is `engapp-<version>-<n>.apk`.
3. Tap the APK. The first time Android says the app (Files or Chrome — whichever opened the APK)
   is not allowed to install unknown apps: tap **Settings**, turn on **Allow from this source**,
   go back, tap **Install**. The same switch is at **Settings → Apps → Special app access →
   Install unknown apps → Files (or Chrome)**; on Samsung: **Settings → Apps → ⋮ → Special
   access → Install unknown apps**. You may turn it off again afterwards.
4. Google Play Protect may warn "Unsafe app blocked" or "App scanned / unknown developer": tap
   **More details → Install anyway** (it does not know the app because it is not on Play yet).
   If it offers to send the app for scanning, either answer is fine.
5. Open **Engapp**, sign in with Google (or continue as guest). Allow notifications when you turn
   on the reminder in Settings → Bildirim.

Updating: download the newer `engapp-apk` and install it the same way; Android replaces the app
and keeps its data (same key, higher versionCode). If Android says "App not installed" /
"package conflicts": the installed copy was signed with a different key (for example an
`engapp-apk-unsigned-test` build, a local debug build or, later, a Play build). Sync first
(signed-in data is on the server; **a guest's data is lost** on uninstall unless exported with
Settings → Veri), uninstall, then install.

Sideload vs Play: Play re-signs builds with Google's app signing key, so a sideloaded APK and the
Play app cannot update each other. Moving from the sideloaded app to the Play app (or back) means
uninstalling once, as above.

## 7. Google Play (when ready)

1. Play Console → **Create app**: name `Engapp`, default language Turkish, App, Free. Complete the
   **Dashboard** tasks (privacy policy URL, app access, ads, content rating, target audience,
   data safety).
2. **Test and release → Testing → Closed testing** → create a track (its id is `alpha` for the
   default closed track) and add testers.
3. First upload by hand: create a release on that track and upload the `engapp-aab` file from a
   run that had the upload key. Accept **Play App Signing** (Google generates the app signing key;
   your key from step 2 becomes the upload key). Then add the **Play** Android OAuth client
   (step 3) with the app signing SHA-1.
4. Optional, automatic uploads: Google Cloud → **IAM & Admin → Service accounts → Create**
   (any name, no roles) → **Keys → Add key → JSON** → download. Enable the **Google Play Android
   Developer API** in that project. Play Console → **Users and permissions → Invite new users** →
   the service account's email → app permission for Engapp with **Release apps to testing
   tracks** (and **View app information**). GitHub → Secrets → `PLAY_SERVICE_ACCOUNT_JSON` = the
   whole JSON file content. Delete the downloaded file afterwards.
5. **Actions → Android → Run workflow** → tick "Upload the signed AAB to Google Play", track
   `alpha` (or your track id), status `draft` until the app has passed its first review, then
   `completed`. Without the secret or the upload key, the upload job only prints a notice.

## 8. Local build (developers)

Needs Node 22 + pnpm, JDK 21 and Android Studio (SDK 36).

```
echo "VITE_GOOGLE_WEB_CLIENT_ID=<web client id>" >> .env.local
pnpm install
pnpm build
npx cap sync android
npx cap open android        # or: cd android && ./gradlew assembleDebug
```

`pnpm dev` and the Cloudflare Pages build are unchanged; the `android/` folder is only used by
Capacitor. After changing icons run `pnpm icons` (it also writes the
Android launcher, notification and splash images). A release build signs only when
`ENGAPP_KEYSTORE_FILE`, `ENGAPP_KEYSTORE_PASSWORD` and `ENGAPP_KEY_ALIAS` are set in the
environment; versionCode is `-PversionCode=<n>` (default 1).

## 9. Troubleshooting

| Symptom                                                        | Cause / fix                                                                                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Bu sürümde Google girişi ayarlanmamış…"                       | `GOOGLE_WEB_CLIENT_ID` variable missing when the APK was built (step 1); rebuild.                                                                                |
| Account sheet closes at once / "no account" / `[16]`/`[28444]` | No Android OAuth client matches the installed APK's package + SHA-1 (step 3), it was created in another project, or the APK is `engapp-apk-unsigned-test`/debug. |
| Account picked, then sign-in error                             | Supabase Google provider must list the **web** client id; "Skip nonce checks" off; consent screen in Testing and the account is not a test user.                 |
| AI import / audio fail only in the app                         | Deploy Supabase was not re-run after merge (step 4), so `https://localhost` is not an allowed origin.                                                            |
| No reminder                                                    | Settings → Bildirim switch is per phone; Android notification permission; battery saver may delay it (inexact alarms, at most an hour).                          |
| "App not installed"                                            | Signed with a different key than the installed copy (step 6, Updating).                                                                                          |
