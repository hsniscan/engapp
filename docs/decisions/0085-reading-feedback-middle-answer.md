# 0085 — A middle answer after "Bitirdim"

## Context

After "Bitirdim" the reader asked "Bu metin sana nasıldı?" with only two buttons, "Çok zor" and
"Çok kolay" (decision 0043). Hasan (2026-11-27): when neither was true he still felt he had to
pick one, which pushed `settings.reading_offset` the wrong way and made later suggestions worse.

## Decision

- Three answers, easiest first: "Kolaydı" (`easy`, −0.1), "Uygundu" (`ok`, no change),
  "Zordu" (`hard`, +0.1). The plain labels also fit a text that was only a bit easy or hard,
  and each fits on one line at 360 px.
- The question says it is optional ("İstersen cevap vermeden geçebilirsin."). "Bitirdim" alone
  records no answer, as before; tapping the chosen answer again takes it back.
- "Uygundu" thanks the user with "Okuma zorluğun böyle kalacak." Switching from "Zordu" to
  it takes the earlier nudge back (`nudgeOffset`).
- `user_texts.feedback` accepts `'ok'` (migration `20261128000100_text_feedback_ok.sql`). The
  migration must be applied before the web/APK release, or pushes with `'ok'` are refused.
  An older app that pulls `'ok'` treats it as no nudge and shows no button pressed.
