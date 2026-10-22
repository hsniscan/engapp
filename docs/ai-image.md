# Pictures (`image-v1`, `visual-v1`, `imagecheck-v1`)

Small style-B pictures on the cards of concrete meanings (v0.4 İP1 + İP2; decisions 0029 and
0030; style: [image-style.md](image-style.md)). Claude draws each picture as SVG; the server
sanitizes and checks it, and the owner approves it in the review screen before every user sees
it. Pictures belong to a lexicon sense, so one picture serves every user who has that meaning.

Code (all under `supabase/functions/_shared/` unless noted):

| File | What |
|---|---|
| `image-contract.ts` | shared contract with the client (palette, row shape, `ai-image` request/response, `IMAGE_RPC`) |
| `image-prompt.ts` | `image-v1`: system prompt, schema, `buildImageRequest`, `parseImageResponse`, redraw sentences |
| `visual-prompt.ts` | `visual-v1`: visualizability score and drawing hint |
| `image-check.ts` | contrast check, pixel coverage, `imagecheck-v1` (vision) |
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
submit (nightly): Message Batch of image-v1 requests (half price)
        ▼
collect (next night): sanitize → contrast → render light/dark → coverage → imagecheck-v1
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
4. `drawSense`: `image-v1` on `CLAUDE_IMAGE_MODEL` with the server-side refusal fallback,
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
2. **Contrast** (`contrastCheck`): the backdrop circle must be there; a subject colour must reach
   2:1 against the backdrop in both themes; colours under 1.4:1 (white, yellow, paper …) are
   allowed only on top of another shape. → `low_contrast`.
3. **Coverage** (Node only): rendered on the theme's backdrop, at least 4 % of the circle must
   differ visibly from it in both themes. → `low_contrast`.
4. **`imagecheck-v1`** (Node only, Haiku vision on both PNGs): text → `has_text`; wrong meaning
   or confidence < 0.6 → `wrong_meaning`; too busy → `clutter`; no verdict → `other`.

## Nightly jobs

`.github/workflows/images.yml`, 01:30 UTC: `collect`, then `visualize`, then `submit`
(`scripts/img-batch.ts`). On demand one job, or the pilot (`scripts/img-pilot.ts`: N random
nouns, verbs and adjectives with zipf ≥ 3, scored first when needed, drawn now, stored as
`review`, with the cost of each picture and the total; the report is kept as a workflow
artifact). Without `ANTHROPIC_API_KEY` the workflow ends with a notice.

Queue priority (higher first): 4000 owner "redraw"; 3000 + 100 per distinct user for user
requests; automatic ones 2000 in an admin's cards, 1000 + users in anyone's cards, otherwise
zipf × 10. The plan's CEFR-proximity ranking comes with İP9.

## Model calls

| Prompt | Model (env) | Thinking | Effort | `max_tokens` | Cache | Fallback |
|---|---|---|---|---|---|---|
| `image-v1` | `CLAUDE_IMAGE_MODEL` (default `claude-opus-5-5`) | adaptive | medium | 16000 | system, 1 h | server-side (instant and pilot; not batches) |
| `visual-v1` | `CLAUDE_CHECK_MODEL` (default `claude-haiku-5-5`) | adaptive | low | 8000 | system, 5 min | none |
| `imagecheck-v1` | `CLAUDE_CHECK_MODEL` | adaptive | low | 4000 | system, 5 min | none |

All three use structured output (`output_config.format`, JSON schema), no temperature and no
prefill. The model may decline: `image-v1` answers `drawable: false` when nothing sensible can be
drawn, and a refusal (`stop_reason: "refusal"`) is treated the same (`not_visual`). Model ids are
read only from the environment (`imageModels`); no other file names a model.

**Privacy.** The user turn of `image-v1` is exactly
`{"lemma", "pos", "gloss_tr", "visual_hint"}` (plus `previous_problem`, one of the fixed
sentences below, on a redraw); `visual-v1` gets numbered `{n, lemma, pos, gloss_tr}`;
`imagecheck-v1` gets `{lemma, pos, gloss_tr}` and the two PNGs. No ids, user data, card text or
example sentences reach the model. A snapshot test pins this.

## `image-v1`

### User turn

```json
{"lemma":"umbrella","pos":"noun","gloss_tr":"şemsiye","visual_hint":"an open umbrella in the rain"}
```

On a redraw, `previous_problem` is added with one of these sentences:

| Problem | Sentence |
|---|---|
| `wrong_meaning` | The previous drawing did not show this meaning clearly; a learner guessed another word. |
| `unclear` | The previous drawing was hard to read at a small size; use fewer, larger shapes. |
| `ugly` | The previous drawing did not match the style; follow the style rules and the parts library closely. |
| `has_text` | The previous drawing contained text or letter-like marks; use no text at all. |
| `clutter` | The previous drawing was too busy; keep one large subject and at most two cues. |
| `low_contrast` | The previous drawing used colours that vanish on the backdrop; put light colours only on top of other shapes. |
| `invalid_svg` | The previous SVG broke the SVG rules (elements, attributes or colours); follow them exactly. |
| `other` | The previous drawing was not accepted; draw it again more simply. |

### System prompt

```text
You draw small flashcard pictures for Turkish speakers learning English words. Each picture shows one meaning of one English word so that a learner who sees only the picture can recall the word.

You receive one meaning as JSON: lemma (the English word), pos (part of speech), gloss_tr (the Turkish meaning; draw exactly this meaning, not another sense of the word) and visual_hint (an optional English idea of what to draw, or null). A redraw also has previous_problem: what was wrong with the last attempt; avoid it.

## Style B: flat colour

- Flat filled shapes in the palette below. No outlines around shapes, no gradients, no shadows, no texture, no 3D.
- Lines appear only as shapes of their own (limbs, stems, handles, waves) with round caps and joins.
- Every picture starts with the soft backdrop circle (cx 128, cy 128, r 114). Keep everything inside it; a ground or a slope may be cut to the circle's edge with an arc.
- One clear subject, large and centred, filling about two thirds of the circle. At most one or two supporting cues (raindrops for an umbrella, water under a bridge).
- No text of any kind: no letters, digits, words, labels, signs with writing, speech bubbles with words, or symbols that stand for letters.
- People are simple figures: a skin-coloured circle head, limbs as thick blue strokes (stroke-width 12), far-side limbs in dark blue, no facial features unless the meaning is a feeling. No hair styles, no clothing details, no skin tones other than the skin colour.
- Feelings are a big round face; actions are a figure in mid-action; relations (between, under, behind) are simple blocks or balls with one faint arrow; abstract-but-drawable meanings use the most common everyday scene.
- Draw nothing frightening, violent, sexual, religious or political; for such words show a calm, neutral cue or decline.

## Colours

Use only these hex values (light theme; the app swaps each for its dark-theme twin). Each role has a purpose:
- #2b2824 ink: darkest detail: eyes, small marks on light shapes
- #5a5249 inkFlat: dark grey parts: handles, poles, tools, wheels
- #b8ae9f inkFaint: faint helpers: arrows, ground lines, steam, motion strokes
- #3a1a08 inkOnRed: features drawn on top of red or orange shapes
- #fffdf8 paper: off-white inner parts on top of a coloured shape (pages, plates)
- #e6edf5 soft: the backdrop circle only
- #ffffff white: snow, highlights (with opacity), teeth; only on top of another shape
- #d55e00 red: red things, danger, anger, heat, roofs
- #e69f00 orange: oranges, fire, warmth, bags, balls, the sun
- #f0e442 yellow: lemons, light, stars; only on top of a darker shape
- #009e73 green: leaves, plants, grass, "go"
- #56b4e9 sky: water drops, ice, sky, glass
- #2a6fb0 blue: main colour of people's clothes, water, cold, calm objects
- #1d5490 blueDark: shade side of blue things, far-side limbs
- #cc79a7 purple: flowers, fabric, magic, special objects
- #6b4a2b stem: wood, trunks, stems, brown hair, bread crust
- #cdbfa8 stone: stone, sand, walls, paper bags, light ground
- #a8977c stoneDark: shade side of stone, railings, metal
- #e9b98c skin: skin of hands and heads

Contrast: white, paper, yellow and soft are almost invisible on the backdrop, and ink-on-red is invisible in the dark theme: use them only on top of another shape, never directly on the backdrop.

## SVG rules

- Exactly one root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">. No width or height.
- Elements: g, path, circle, ellipse, rect, line, polyline, polygon. Nothing else: no defs, use, clipPath, mask, gradient, filter, pattern, text, image, style, title.
- Attributes: d, points, cx, cy, r, rx, ry, x, y, x1, y1, x2, y2, width, height, fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, transform, opacity, fill-opacity, stroke-opacity, fill-rule. No id, class, style or href.
- fill and stroke are always one of the palette hex values or none. Give every shape an explicit fill.
- Whole numbers or one decimal. Keep the SVG under 6 KB; around 1–3 KB is typical.

## Parts library

Reuse and adapt these parts (move, scale, recolour within the palette) so pictures look like one family.

### backdrop
Always the first element: the soft circle every picture sits on.
<circle cx="128" cy="128" r="114" fill="#e6edf5"/>

### ground
A faint floor line under standing things.
<rect x="34" y="202" width="188" height="8" rx="4" fill="#b8ae9f"/>

### person
A standing figure, front view: skin head, blue body and near limbs, dark-blue far limbs. Move the limb paths for actions.
<circle cx="128" cy="62" r="15" fill="#e9b98c"/><path d="M128 140 L116 186 M128 140 L140 186" fill="none" stroke="#1d5490" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M128 86 V140" fill="none" stroke="#2a6fb0" stroke-width="18" stroke-linecap="round"/><path d="M128 94 L104 124 M128 94 L152 124" fill="none" stroke="#2a6fb0" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>

### face
Feelings and states: a big round face in the feeling's colour; features in ink-on-red on red, ink on other colours.
<circle cx="128" cy="134" r="80" fill="#e69f00"/><circle cx="104" cy="126" r="7.5" fill="#2b2824"/><circle cx="152" cy="126" r="7.5" fill="#2b2824"/><path d="M100 160 C 112 176, 144 176, 156 160" fill="none" stroke="#2b2824" stroke-width="9" stroke-linecap="round"/>

### arrow
Direction, movement into or out of something, cause → effect. Faint, never the main shape.
<path d="M128 108 V 142 M116 131 L128 143 L140 131" fill="none" stroke="#b8ae9f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>

### motion
Speed or a quick movement: three short faint strokes behind the moving thing.
<path d="M52 110 H84 M44 128 H80 M52 146 H84" fill="none" stroke="#b8ae9f" stroke-width="6" stroke-linecap="round"/>

### water
Water, rivers, the sea: blue wave lines.
<path d="M70 202 q 14 -9 28 0 t 28 0 t 28 0 t 28 0" fill="none" stroke="#2a6fb0" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>

### raindrop
Rain, wetness, liquid.
<path d="M64 27 C 67 34, 71 38, 71 43 A 7 7 0 0 1 57 43 C 57 38, 61 34, 64 27 Z" fill="#56b4e9"/>

### sun
Sun, heat, daytime, summer.
<circle cx="128" cy="128" r="40" fill="#e69f00"/><path d="M128 64 V76 M128 180 V192 M64 128 H76 M180 128 H192 M83 83 L91 91 M165 165 L173 173 M83 173 L91 165 M165 91 L173 83" fill="none" stroke="#e69f00" stroke-width="8" stroke-linecap="round"/>

### tree
Trees, forests, nature, plants.
<rect x="120" y="138" width="16" height="64" rx="4" fill="#6b4a2b"/><circle cx="128" cy="104" r="44" fill="#009e73"/><circle cx="98" cy="128" r="26" fill="#009e73"/><circle cx="158" cy="128" r="26" fill="#009e73"/>

### house
Home, building, living somewhere.
<path d="M72 120 L128 74 L184 120 Z" fill="#d55e00"/><rect x="84" y="118" width="88" height="80" fill="#cdbfa8"/><rect x="116" y="150" width="24" height="48" rx="3" fill="#6b4a2b"/>

### highlight
A shine on round or glossy things. White with opacity, only on top of another shape.
<path d="M84 112 C 86 98, 96 90, 106 88" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" opacity="0.55"/>

### emphasis
Anger, shock, pain, a loud moment: a small red burst mark beside the subject.
<g fill="none" stroke="#d55e00" stroke-width="6" stroke-linecap="round"><path d="M186 40 C 188 50, 192 54, 202 56"/><path d="M218 40 C 216 50, 212 54, 202 56"/><path d="M186 72 C 188 62, 192 58, 202 56"/><path d="M218 72 C 216 62, 212 58, 202 56"/></g>

### no
Forbidden, not allowed, without: a red ring with a bar, drawn over the thing.
<circle cx="128" cy="128" r="72" fill="none" stroke="#d55e00" stroke-width="14"/><path d="M77 77 L179 179" fill="none" stroke="#d55e00" stroke-width="14" stroke-linecap="round"/>

## Answer

Answer with JSON only: {"drawable": boolean, "svg": string, "alt_tr": string, "confidence": number}.
- drawable: false when no picture can show this meaning without text or a misleading symbol (grammar words, most abstract nouns, "although", "whether"); then svg and alt_tr are "" and confidence is 0. Do not force a picture.
- svg: the picture.
- alt_tr: one short Turkish sentence (at most 120 characters) describing what is drawn, for screen readers. Never write the English word in it.
- confidence: 0 to 1, how likely a learner recognises the meaning from the picture alone.

## Approved examples

### apple (noun)
Input: {"lemma":"apple","pos":"noun","gloss_tr":"elma","visual_hint":null}
Idea: One whole object, centred and large: red body, green leaf, brown stem, a translucent white highlight.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"#2b2824\"><circle cx=\"128\" cy=\"128\" r=\"114\" fill=\"#e6edf5\"/><path d=\"M128 86 C 108 70, 62 72, 58 122 C 54 170, 92 214, 116 207 C 123 205, 133 205, 140 207 C 164 214, 202 170, 198 122 C 194 72, 148 70, 128 86 Z\" fill=\"#d55e00\"/><path d=\"M84 112 C 86 98, 96 90, 106 88\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\"0.55\"/><path d=\"M128 88 C 128 72, 131 60, 138 48\" fill=\"none\" stroke=\"#6b4a2b\" stroke-width=\"8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M136 66 C 146 46, 172 42, 184 50 C 174 68, 152 76, 136 66 Z\" fill=\"#009e73\"/></svg>","alt_tr":"Yeşil yapraklı kırmızı bir elma","confidence":0.9}

### bridge (noun)
Input: {"lemma":"bridge","pos":"noun","gloss_tr":"köprü","visual_hint":null}
Idea: The object in its minimal setting: a stone arch with a railing over two blue water lines.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"#2b2824\"><circle cx=\"128\" cy=\"128\" r=\"114\" fill=\"#e6edf5\"/><path d=\"M30 110 H226 V180 H202 C 202 146, 170 124, 128 124 C 86 124, 54 146, 54 180 H30 Z\" fill=\"#cdbfa8\"/><path d=\"M30 110 H226 V122 H30 Z\" fill=\"#a8977c\"/><path d=\"M34 84 H222 M40 84 V110 M72 84 V110 M104 84 V110 M152 84 V110 M184 84 V110 M216 84 V110\" fill=\"none\" stroke=\"#a8977c\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M70 202 q 14 -9 28 0 t 28 0 t 28 0 t 28 0\" fill=\"none\" stroke=\"#2a6fb0\" stroke-width=\"6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M96 224 q 14 -9 28 0 t 28 0\" fill=\"none\" stroke=\"#2a6fb0\" stroke-width=\"6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>","alt_tr":"Suyun üzerinde taş kemerli bir köprü","confidence":0.9}

### climb (verb)
Input: {"lemma":"climb","pos":"verb","gloss_tr":"tırmanmak","visual_hint":"a person going up a steep mountain"}
Idea: An action: a small figure (skin head, blue limbs, darker far-side limbs, orange backpack) mid-step on a slope that ends at a flag on the summit; the slope is cut to the backdrop circle.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"#2b2824\"><circle cx=\"128\" cy=\"128\" r=\"114\" fill=\"#e6edf5\"/><path d=\"M43.7 204.7 L200 64 L241.9 122.3 A114 114 0 0 1 43.7 204.7 Z\" fill=\"#cdbfa8\"/><path d=\"M200 64 L186 79 L194 77 L199 85 L206 76 L214 80 Z\" fill=\"#ffffff\"/><path d=\"M200 66 V30\" fill=\"none\" stroke=\"#5a5249\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M200 31 L226 38 L200 45 Z\" fill=\"#d55e00\"/><path d=\"M118 90 L134 127\" fill=\"none\" stroke=\"#6b4a2b\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"77\" y=\"92\" width=\"18\" height=\"28\" rx=\"5\" transform=\"rotate(22 86 106)\" fill=\"#e69f00\"/><path d=\"M92 126 L 86 150 L 79 172\" fill=\"none\" stroke=\"#1d5490\" stroke-width=\"12\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M102 100 L 92 114\" fill=\"none\" stroke=\"#1d5490\" stroke-width=\"12\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M92 126 L 112 125 L 113 145\" fill=\"none\" stroke=\"#2a6fb0\" stroke-width=\"12\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M92 126 L 104 95\" fill=\"none\" stroke=\"#2a6fb0\" stroke-width=\"16\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M104 96 L 116 108 L 123 106\" fill=\"none\" stroke=\"#2a6fb0\" stroke-width=\"12\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"111\" cy=\"78\" r=\"13\" fill=\"#e9b98c\"/></svg>","alt_tr":"Sırt çantalı biri dik bir dağa tırmanıyor","confidence":0.9}

### angry (adjective)
Input: {"lemma":"angry","pos":"adjective","gloss_tr":"kızgın","visual_hint":null}
Idea: A feeling as a face: a red round face with dark slanted brows and a downturned mouth, a red anger mark and two steam curls.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"#2b2824\"><circle cx=\"128\" cy=\"128\" r=\"114\" fill=\"#e6edf5\"/><circle cx=\"128\" cy=\"134\" r=\"80\" fill=\"#d55e00\"/><path d=\"M86 104 L 114 118 M170 104 L 142 118\" fill=\"none\" stroke=\"#3a1a08\" stroke-width=\"9\" stroke-linecap=\"round\"/><circle cx=\"104\" cy=\"136\" r=\"7.5\" fill=\"#3a1a08\"/><circle cx=\"152\" cy=\"136\" r=\"7.5\" fill=\"#3a1a08\"/><path d=\"M100 184 C 112 168, 144 168, 156 184\" fill=\"none\" stroke=\"#3a1a08\" stroke-width=\"9\" stroke-linecap=\"round\"/><g fill=\"none\" stroke=\"#d55e00\" stroke-width=\"6\" stroke-linecap=\"round\"><path d=\"M186 40 C 188 50, 192 54, 202 56\"/><path d=\"M218 40 C 216 50, 212 54, 202 56\"/><path d=\"M186 72 C 188 62, 192 58, 202 56\"/><path d=\"M218 72 C 216 62, 212 58, 202 56\"/></g><path d=\"M46 70 c -8 -10 6 -18 0 -28 M62 58 c -8 -10 6 -18 0 -28\" fill=\"none\" stroke=\"#b8ae9f\" stroke-width=\"5\" stroke-linecap=\"round\"/></svg>","alt_tr":"Kaşları çatık, kızgın kırmızı bir yüz","confidence":0.9}

### between (preposition)
Input: {"lemma":"between","pos":"preposition","gloss_tr":"arasında","visual_hint":"an object in the middle of two others"}
Idea: A relation: two identical blue blocks with an orange ball in the gap, a faint arrow pointing into the gap, a faint ground line.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"#2b2824\"><circle cx=\"128\" cy=\"128\" r=\"114\" fill=\"#e6edf5\"/><rect x=\"34\" y=\"202\" width=\"188\" height=\"8\" rx=\"4\" fill=\"#b8ae9f\"/><rect x=\"30\" y=\"86\" width=\"52\" height=\"116\" rx=\"8\" fill=\"#2a6fb0\"/><rect x=\"174\" y=\"86\" width=\"52\" height=\"116\" rx=\"8\" fill=\"#2a6fb0\"/><circle cx=\"128\" cy=\"178\" r=\"22\" fill=\"#e69f00\"/><path d=\"M116 170 a 14 14 0 0 1 10 -8\" fill=\"none\" stroke=\"#ffffff\" opacity=\"0.55\" stroke-width=\"5\" stroke-linecap=\"round\"/><g fill=\"none\" stroke=\"#b8ae9f\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M128 108 V 142 M116 131 L128 143 L140 131\"/></g></svg>","alt_tr":"İki mavi blok arasında turuncu bir top","confidence":0.9}

### umbrella (noun)
Input: {"lemma":"umbrella","pos":"noun","gloss_tr":"şemsiye","visual_hint":null}
Idea: The object with one cue of its use: an open blue umbrella with darker panels, a dark handle and a few sky-blue raindrops.
Output: {"drawable":true,"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"#2b2824\"><circle cx=\"128\" cy=\"128\" r=\"114\" fill=\"#e6edf5\"/><path d=\"M64 27 C 67 34, 71 38, 71 43 A 7 7 0 0 1 57 43 C 57 38, 61 34, 64 27 Z\" fill=\"#56b4e9\"/><path d=\"M200 17 C 203 24, 207 28, 207 33 A 7 7 0 0 1 193 33 C 193 28, 197 24, 200 17 Z\" fill=\"#56b4e9\"/><path d=\"M36 81.6 C 38.4 87.2, 41.6 90.4, 41.6 94.4 A 5.6000000000000005 5.6000000000000005 0 0 1 30.4 94.4 C 30.4 90.4, 33.6 87.2, 36 81.6 Z\" fill=\"#56b4e9\"/><path d=\"M222 75.6 C 224.4 81.2, 227.6 84.4, 227.6 88.4 A 5.6000000000000005 5.6000000000000005 0 0 1 216.4 88.4 C 216.4 84.4, 219.6 81.2, 222 75.6 Z\" fill=\"#56b4e9\"/><path d=\"M128 52 V 194 C 128 214, 102 214, 102 196\" fill=\"none\" stroke=\"#5a5249\" stroke-width=\"8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M36 134 C 36 82, 80 52, 128 52 C 176 52, 220 82, 220 134 Q 197 116 174 134 Q 151 116 128 134 Q 105 116 82 134 Q 59 116 36 134 Z\" fill=\"#2a6fb0\"/><path d=\"M82 132 C 84 92, 104 62, 128 54 C 104 70, 92 100, 92 126 Z\" fill=\"#1d5490\"/><path d=\"M174 132 C 172 92, 152 62, 128 54 C 152 70, 164 100, 164 126 Z\" fill=\"#1d5490\"/><path d=\"M128 52 V 38\" fill=\"none\" stroke=\"#5a5249\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>","alt_tr":"Yağmurda açık mavi bir şemsiye","confidence":0.9}
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

## `imagecheck-v1`

### System prompt

```text
You review small flashcard pictures for Turkish speakers learning English words. Each picture should let a learner recall one meaning of one English word from the picture alone.

You get the meaning as JSON (lemma: the English word, pos: part of speech, gloss_tr: the Turkish meaning) and the same picture twice: on the light theme, then on the dark theme.

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
