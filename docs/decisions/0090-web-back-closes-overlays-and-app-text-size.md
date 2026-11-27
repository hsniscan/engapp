# 0090 — Web Back closes the open dialog; an app-wide text size

## Context

Browser review 2026-11-26 (profil-genel #2 and #6, ekle #12):

- On the web and in the installed PWA, Back with a dialog or sheet open (Add sheet, "Verileri
  sil") left the page. The open overlay was lost and the learner landed on the page before. The
  Android app already closes the top overlay first (`src/native/start.ts`, ADR 0033).
- The app had no text size of its own. PR #37 made the layouts hold at a 160 % root size, but
  the only "Yazı boyutu" was the reader's, and searching Ayarlar for it found nothing.

## Decision

**Back on the web (`src/app/webBack.ts`, started from `main.tsx` only when not native).**

- When a `role="dialog"` or `role="alertdialog"` with `data-state="open"` appears, one history
  entry is pushed for the same URL. It copies react-router's state and adds a depth mark, so
  the router sees no change. Menus and select lists push nothing.
- Back pops that entry. If an overlay is open, the top one is closed with the same Escape
  dispatch the native back button uses (`closeTopOverlay`).
- Closing another way (×, Escape, a button) leaves the entry where it is. Taking it off at once
  with `history.go` would race whatever comes next: a link inside the sheet, or a typed address.
  Instead, a later Back that lands on such a leftover entry, on the same page with nothing open,
  goes on through the leftovers and leaves the page. Back from a page opened inside the sheet
  lands on the page itself. Either way the learner's one Back press does what they meant, and
  history only moves inside a Back gesture.
- The Capacitor path is unchanged.

**Text size (`src/ui/theme/textSize.ts`, Ayarlar › Görünüm › Yazı boyutu).**

- The sizes are Normal / Büyük / En büyük, a root `font-size` of 100 / 115 / 130 % of the
  browser's own size. Every size in the app is in rem, so the whole UI scales. The reader's
  Küçük/Orta/Büyük applies on top.
- The setting is stored per device in localStorage (`engapp.textSize`), as a display
  preference like the theme's pre-paint cache, so it does not sync. `index.html` applies it
  before the first paint.
- The settings search finds "yazı boyutu" on both Çalışma (the reader size) and Görünüm.

## Why

The learner expects Back to undo the last thing they opened, as in the Android app. A
same-URL entry is the only hook the web gives without the Navigation API, which Safari lacks.

The largest step stops at 130 % because the layouts already hold at 160 %. A per-device
setting fits: a phone and a laptop need different sizes.
