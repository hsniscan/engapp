# Pictures (`image-v2`, `visual-v1`, `imagecheck-v2`)

Small watercolour-and-pencil pictures on the cards of concrete meanings (v0.4 İP1 + İP2;
decisions 0029 and 0030; the owner switched from style B, [image-style.md](image-style.md), to
watercolour on 2026-10-25: `image-v2`; flat `image-v1` pictures are replaced as the new ones are
stored). Claude draws each picture as SVG; the server
sanitizes and checks it, and the owner approves it in the review screen before every user sees
it. Pictures belong to a lexicon sense, so one picture serves every user who has that meaning.

Code (all under `supabase/functions/_shared/` unless noted):

| File | What |
|---|---|
| `image-contract.ts` | shared contract with the client (palette, row shape, `ai-image` request/response, `IMAGE_RPC`) |
| `image-prompt.ts` | `image-v2`: system prompt, schema, `buildImageRequest`, `parseImageResponse`, redraw sentences |
| `visual-prompt.ts` | `visual-v1`: visualizability score and drawing hint |
| `image-check.ts` | contrast check, pixel coverage, `imagecheck-v2` (vision) |
| `svg-sanitize.ts` | allowlist sanitizer (also used by the client: `src/domain/svgSanitize.ts`) |
| `image-models.ts` | model ids from the environment, the one price map, cost and reservation math |
| `image-pipeline.ts` | `evaluateDrawing` (every check of one answer), `drawSense` (synchronous drawing) |
| `image-instant.ts`, `ai-image/index.ts` | the `ai-image` edge function |
| `image-store.ts` | database access (service role) |
| `scripts/lib/image-jobs.ts` | nightly jobs and the pilot; CLIs `scripts/img-batch.ts`, `scripts/img-pilot.ts` |
| `scripts/lib/image-render.ts` | PNG render with `@resvg/resvg-wasm` (Node only) |
| `supabase/migrations/20261025000200_images.sql` | tables, queue, budget, review functions |

## Flow

```text
visual-v1 (nightly, Haiku) ──► lexicon_senses.visualizability / visual_hint
        │ score >= 2, no picture yet
        ▼
image_requests (queue) ◄── image_request(sense) RPC from the app ("Resim iste")
        │                ◄── image_review_decide(..., 'redraw')
        ▼
submit (nightly): Message Batch of image-v2 requests (half price)
        ▼
collect (next night): sanitize → contrast → render light/dark → coverage → imagecheck-v2
        │ pass                         │ fail (first time)        │ fail again
        ▼                              ▼                          ▼
lexicon_images 'review'        stored 'rejected',          stored 'rejected', done
        │                      queued again as redraw
        ▼
review screen (app_admins): approve → 'approved' (every user) / reject / redraw
```

`ai-image` (a user taps "draw now") takes the same path synchronously, without the render: the
edge runtime cannot rasterise SVG, so the picture is stored as `review` with
`checks.vision = "pending"` and the next nightly `collect` runs the vision check on it.
A `review` picture is visible only to users who have that sense in their cards, and to the
review screen.

## `ai-image`

`POST /functions/v1/ai-image` with the session token, body `{"sense_id": "<lexicon_senses.id>"}`
(`aiImageRequest`). Steps:

1. The sense must be in the caller's own cards (otherwise `invalid_input`).
2. Budget probe: the call's upper bound must fit in this month's budget, else
   `{"ok": false, "reason": "budget"}` — checked first, so a spent month does not use up a
   daily picture.
3. `image_consume`: at most `IMAGE_DAILY_LIMIT` (default 10) per user per UTC day, else
   `daily_limit`.
4. `drawSense`: `image-v2` on `CLAUDE_IMAGE_MODEL` with the server-side refusal fallback,
   sanitize, contrast; one redraw after a failed check. The model declining or a refusal (after
   the fallback) → `not_visual`; two failures → `failed`.
5. Success: `{"ok": true, "image": LexiconImageRow}` with status `review`.

Model or network errors → `ai_failed` (HTTP 502), like the other AI functions.

## Budget

Every Claude call (drawing, vision check, visual score; instant, batch and pilot) reserves an
upper bound of its cost in `image_budget` before it is sent and settles the real cost from
`usage` afterwards (`image_budget_reserve` / `image_budget_settle`). A reservation is refused
when `spent + reserved + amount > cap`, in one locking SQL statement, so parallel callers can
never pass the cap together. Cap: `0.8 × CLAUDE_MONTHLY_CREDIT_USD` (default 100 → 80 USD per
calendar month, UTC). Upper bound of one call: input counted at the 1-hour cache-write price
(2× input), all of `max_tokens` as output, and for an instant drawing with the fallback one more
full attempt at the highest listed price. Prices: `MODEL_PRICES` in `image-models.ts` (USD per
million tokens); an unknown model is priced at the highest listed price. Batch calls cost half.
A failed request is settled at 0. Holds older than an hour (a crashed run) count as spent,
except batch holds, which `collect` settles.

## Checks

In this order; the first failure decides the redraw sentence:

1. **Sanitizer** (`svg-sanitize.ts`, plan A.4): allowlisted elements and attributes only,
   palette colours only, `viewBox="0 0 256 256"`, no entities, `url(`, scripts, styles, links,
   text or foreign namespaces; at most 8 KB, 600 elements, depth 12. Refused → `invalid_svg`.
   The one exception to `url(`: `filter="url(#line)"` / `filter="url(#wash)"` on shapes and
   groups; the sanitizer then adds the fixed `IMAGE_WC_DEFS` filter block (the model never writes
   `<defs>`), and removes it again before re-parsing, so sanitizing stays idempotent.
2. **Contrast** (`contrastCheck`): the backdrop must be there (the flat circle, or for `image-v2`
   the first wash shape under `filter="url(#wash)"`); a subject colour must reach
   2:1 against the backdrop in both themes; colours under 1.4:1 (white, yellow, paper …) are
   allowed only on top of another shape. → `low_contrast`.
3. **Coverage** (Node only): rendered on the theme's backdrop, at least 4 % of the circle must
   differ visibly from it in both themes. → `low_contrast`.
4. **`imagecheck-v2`** (Node only, Haiku vision on both PNGs): text → `has_text`; wrong meaning
   or confidence < 0.6 → `wrong_meaning`; too busy → `clutter`; no verdict → `other`.

## Nightly jobs

`.github/workflows/images.yml`, 01:30 UTC: `collect`, then `visualize`, then `submit`
(`scripts/img-batch.ts`). `submit` runs in the nightly run only when the repository variable
`IMAGE_BULK` is not `false` (the owner approved bulk drawing on 2026-10-24; by hand, `submit` always
sends). On demand one job, or the pilot (`scripts/img-pilot.ts`: N random nouns, verbs and
adjectives with zipf ≥ 3 — no frequency floor while no term has a zipf yet — scored first when
needed, drawn now, stored as `review`, with the cost of each picture and the total; the report
is kept as a workflow artifact). Without `ANTHROPIC_API_KEY` the workflow ends with a notice.
Every step that ends well writes a heartbeat (`public.job_runs`, setup-backend.md step 13).

Queue priority (higher first; decision 0037, `20261026001010_image_priority.sql`, TypeScript
twin `_shared/image-priority.ts`):

| Priority | Who |
|---|---|
| 4000 | owner "redraw" from the review screen |
| 3000 + 100 per user | user requests |
| 2000 + users | auto: in an app admin's (the owner's) cards |
| 1000 + users | auto: in anyone's cards |
| 500 + zipf × 10 | auto: within the owner's CEFR level ±1 (`settings.level` of the admins) |
| 100 + zipf × 10 | auto: the rest of the 5,000 most frequent lemmas (`ref_word_freq`) |
| — | anything else is not queued automatically |

Only senses with visualizability ≥ 2 are auto-queued. Zipf is `lexicon_terms.zipf`, else
`ref_word_freq` directly (correct before the level job has filled `lexicon_terms.zipf`); with
no frequency data at all every sense counts as "top 5,000". Each night `image_queue_auto`
re-ranks the queued auto requests (a sense that entered someone's cards moves up; redraws and
user requests are never touched) and queues new ones; `visual-v1` scores senses in the same
order.

## Model calls

| Prompt | Model (env) | Thinking | Effort | `max_tokens` | Cache | Fallback |
|---|---|---|---|---|---|---|
| `image-v2` | `CLAUDE_IMAGE_MODEL` (default `claude-sonnet-5-5`) | adaptive | medium | 8000 | system, 1 h | server-side (instant and pilot; not batches) |
| `visual-v1` | `CLAUDE_CHECK_MODEL` (default `claude-haiku-5-5`) | adaptive | low | 8000 | system, 5 min | none |
| `imagecheck-v2` | `CLAUDE_CHECK_MODEL` | adaptive | low | 4000 | system, 5 min | none |

All three use structured output (`output_config.format`, JSON schema), no temperature and no
prefill. The model may decline: `image-v2` answers `drawable: false` when nothing sensible can be
drawn, and a refusal (`stop_reason: "refusal"`) is treated the same (`not_visual`). Model ids are
read only from the environment (`imageModels`); no other file names a model.

**Privacy.** The user turn of `image-v2` is exactly
`{"lemma", "pos", "gloss_tr", "visual_hint"}` (plus `previous_problem`, one of the fixed
sentences below, on a redraw); `visual-v1` gets numbered `{n, lemma, pos, gloss_tr}`;
`imagecheck-v2` gets `{lemma, pos, gloss_tr}` and the two PNGs. No ids, user data, card text or
example sentences reach the model. A snapshot test pins this.

## `image-v2`

### User turn

```json
{"lemma":"umbrella","pos":"noun","gloss_tr":"şemsiye","visual_hint":"an open umbrella in the rain"}
```

On a redraw, `previous_problem` is added with one of these sentences:

| Problem | Sentence |
|---|---|
| `wrong_meaning` | The previous drawing did not show this meaning clearly; a learner guessed another word. |
| `unclear` | The previous drawing was hard to read at a small size; use fewer, larger shapes. |
| `ugly` | The previous drawing did not match the style; follow the style rules and the examples closely. |
| `has_text` | The previous drawing contained text or letter-like marks; use no text at all. |
| `clutter` | The previous drawing was too busy; keep one large subject and at most two cues. |
| `low_contrast` | The previous drawing used colours that vanish on the backdrop; put light colours only on top of other shapes. |
| `invalid_svg` | The previous SVG broke the SVG rules (elements, attributes or colours); follow them exactly. |
| `other` | The previous drawing was not accepted; draw it again more simply. |

### System prompt

```text
You draw small flashcard pictures for Turkish speakers learning English words. Each picture shows one meaning of one English word so that a learner who sees only the picture can recall the word. The learners are adults: the pictures are warm and friendly but never childish.

You receive one meaning as JSON: lemma (the English word), pos (part of speech), gloss_tr (the Turkish meaning; draw exactly this meaning, not another sense of the word) and visual_hint (an optional English idea of what to draw, or null). A redraw also has previous_problem: what was wrong with the last attempt; avoid it.

## Style: watercolour and pencil

Soft hand-drawn illustration, like a light watercolour sketch in a good picture book.
- Start with one backdrop wash: a large irregular blob (not a circle, not a rectangle) behind the subject, filled with one of the wash colours (#f1dfc0, #d6e6ec, #e1e9d2), opacity 0.7–0.85, with filter="url(#wash)". It softly covers roughly the middle 70–85 % of the canvas.
- Then the drawing: shapes inside one or a few <g filter="url(#line)" stroke="#4a4440" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"> groups, so every shape gets a thin, slightly wobbly pencil outline. Fills are flat palette colours, often a little transparent (opacity 0.8–0.95), like a watercolour wash inside the lines.
- Shading: a few extra shapes in a darker colour of the same family at low opacity (0.15–0.3), without outlines (stroke="none" or outside the pencil group), on the shade side. Highlights: white at low opacity. No gradients.
- Thick limbs and poles are two strokes on top of each other: a wider pencil stroke and a narrower coloured stroke, so they read as outlined tubes.
- One clear subject, large and centred, filling about two thirds of the canvas. Keep every shape at least 16 units inside the canvas edge (the pencil wobble needs room). A tiny scene with a person or context is welcome when it makes the meaning clearer (a child holding a parent's hand for "child"), but at most one or two supporting cues.
- People: simple and friendly, round heads in skin colour with dot eyes, a few strokes of hair, simple clothes in calm colours; no detailed faces unless the meaning is a feeling. Adults look like adults.
- Feelings are a clear face or posture; actions are a figure in mid-action; relations (between, under, behind) are simple objects with one faint arrow; abstract-but-drawable meanings use the most common everyday scene.
- No text of any kind: no letters, digits, words, labels, signs with writing, speech bubbles with words, or symbols that stand for letters. That includes sound effects: no "Z" for sleep, no "!" or "?"; show sleep or surprise with the face and posture.
- Draw nothing frightening, violent, sexual, religious or political; for such words show a calm, neutral cue or decline.

## Colours

Use only these hex values (light theme; the app swaps each for its dark-theme twin). Each role has a purpose:
- #4a4440 pencil: every outline (the stroke of the pencil group), eyes, small dark marks
- #8f857a pencilSoft: faint helpers: arrows, ground lines, motion and steam strokes, distant outlines
- #f1dfc0 washSand: backdrop wash for indoor, warm or neutral scenes and single objects
- #d6e6ec washSky: backdrop wash for sky, weather, water, cold and outdoor air
- #e1e9d2 washSage: backdrop wash for nature, plants, gardens and fields
- #fbf6ec paper: off-white inner parts on top of a coloured shape (pages, plates, screens)
- #fefefe white: clouds, snow, highlights (with opacity); only on top of another shape
- #ecc9a6 skin: skin of faces and hands
- #d9a77f skinShade: shade side of skin, ears, a blush
- #6b4a35 hair: hair, beards, dark brown things
- #c2654a terracotta: red things, warm clothes, roofs, apples, anger
- #8e4a36 rust: shade of red and brown things (low opacity glazes)
- #e88a7a coral: pink and light red: lips, blossoms, soft warm clothes
- #e0a06e ochre: orange things, oranges, warm light, bread, bags
- #f0c45a mustard: yellow: the sun, lemons, stars, lamps
- #7f9e6a sage: grass, leaves, light green things, "go"
- #5d7d4e leaf: darker leaves, trees, shade of green things
- #8fb3a6 teal: calm clothes, glass, cool objects
- #5b6b80 slate: trousers, deep water, dark blue objects, shade of blue things
- #7fa9c4 waterBlue: water, rain, ice, sky details, blue objects
- #a98aa8 plum: purple: flowers, fabric, special objects
- #a87a52 wood: wood, trunks, furniture, baskets, bread crust
- #d9c3a0 sand: sand, paths, paper bags, light stone, floors
- #b3a690 stone: stone, walls, mountains, shade of sand
- #9a958e metal: metal, tools, cars, wheels, grey objects

Contrast: the outlines carry the drawing on both themes. white, paper and the wash colours are only for the wash itself or on top of another shape, never as a subject on its own.

## SVG rules

- Exactly one root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">. No width or height.
- Elements: g, path, circle, ellipse, rect, line, polyline, polygon. Nothing else: no defs, filter, use, clipPath, mask, gradient, pattern, text, image, style, title. The two filters are added by the app; only refer to them with filter="url(#wash)" (the backdrop wash, once) and filter="url(#line)" (the pencil groups).
- Attributes: d, points, cx, cy, r, rx, ry, x, y, x1, y1, x2, y2, width, height, fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, transform, opacity, fill-opacity, stroke-opacity, fill-rule, filter. No id, class, style or href.
- fill and stroke are always one of the palette hex values or none. Give every shape an explicit fill (fill="none" for open strokes).
- Whole numbers or one decimal. Keep the SVG under 5 KB; around 2–4 KB is typical.

## Answer

Answer with JSON only: {"drawable": boolean, "svg": string, "alt_tr": string, "confidence": number}.
- drawable: false when no picture can show this meaning without text or a misleading symbol (grammar words, most abstract nouns, "although", "whether"); then svg and alt_tr are "" and confidence is 0. Do not force a picture.
- svg: the picture.
- alt_tr: one short Turkish sentence (at most 120 characters) describing what is drawn, for screen readers. Never write the English word in it.
- confidence: 0 to 1, how likely a learner recognises the meaning from the picture alone.

## Approved examples

### apple (noun)
Input: {"lemma":"apple","pos":"noun","gloss_tr":"elma","visual_hint":null}
Idea: One whole object, centred and large on a sage wash: red body with a darker glaze on the shade side, a white highlight, brown stem, green leaf.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><path d=\"M45 100 C55 50 120 30 170 40 C225 52 235 110 220 160 C205 215 140 232 90 220 C40 205 35 150 45 100Z\" fill=\"#e1e9d2\" opacity=\"0.78\" filter=\"url(#wash)\"/><ellipse cx=\"128\" cy=\"212\" rx=\"60\" ry=\"7\" fill=\"#b3a690\" opacity=\"0.35\"/><g filter=\"url(#line)\" stroke=\"#4a4440\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M128 96 C110 76 66 84 66 138 C66 186 98 214 118 208 C124 206 132 206 138 208 C158 214 190 186 190 138 C190 84 146 76 128 96Z\" fill=\"#c2654a\" fill-opacity=\"0.9\"/><path d=\"M128 94 C128 80 130 70 138 58\" fill=\"none\" stroke-width=\"6\"/><path d=\"M128 94 C128 80 130 70 138 58\" fill=\"none\" stroke=\"#a87a52\" stroke-width=\"3\"/><path d=\"M140 70 C150 46 180 44 196 54 C186 76 162 84 140 70Z\" fill=\"#7f9e6a\" fill-opacity=\"0.9\"/><path d=\"M144 68 C160 62 174 58 190 55\" fill=\"none\" stroke-width=\"1.5\"/></g><path d=\"M160 100 C186 112 192 160 168 196 C186 190 196 150 188 124 C184 108 172 100 160 100Z\" fill=\"#8e4a36\" opacity=\"0.25\"/><path d=\"M84 118 C86 102 98 94 108 94 C98 102 92 112 90 128Z\" fill=\"#fefefe\" opacity=\"0.4\"/></svg>","alt_tr":"Yeşil yapraklı ve saplı kırmızı bir elma","confidence":0.9}

### umbrella (noun)
Input: {"lemma":"umbrella","pos":"noun","gloss_tr":"şemsiye","visual_hint":"an open umbrella in the rain"}
Idea: The object large and centred on a sky wash; rain strokes around it are the one supporting cue.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><path d=\"M38 110 C30 60 90 28 140 32 C200 36 232 80 224 140 C216 200 160 232 105 224 C55 216 46 160 38 110Z\" fill=\"#d6e6ec\" opacity=\"0.8\" filter=\"url(#wash)\"/><ellipse cx=\"128\" cy=\"222\" rx=\"70\" ry=\"6\" fill=\"#7fa9c4\" opacity=\"0.3\"/><g filter=\"url(#line)\" stroke=\"#4a4440\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M128 100 L128 200 Q128 216 114 214 Q106 212 106 204\" fill=\"none\" stroke-width=\"7\"/><path d=\"M128 100 L128 200 Q128 216 114 214 Q106 212 106 204\" fill=\"none\" stroke=\"#a87a52\" stroke-width=\"3.5\"/><path d=\"M52 108 C52 60 90 38 128 38 C166 38 204 60 204 108 Q191 96 178 108 Q165 96 153 108 Q140 96 128 108 Q116 96 103 108 Q90 96 78 108 Q65 96 52 108Z\" fill=\"#c2654a\" opacity=\"0.9\"/><path d=\"M128 38 L103 108 M128 38 L153 108\" fill=\"none\" stroke-width=\"1.8\"/><path d=\"M128 38 L128 30\" fill=\"none\"/></g><path d=\"M150 44 C182 54 200 80 202 106 L178 106 C178 80 168 58 150 44Z\" fill=\"#8e4a36\" opacity=\"0.2\"/><path d=\"M76 80 Q86 58 108 48\" stroke=\"#fefefe\" stroke-opacity=\"0.4\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/><g stroke=\"#7fa9c4\" stroke-width=\"3\" stroke-linecap=\"round\" fill=\"none\"><path d=\"M52 130 L47 146\"/><path d=\"M82 142 L77 158\"/><path d=\"M176 134 L171 150\"/><path d=\"M206 128 L201 144\"/><path d=\"M66 170 L61 186\"/><path d=\"M190 168 L185 184\"/><path d=\"M154 150 L149 166\"/></g></svg>","alt_tr":"Yağmur altında açık duran kırmızı bir şemsiye","confidence":0.9}

### angry (adjective)
Input: {"lemma":"angry","pos":"adjective","gloss_tr":"kızgın","visual_hint":"an angry face"}
Idea: A feeling: one big face filling the wash, frowning brows, a flushed glaze on the cheeks, a few short anger strokes.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><path d=\"M40 90 C55 40 120 25 175 38 C230 52 240 120 222 170 C205 220 140 236 90 224 C40 210 25 140 40 90Z\" fill=\"#f1dfc0\" opacity=\"0.78\" filter=\"url(#wash)\"/><g filter=\"url(#line)\" stroke=\"#4a4440\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M82 238 Q86 190 112 184 L144 184 Q170 190 174 238 Z\" fill=\"#5b6b80\" opacity=\"0.9\"/><path d=\"M116 172 L116 188 L140 188 L140 172\" fill=\"#ecc9a6\"/><ellipse cx=\"128\" cy=\"114\" rx=\"52\" ry=\"58\" fill=\"#ecc9a6\"/><path d=\"M76 106 Q70 52 128 50 Q186 52 180 106 Q170 74 128 72 Q86 74 76 106Z\" fill=\"#6b4a35\"/><path d=\"M76 116 Q70 118 72 130 Q78 134 80 126\" fill=\"#d9a77f\"/><path d=\"M180 116 Q186 118 184 130 Q178 134 176 126\" fill=\"#d9a77f\"/><path d=\"M92 96 L120 108 M164 96 L136 108\" fill=\"none\" stroke-width=\"4\"/><circle cx=\"107\" cy=\"116\" r=\"3.5\" fill=\"#4a4440\"/><circle cx=\"149\" cy=\"116\" r=\"3.5\" fill=\"#4a4440\"/><path d=\"M106 158 Q128 140 150 158\" fill=\"none\" stroke-width=\"3.5\"/><path d=\"M112 152 L144 152\" fill=\"none\" stroke-width=\"1.8\"/></g><ellipse cx=\"90\" cy=\"138\" rx=\"12\" ry=\"8\" fill=\"#c2654a\" opacity=\"0.3\"/><ellipse cx=\"166\" cy=\"138\" rx=\"12\" ry=\"8\" fill=\"#c2654a\" opacity=\"0.3\"/><path d=\"M150 70 Q172 80 176 106 Q180 130 170 150 Q178 120 168 96 Q162 80 150 70Z\" fill=\"#c2654a\" opacity=\"0.18\"/><g stroke=\"#8f857a\" stroke-width=\"2.5\" stroke-linecap=\"round\" fill=\"none\"><path d=\"M188 52 L200 40 M200 66 L216 62 M68 52 L56 40 M56 66 L40 62\"/></g></svg>","alt_tr":"Kaşları çatık, yanakları kızarmış, öfkeli bir yüz","confidence":0.9}

### climb (verb)
Input: {"lemma":"climb","pos":"verb","gloss_tr":"tırmanmak","visual_hint":"a person climbing a steep mountain"}
Idea: An action: a figure in mid-climb on a steep stone slope, reaching up; a faint arrow shows the direction.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><path d=\"M35 90 C60 35 150 25 205 55 C240 85 230 165 205 205 C170 240 90 235 52 200 C20 165 20 120 35 90Z\" fill=\"#d6e6ec\" opacity=\"0.78\" filter=\"url(#wash)\"/><g filter=\"url(#line)\" stroke=\"#4a4440\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M30 222 L140 50 L170 100 L190 80 L238 222 Z\" fill=\"#b3a690\" fill-opacity=\"0.9\"/><path d=\"M140 50 L124 78 L136 74 L142 88 L154 76 Z\" fill=\"#fefefe\" fill-opacity=\"0.9\"/><path d=\"M140 50 L170 100 L190 80 L238 222 L150 222 Z\" fill=\"#8e4a36\" fill-opacity=\"0.15\" stroke=\"none\"/><path d=\"M82 170 L100 166 L112 150\" fill=\"none\" stroke=\"#8f857a\" stroke-width=\"2\"/><path d=\"M96 196 L100 160 L120 162 L118 198 Z\" fill=\"#5b6b80\" fill-opacity=\"0.9\"/><path d=\"M98 198 L90 212 M118 198 L124 210\" fill=\"none\" stroke-width=\"5\"/><path d=\"M96 130 Q112 122 126 132 L122 168 L98 166 Z\" fill=\"#c2654a\" fill-opacity=\"0.85\"/><path d=\"M124 134 L138 112 M100 134 L88 150\" fill=\"none\" stroke-width=\"8\"/><path d=\"M124 134 L138 112 M100 134 L88 150\" fill=\"none\" stroke=\"#c2654a\" stroke-width=\"4\"/><circle cx=\"140\" cy=\"109\" r=\"4.5\" fill=\"#ecc9a6\"/><circle cx=\"87\" cy=\"152\" r=\"4.5\" fill=\"#ecc9a6\"/><circle cx=\"110\" cy=\"114\" r=\"14\" fill=\"#ecc9a6\"/><path d=\"M96 112 Q98 98 112 99 Q126 100 125 112 Q116 105 106 108 Q100 108 96 112Z\" fill=\"#6b4a35\"/><circle cx=\"116\" cy=\"115\" r=\"1.5\" fill=\"#4a4440\"/></g><path d=\"M150 160 L168 140\" stroke=\"#8f857a\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M168 140 L160 142 M168 140 L167 148\" stroke=\"#8f857a\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M60 60 Q75 50 90 60 Q105 58 100 70 L62 70 Q52 66 60 60Z\" fill=\"#fefefe\" opacity=\"0.8\"/></svg>","alt_tr":"Dik bir dağın yamacına tırmanan bir kişi","confidence":0.9}

### between (preposition)
Input: {"lemma":"between","pos":"preposition","gloss_tr":"arasında","visual_hint":"a ball between two boxes"}
Idea: A relation: a ball between two wooden boxes, a faint double arrow above; nothing else.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><path d=\"M32 100 C40 55 100 30 150 38 C205 46 238 90 226 142 C216 195 160 220 110 216 C60 212 25 160 32 100Z\" fill=\"#f1dfc0\" opacity=\"0.78\" filter=\"url(#wash)\"/><ellipse cx=\"128\" cy=\"208\" rx=\"96\" ry=\"6\" fill=\"#b3a690\" opacity=\"0.35\"/><g filter=\"url(#line)\" stroke=\"#4a4440\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"28\" y=\"130\" width=\"62\" height=\"76\" fill=\"#a87a52\" fill-opacity=\"0.85\"/><path d=\"M28 150 L90 150\" fill=\"none\"/><path d=\"M48 130 L48 150 M70 130 L70 150\" fill=\"none\" stroke-width=\"2\"/><rect x=\"166\" y=\"130\" width=\"62\" height=\"76\" fill=\"#a87a52\" fill-opacity=\"0.85\"/><path d=\"M166 150 L228 150\" fill=\"none\"/><path d=\"M186 130 L186 150 M208 130 L208 150\" fill=\"none\" stroke-width=\"2\"/><circle cx=\"128\" cy=\"170\" r=\"36\" fill=\"#c2654a\" fill-opacity=\"0.88\"/><path d=\"M94 170 Q128 150 162 170\" fill=\"none\" stroke-width=\"2\"/><path d=\"M104 146 Q128 190 152 196\" fill=\"none\" stroke-width=\"2\"/></g><path d=\"M28 190 L90 190 L90 206 L28 206Z\" fill=\"#8e4a36\" opacity=\"0.2\"/><path d=\"M166 190 L228 190 L228 206 L166 206Z\" fill=\"#8e4a36\" opacity=\"0.2\"/><path d=\"M112 150 Q108 158 108 166\" stroke=\"#fefefe\" stroke-opacity=\"0.5\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M96 90 L160 90 M96 90 L106 82 M96 90 L106 98 M160 90 L150 82 M160 90 L150 98\" stroke=\"#8f857a\" stroke-width=\"2.5\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>","alt_tr":"İki kutunun ortasında duran kırmızı bir top","confidence":0.9}

### heavy (adjective)
Input: {"lemma":"heavy","pos":"adjective","gloss_tr":"ağır","visual_hint":"a person struggling to lift a heavy box"}
Idea: A property shown by a person: a man straining to lift a big box, a faint down arrow for the weight.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><path d=\"M38 110 C35 65 95 32 145 38 C200 44 238 85 228 140 C220 195 165 226 112 222 C62 218 42 165 38 110Z\" fill=\"#f1dfc0\" opacity=\"0.8\" filter=\"url(#wash)\"/><ellipse cx=\"128\" cy=\"224\" rx=\"85\" ry=\"6\" fill=\"#b3a690\" opacity=\"0.35\"/><g filter=\"url(#line)\" stroke=\"#4a4440\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M62 170 L58 218 M82 170 L86 218\" fill=\"none\" stroke-width=\"9\"/><path d=\"M62 170 L58 218 M82 170 L86 218\" fill=\"none\" stroke=\"#5b6b80\" stroke-width=\"5\"/><path d=\"M50 221 h14 M82 221 h14\" stroke-width=\"4\"/><path d=\"M52 108 Q74 96 96 108 L100 174 L48 174 Z\" fill=\"#8fb3a6\" opacity=\"0.9\"/><path d=\"M62 98 L62 108 L82 108 L82 98\" fill=\"#ecc9a6\"/><circle cx=\"72\" cy=\"80\" r=\"19\" fill=\"#ecc9a6\"/><path d=\"M54 76 Q56 56 74 58 Q90 58 91 78 Q82 66 70 68 Q60 68 54 76Z\" fill=\"#6b4a35\"/><path d=\"M76 78 L82 76 M64 76 L70 77\" fill=\"none\" stroke-width=\"2\"/><circle cx=\"80\" cy=\"82\" r=\"1.6\" fill=\"#4a4440\"/><circle cx=\"66\" cy=\"82\" r=\"1.6\" fill=\"#4a4440\"/><path d=\"M66 92 Q73 87 80 92\" fill=\"none\"/><path d=\"M96 116 L130 150 M58 120 L100 158\" fill=\"none\" stroke-width=\"9\"/><path d=\"M96 116 L130 150 M58 120 L100 158\" fill=\"none\" stroke=\"#8fb3a6\" stroke-width=\"5\"/><rect x=\"108\" y=\"128\" width=\"98\" height=\"84\" fill=\"#a87a52\" opacity=\"0.9\"/><path d=\"M108 150 L206 150\" fill=\"none\"/><path d=\"M142 128 L142 150 M172 128 L172 150\" fill=\"none\" stroke-width=\"2\"/><circle cx=\"110\" cy=\"152\" r=\"5\" fill=\"#ecc9a6\"/><circle cx=\"130\" cy=\"148\" r=\"5\" fill=\"#ecc9a6\"/></g><path d=\"M108 188 L206 188 L206 212 L108 212Z\" fill=\"#8e4a36\" opacity=\"0.25\"/><path d=\"M118 134 L196 134\" stroke=\"#fefefe\" stroke-opacity=\"0.3\" stroke-width=\"3\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M156 108 L156 122 M150 116 L156 124 L162 116\" stroke=\"#8f857a\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M52 62 q-6 4 -4 10 M92 60 q4 -2 6 2\" stroke=\"#8f857a\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\"/></svg>","alt_tr":"Büyük, ağır bir kutuyu zorlanarak kaldıran bir kişi","confidence":0.9}
```

### Response schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "drawable",
    "svg",
    "alt_tr",
    "confidence"
  ],
  "properties": {
    "drawable": {
      "type": "boolean"
    },
    "svg": {
      "type": "string"
    },
    "alt_tr": {
      "type": "string"
    },
    "confidence": {
      "type": "number"
    }
  }
}
```

`drawable: false` means nothing sensible can be drawn; then `svg` and `alt_tr` are ignored.

## `visual-v1`

Scores 50 meanings per call. `hint` becomes `lexicon_senses.visual_hint` (`""` → null; `<`, `>`
and control characters are removed). Senses the model skipped stay unscored and are asked again.

### System prompt

```text
You help decide which English word meanings get a picture on a flashcard for Turkish speakers. The pictures are small, flat, text-free drawings (one subject on a round backdrop).

You receive a JSON list of meanings: n (a number), lemma (English word), pos (part of speech) and gloss_tr (the Turkish meaning). Judge each meaning exactly as gloss_tr gives it, not other senses of the word.

Score each meaning:
- 3: a concrete thing, animal, place, food or very common scene that anyone recognises at once (apple, bridge, umbrella).
- 2: an action, a feeling, a relation or a property that a simple scene shows clearly without text (climb, angry, between, wet).
- 1: drawable only with a convention or a symbol that may mislead (freedom, justice, sudden).
- 0: no picture helps or any picture would mislead: grammar and function words, most abstract nouns, discourse words (although, whether, concept, therefore).

hint: for scores 1–3, one short English idea of what to draw (at most 120 characters), e.g. "a person going up a steep mountain"; "" for 0.

Answer with JSON only: {"items": [{"n": number, "score": number, "hint": string}]}, one item per meaning, in any order.
```

### Response schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "items"
  ],
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "n",
          "score",
          "hint"
        ],
        "properties": {
          "n": {
            "type": "integer"
          },
          "score": {
            "type": "integer"
          },
          "hint": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

## `imagecheck-v2`

### System prompt

```text
You review small flashcard pictures for Turkish speakers learning English words. Each picture should let a learner recall one meaning of one English word from the picture alone.

You get the meaning as JSON (lemma: the English word, pos: part of speech, gloss_tr: the Turkish meaning) and the same picture twice: on the light theme, then on the dark theme.

The pictures are soft watercolour with pencil outlines: wobbly edges, uneven lines and soft, blurred washes of colour are the intended style, not clutter and not a flaw.

Answer with JSON only: {"depicts_sense": boolean, "has_text": boolean, "clutter": boolean, "confidence": number}.
- depicts_sense: true if a learner who knows the meaning would name this word (or an obvious synonym) from the picture, in this meaning; false if it shows another meaning or nothing recognisable.
- has_text: true if any letters, digits, words or letter-like marks appear.
- clutter: true if the picture is too busy to read at 120 pixels, or a part is hard to see on either theme.
- confidence: 0 to 1, how sure you are of depicts_sense.
```

### Response schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "depicts_sense",
    "has_text",
    "clutter",
    "confidence"
  ],
  "properties": {
    "depicts_sense": {
      "type": "boolean"
    },
    "has_text": {
      "type": "boolean"
    },
    "clutter": {
      "type": "boolean"
    },
    "confidence": {
      "type": "number"
    }
  }
}
```

## Tests

No test calls Claude; responses are fixtures (`_shared/testing/image-fixtures.ts`).

- `_shared/svg-sanitize.test.ts`, `src/domain/svgSanitize.test.ts`: the references and harmless
  variants pass, 47 malicious files in `tests/fixtures/svg/malicious/` are refused, fuzzing.
- `_shared/image-prompt.test.ts`: request shape, privacy snapshot, parsing, prices and the
  reservation bound (property test).
- `_shared/image-pipeline.test.ts`: `drawSense` and `ai-image` (limits, budget, redraw,
  declines), and that concurrent callers never pass the cap (property test).
- `scripts/lib/image-jobs.test.ts`: submit, collect, visualize and the pilot against a fake
  store and Batches API; `scripts/lib/image-render.test.ts`: the renderer.
- `supabase/tests/database/22_images.test.sql`: RLS, queue, budget, review functions.
- `src/ai/image-docs-sync.test.ts`: this page shows the prompts and schemas verbatim.
