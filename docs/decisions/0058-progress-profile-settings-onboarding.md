# 0058 — v0.5.1 Toparlama: İlerleme, Profil, settings, backup and the first run

## Context

The v0.5.1 review (plan/v0.5.1-toparlama-raporu.md) found, in İlerleme, Profil and the settings
sub-pages: a backup that said "saved" on Android while nothing reached the phone, a missing contact
address shown as a placeholder on the legal pages, dead ends for guests, links to empty lists, an
unmeasured level shown as B1, stats and goals repeated on two screens, technical words
("Senkron", "Kalıcı depolama") and no guided start for a brand-new user.

## Decision

1. **Native file saving.** In the Android app, backup, CSV export and the error log are written
   with `@capacitor/filesystem` (8.1.4, MIT) to `Documents/`; if that fails, the file goes to the
   cache and the share sheet opens (`@capacitor/share` 8.0.2, MIT). Both are loaded with a dynamic
   import only when `isNativeApp()`, so the web bundle does not grow. The toast names the location
   and offers "Paylaş". The web keeps the download link.
2. **A backup is recorded only after it is saved.** `exportBackup` no longer writes the
   last-backup date; `recordBackup` runs after a successful save, so a cancelled share sheet does
   not silence the backup reminder. The restore dialog offers "Önce şimdiki verilerini yedekle".
3. **Contact fallback.** With `VITE_CONTACT_EMAIL` empty, the legal pages and account deletion link
   to the GitHub issues page (`CONTACT_FALLBACK_URL`) instead of a placeholder sentence.
4. **Goals in one place.** Goals are edited on İlerleme (`/progress?edit=goals`). Profil no longer
   has the goals card or the mini stats; `/profile?edit=goals` forwards there, so older links work.
5. **Progressive İlerleme.** Thresholds are pure functions in `src/domain/progressView.ts`: until
   10 answers (`FIRST_STEPS_ANSWERS`) the Genel tab shows one first-steps card (what unlocks when)
   and the calendar; tiles and links appear only with something behind them (no "0 zor kelime"
   link, no report link before the first report). "Sınırı N yap" is offered only when it lowers
   the limit. The learned-word count has one definition (`useWordStages`), labelled "son 7 gün"
   where the window is rolling.
6. **Profil level.** An unmeasured level reads "Henüz ölçülmedi" with "Teste başla"; the
   vocabulary estimate never shows fewer words than the user has learned or marked known.
7. **First-run onboarding without a schema change.** Welcome → level test (skippable) → interests →
   a ready deck → the first session. Who sees it is decided from facts that already sync: no words
   and the interests question never answered (`settings.interests == null`). Progress and "done"
   are kept in localStorage (`engapp.onboarding`, `engapp.onboarding.step`), so a second device of
   an existing user never shows it. No Dexie version and no migration.
8. **Plain words.** "Senkron" → "eşitleme", storage and integrity settings in everyday Turkish,
   paths in help texts follow the new layout (Profil → ⚙ Ayarlar → …).

## Consequences

- The owner must fill `VITE_CONTACT_EMAIL` in `.env.production` (it feeds the web and Android
  builds) and check backup on a phone (Documents folder or share sheet).
- Touches outside this area, kept small: `HomeScreen.tsx` wraps the empty welcome in
  `FirstRunGate`; `HomeScreen.test.tsx` marks onboarding done; e2e specs that waited for
  "Senkron durumu: Senkronlandı" now wait for "Eşitleme durumu: Eşitlendi"; `getHardPracticeCount`
  in `data/practice.ts`; forecast axis labels in `features/load/WorkloadChart.tsx` (≥ 11 px);
  `wordStages.ts` takes the earliest recognition `learned_at`.
- The e2e fixture marks onboarding done by default (`firstRun: false`); a spec opts in with
  `test.use({ firstRun: true })`.
- The home interests prompt stays for existing users who never answered; new users answer it in
  the onboarding.
