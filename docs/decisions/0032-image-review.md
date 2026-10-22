# 0032 — Picture review screen ("Görsel onayı")

## Context

v0.4 İP4. New pictures arrive with status `review` (decision 0031); the owner approves,
rejects or asks for a redraw, mostly on a phone, often one-handed, many in a row. The server
side (`public.app_admins`, `is_app_admin()`, `image_review_queue(p_limit)`,
`image_review_decide(p_image_id, p_decision, p_reason)`, names in `IMAGE_RPC` of the shared
contract) is written by another package; this one is the client. Every one of those functions
checks the admin role on the server, so the client check only decides what is shown.

## Decision

1. **Route `/admin/images`** (lazy, immersive: no tab bar). The Settings entry "Görsel onayı"
   (top of "Gelişmiş") appears only when `is_app_admin()` answers true; the answer is cached
   per user and page load (`useIsAdmin`), a failed check is asked again later. The page
   itself says "Bu sayfa için Google ile giriş yapmalısın" / "Bu sayfa yalnızca yöneticiler
   için" / offline instead of calling the queue.
2. **One picture at a time**: lemma (serif, large), part of speech and Turkish meaning, the
   picture as large as the screen allows (up to 16 rem, 30 % of the viewport height) and its
   alt text (so the alt text is reviewed too).
3. **Three ways to decide, the same three decisions.**
   - Swipe: right = approve, left = reject (opens the reasons), down = redraw; 90 px to
     count, a chip shows which decision a drag will make, the card follows the finger and
     tilts (no tilt with reduced motion).
   - Buttons at the bottom, large and within thumb reach: "Reddet", "Yeniden çiz", "Onayla",
     and "Geri al" above them.
   - Keys: → approve, ← reject then 1–4 for the reason (Esc closes), ↓ redraw, Z undo.
   Reject reasons are the contract's `IMAGE_REJECT_REASONS` with the same Turkish labels as
   the user-facing "Hayır" (decision 0031).
4. **Optimistic queue** (`domain/imageReview.ts`, pure): up to 20 pictures are queued; the
   next one shows at once and the following three are decoded ahead. When fewer than 5 are
   left the screen asks for `20 + queued + pending` rows (the server answers oldest first and
   does not yet know about the ones queued or held back here) and keeps only ids this session
   has not seen, so a picture is never shown twice. A page with nothing new ends the
   refills. The counter reads "N görsel kaldı", or "N+ görsel kaldı" while the server may have
   more (there is no count function).
5. **Undo within the session without a server undo.** The last decision is held back: it is
   sent when the next decision is made, when the user leaves the screen (unmount) or when the
   page is hidden (`pagehide`). "Geri al" drops it and puts the picture back on screen. So
   only one decision can be undone, and nothing un-sends a decision already sent. A decision
   the server refuses (network, RPC error) puts its picture back at the end of the queue with
   a toast.
6. **From the word detail.** For an admin, the Evet / Hayır answer about a picture still in
   review is also sent as `approve` / `reject` with the reason (decision 0031, section 6).

## Consequences

- Reviewing is one gesture or key per picture with no wait for the network.
- If the tab is killed without `pagehide` (rare on phones), the held-back decision is lost
  and the picture simply comes back in the next session.
- No new client storage: the queue lives in memory; all state is on the server.
