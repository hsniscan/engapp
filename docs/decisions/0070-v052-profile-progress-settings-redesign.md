# 0070 — v0.5.2 wave 2: Profil, İlerleme, Ayarlar, onboarding, auth, legal and brand on "Çam"

## Context

Wave 1 shipped the design system "Çam" (ADR 0065) and the behaviour fixes for this area
(ADR 0060 server quotas, ADR 0063 Profil fixes, ADR 0064 Android/PWA). The screens still used
hand-made styling: serif titles, arbitrary sizes, a gear and a second icon set
(`SettingsGlyph`), a hand-rolled forecast chart whose bars were flat when the capacity line was
far above them, and the old ink/blue app icon. ADR 0060 left one gap open: a user over the
daily sync quota (SQLSTATE `53400`) only saw "Eşitleme başarısız", and every refused push
counted as a failed attempt, so rows went "stuck" after ten tries.

## Decision

1. **Screens rebuilt from `docs/design.md` §4.14–4.18** with `src/ui` only: `PageFrame` /
   `TabHeader` for every page, `SectionHeader` + `Card`, `StatRow`/`StatTile`, `HeatStrip`,
   `StageBar` (one stage scale), `ProgressRing` (goals), `BarChart` (forecast), `ListGroup` /
   `ListRow` (Profil places, Ayarlar index and rows), `Badge`, `Tabs`. No new `src/ui` files, no
   API or token change.
2. **One settings icon.** Profil has no header icon; Ayarlar is a row. `SettingsGlyph.tsx` is
   deleted; every row icon comes from `icon-paths.tsx` on a neutral `IconTile`. In-app paths in
   the legal texts read "Profil → Ayarlar → …" (no gear).
3. **Forecast with visible bars.** "Önümüzdeki 30 gün" uses `BarChart` with
   `minScale = max(5, 25 % of capacity)`, today highlighted, the capacity line only when it fits,
   and the capacity in words below. The day list is a real disclosure button with a captioned
   table (it replaces `<details>`).
4. **Quota is its own sync error.** `classify()` maps a server error whose message starts with
   `53400` to `SyncErrorKind 'quota'`. Like `network`, it does not call `failOutboxItems` (the
   rows are not at fault) and is not logged as a crash; the engine keeps polling with its normal
   back-off and the rows go once the quota resets. UI: `sync.quota` "Bugünkü eşitleme sınırı
   doldu" + "Değişikliklerin bu cihazda güvende; yarın kendiliğinden gönderilir" in Ayarlar →
   Hesap, in the rail/top-bar indicator (a warn pill linking to Hesap) and on Profil. Because
   Bugün no longer shows sync (design 4.1), Profil shows a card at the top whenever sync is in
   an error state (quota → warn, other → danger), plus the quiet row at the bottom.
5. **Copy items from the review** (profil-ilerleme.md): d2 `/hesap-sil` lists the same deleted
   data as the privacy policy; d3 "Değişiklikler hemen kaydedilir…" only on pages that hold a
   synced setting; d7 İlerleme shows a quiet "Seviyeni ölç" row when the level is unmeasured and
   the home offer would otherwise hide every invitation; d8 the unused `stats.title`,
   `stats.description`, `stats.tabContinuity` keys are removed.
6. **Brand.** `mark.ts` colours: pine tile `#1f5c4f`, white "e", pale-pine tick `#88cdb9`.
   `pnpm icons` regenerated the favicon, PWA icons (any + maskable + apple-touch), Android
   adaptive/legacy/round launcher icons and the splash mark. `capacitor.config.ts`
   `iconColor` `#1f5c4f`; Android `engapp_canvas`/`engapp_accent` (day/night) and the Glance
   widget palette follow the Çam tokens.

## Why

- Quota refusals are expected behaviour under ADR 0060, not row failures: burning attempts
  would mark healthy rows "stuck" and tell the user something is broken when nothing is.
- Scaling the forecast to the busiest day rather than to the capacity is the review's O-6 fix and
  matches the shared chart rule; the capacity stays readable as text.

## Consequences

- No Dexie version (45 unused) and no migration.
- An older client still treats `53400` as a server error (attempts counted) until it updates.
- Not rebuilt here: `features/leech` (Sık unuttukların / Karıştırabileceğin, shown on Gelişim;
  W1's area) and `features/levels` (word level in the word sheet; W2's area) keep their own
  styling; `InterestsPrompt` and `FsrsOptOffer` live on Bugün (W1).
