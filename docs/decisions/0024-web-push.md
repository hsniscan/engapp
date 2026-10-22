# 0024 — Smart notifications with Web Push

## Context

v0.3 İP8 (plan "İP8 — Akıllı bildirim", Annex A.9, acceptance criterion 7): at most one
reminder a day, none when the user already reviewed that day, has nothing due or is on
vacation, none between 22:00 and 09:00, and turning it off stops it at once. It must arrive
while the app is closed (installed PWA on Android, iOS 16.4+ home-screen app), the owner must
not have to create keys or run anything, and the backend is deployed only by GitHub Actions.

## Decision

1. **Standard Web Push with VAPID, no push provider and no library.** The edge function
   `push-send` encrypts (RFC 8291, aes128gcm) and signs (RFC 8292, ES256) with Web Crypto in
   `supabase/functions/_shared/webpush.ts`, about 150 lines. A library (`web-push`) is a Node
   package with Node crypto; the protocol is small and fixed, and a known-answer test against
   the reference implementation (`http_ece`, by the RFCs' author) pins the output byte for
   byte. No new dependency.
2. **Keys are made by the deploy workflow, once.** `deploy-supabase.yml` lists the function
   secrets; if `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are missing it generates a P-256 pair
   with Node's crypto and stores both with `supabase secrets set` (never printed, never
   committed). They are never replaced afterwards: new keys would silently end every device's
   subscription. If listing fails, the step fails rather than regenerating. `VAPID_SUBJECT`
   comes from the repository variable of the same name (default: the app URL). The browser
   gets the public key from `GET /functions/v1/push-send/config`.
3. **Scheduling: pg_cron + pg_net inside the database.** The repository already schedules the
   tombstone purge with pg_cron; GitHub's own cron is too irregular for a 15-minute slot.
   `push_cron_tick()` runs every 15 minutes and posts to `push-send` with a random token the
   migration generates and keeps in `push_cron_config` (RLS on, no client grants); the
   function accepts a run only with that token (`push_check_cron_token`). The function URL is
   written by the workflow after deploying the functions (`select push_configure(url)` through
   the same pooler connection the migrations use), so local and CI databases never call out.
4. **One rule, shared.** `supabase/functions/_shared/push-rule.ts` holds the decision as a pure
   function (`pushSlot` + `decidePush`); `src/domain/notify.ts` re-exports it, as `level.ts`
   does. The server cannot import `src/domain/day.ts`, so the rule carries a small copy of the
   user-day arithmetic; a property test checks it against `day.ts` in six time zones,
   DST included. Send when all hold:
   - `settings.notify.enabled` and at least one subscription;
   - local wall-clock hour in 09–21 and at or after the chosen hour. A run that is missed is
     made up by the next one the same evening; 22:00–09:00 never sends;
   - no answered review (`undo_of is null`) since the start of the user's day
     (`timezone` + `day_start_hour`), using the synced `review_logs`;
   - today is not inside `settings.vacation` (`{start, end}` day strings written by the
     load-management package; read through `to_jsonb(settings)` so the SQL works with or
     without that column, and ignored when malformed);
   - reviews due before the end of the user's day > 0: live, unsuspended, unlocked cards in
     learning/review/relearning, as the app's queue counts them (new cards are not counted);
   - no `push_log` row for this user-day. The row is inserted **before** sending
     (`push_claim`, primary key `(user_id, day)`), so two overlapping runs cannot both send.
5. **The hour.** `settings.notify = {enabled, mode: 'auto' | 'fixed', hour}`, synced like any
   setting (nullable jsonb column; a push without the key keeps it, `_sync_upsert`). The
   device resolves the hour and stores it, so the server never needs the history: auto = the
   most frequent session start hour (a pause of 30 minutes starts a new session) over the last
   21 days, ties to the earlier hour. The plan says "clamped to 09–22"; we clamp to **09–21**,
   because a reminder at 22:00 would fall into the quiet hours and could never be sent. The
   device re-checks the auto hour at most every 6 hours when the app opens or returns to the
   foreground.
6. **Text from counts only, built on the server.** "Bugün 23 tekrar seni bekliyor (~6 dk)":
   minutes = due × the median answer time of the last 30 days (capped at 60 s, 10 s without
   history). The texts are server constants in `push-rule.ts` (the app may be closed, so the
   web app's i18n files cannot be used); they contain no user text.
7. **Subscriptions per device, setting per account.** `push_subscriptions` has one row per
   browser endpoint; clients can only read their own rows and write through `push_subscribe` /
   `push_unsubscribe` (owner = `auth.uid()`, never a parameter). An endpoint registered by
   another account moves to the caller (the browser belongs to whoever is signed in). Only
   endpoints of the browsers' push services are accepted (FCM, Mozilla, Apple, WNS), in SQL
   and again before every send, so a forged row cannot make the server call an arbitrary URL.
   At most 10 devices per account. 404/410 from the push service deletes the row; 10 failed
   reminders in a row drop it too. Turning the switch off unsubscribes the browser, deletes
   the row and sets `notify.enabled = false` for the account; a sign-out or another sign-in
   unsubscribes the browser (multi-account rule, 0009).
8. **Service worker.** The generated Workbox worker imports `public/push-sw.js`
   (`workbox.importScripts`): `push` shows the notification (tag `engapp-due`, so a newer one
   replaces an older one), `notificationclick` focuses an open window and routes it to
   `/review` in place (message to the page), or opens `/review`.
9. **Guests and unsupported browsers.** Push needs a Google account (the server sends it).
   Settings → Bildirim explains this to guests, shows the existing iPhone "Ana Ekrana Ekle"
   steps in an iOS Safari tab, and on Android suggests installing the app.

## Why

- The plan's acceptance criterion 7 is a server-side guarantee (at most once, never at night,
  never after a review), so the decision runs where the clock and the synced data are, and
  the "once" is enforced by a primary key, not by timing.
- Everything the owner would otherwise have to do (keys, cron, URL) is done by the deploy.

## Consequences and limits

- Reviews done offline and not synced yet are unknown to the server: such a day can still
  get the reminder.
- The due count is the full count of due reviews; when the load-management package caps the
  day's queue (catch-up mode), the text may say more than the queue shows. Deferred: use the
  capacity once İP3 is merged.
- "Seri tehlikede" wording (plan) is not built: it needs the streak on the server. Deferred.
- Web Push delivery can be delayed by phone battery savers (plan risk table); nothing depends
  on it.
- Dexie v17 re-pulls settings once (a device that ran an older version while another turned
  reminders on dropped the column).
