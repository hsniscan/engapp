# 0029 — Picture style B and the image-v1 prompt

**Context.** v0.4 İP1: concrete word meanings get a small picture on the card. The owner chose
style **B** ("düz renk") out of three samples (A line drawing, B flat colour, C scene tile) on
22 Oct 2026. The pictures are drawn by Claude as SVG, must read in the light and the dark theme,
and must never carry text. The shared contract (`_shared/image-contract.ts`, written before the
work packages) fixes the palette, the 256×256 canvas and that stored SVGs use only the
light-theme hex values.

**Decision.**

- **Style rules** in `docs/image-style.md`: flat filled shapes, no ink outlines, lines only as
  shapes of their own, the soft backdrop circle `r = 114` at the centre, one large subject, no
  text, simple figures. Palette roles map the sample sheet's CSS variables to the contract
  (`--snow` and `--hl` → `white`, `--hl` as `opacity="0.55"`).
- **References.** The six approved samples are converted to stored format
  (`_shared/image-refs.ts`, copies in `docs/image-style/refs/`): CSS variables → light hex,
  attributes de-duplicated, normalised by the sanitizer. The `climb` sample clipped its mountain
  to the backdrop with `<clipPath>`/`url()`, which the sanitizer refuses; the stored copy draws
  the clipped outline as one path ending in an arc along the backdrop. Visually identical.
- **Parts library** (`_shared/image-parts.ts`): backdrop, ground, person, face, arrow, motion,
  water, raindrop, sun, tree, house, highlight, emphasis, "no". Listed in the prompt and the
  style page; a test checks each part passes the sanitizer and that the page shows it verbatim.
- **Prompt `image-v1`** (`_shared/image-prompt.ts`, text in `docs/ai-image.md`). System prompt =
  rules + colour roles + SVG rules + parts + the six references as worked examples; byte-stable
  (no dates, no per-request text) so it is cached with a 1-hour TTL across a night's batch and
  across instant requests. User turn = JSON `{lemma, pos, gloss_tr, visual_hint}` only, plus on
  a redraw one fixed sentence from `REDRAW_PROBLEMS` (never free text). Opus 5.5 by default
  (`CLAUDE_IMAGE_MODEL`), adaptive thinking, `output_config.effort: "medium"`, structured output
  `{drawable, svg, alt_tr, confidence}`, no temperature, no prefill.
- **Declining.** `drawable: false` lets the model refuse to force a picture for abstract or
  grammar words (plan criterion 3). The contract's `GeneratedImage` stays `{svg, alt_tr,
  confidence}`; `parseImageResponse` returns a small union (`image` / `declined` / `refused` /
  `invalid`) instead of throwing, so both paths handle each outcome explicitly.
- **alt_tr** is a short Turkish description for screen readers and never contains the English
  word (the picture card of İP8 asks for that word).

**Why.** Few-shot references in the owner's chosen style are the strongest lever on consistency;
the parts library keeps people, arrows and faces the same across thousands of pictures. Keeping
the prompt prefix stable makes caching cut most of the input cost. Fixed redraw sentences keep
the privacy rule simple to test: the request payload builder can only emit four meaning fields
and one of eight constant sentences.

**Deviation from the plan.** Annex A.4 describes colour *placeholders* (`#010101`…); the contract
written afterwards stores light hex values instead and swaps them for dark ones on the client.
This package follows the contract.
