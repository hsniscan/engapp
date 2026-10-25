// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  contrastCheck,
  contrastRatio,
  buildCheckRequest,
  parseCheckResponse,
  verdictProblem,
  BACKDROP_CIRCLE,
} from './image-check.ts';
import { IMAGE_PALETTE, IMAGE_PROMPT_VERSION, type ImageRequestInput } from './image-contract.ts';
import {
  callCostUsd,
  imageModels,
  monthlyCapUsd,
  reserveUsd,
  tokenBound,
  DEFAULT_CHECK_MODEL,
  DEFAULT_IMAGE_MODEL,
} from './image-models.ts';
import { IMAGE_PARTS } from './image-parts.ts';
import {
  buildImageRequest,
  imageUserContent,
  parseImageResponse,
  withServerFallback,
  IMAGE_SYSTEM_PROMPT,
  REDRAW_PROBLEMS,
  SERVER_FALLBACK_BETA,
} from './image-prompt.ts';
import { IMAGE_REFS } from './image-refs.ts';
import { sanitizeSvg } from './svg-sanitize.ts';
import { buildVisualRequest, parseVisualResponse, VISUAL_SYSTEM_PROMPT } from './visual-prompt.ts';

const INPUT: ImageRequestInput = {
  sense_id: '11111111-1111-4111-8111-111111111111',
  lemma: 'umbrella',
  pos: 'noun',
  gloss_tr: 'şemsiye',
  visual_hint: 'an open umbrella in the rain',
};

const msg = (text: string, stop_reason = 'end_turn') => ({
  stop_reason,
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text },
  ],
});

describe('image-v1 request (privacy, acceptance criterion 5)', () => {
  it('sends only the fixed system prompt and {lemma, pos, gloss_tr, visual_hint}', () => {
    const req = buildImageRequest(INPUT, { model: 'm' });
    expect(req).toEqual({
      model: 'm',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: expect.any(Object) },
      },
      system: [
        {
          type: 'text',
          text: IMAGE_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],
      messages: [
        {
          role: 'user',
          content:
            '{"lemma":"umbrella","pos":"noun","gloss_tr":"şemsiye","visual_hint":"an open umbrella in the rain"}',
        },
      ],
    });
    const user = JSON.parse(req.messages[0]!.content as string) as Record<string, unknown>;
    expect(Object.keys(user)).toEqual(['lemma', 'pos', 'gloss_tr', 'visual_hint']);
    expect(JSON.stringify(req)).not.toContain(INPUT.sense_id);
    expect(req).not.toHaveProperty('temperature');
    expect(req).not.toHaveProperty('top_p');
    expect(req.messages.every((m) => m.role === 'user')).toBe(true); // no prefill
  });

  it('ignores any extra field smuggled into the input', () => {
    const sneaky = {
      ...INPUT,
      source_sentence: 'My private sentence',
      user_id: 'u',
    } as ImageRequestInput;
    expect(imageUserContent(sneaky)).toBe(imageUserContent(INPUT));
  });

  it('adds only a fixed sentence on a redraw', () => {
    const c = JSON.parse(imageUserContent(INPUT, 'has_text')) as Record<string, unknown>;
    expect(Object.keys(c)).toEqual(['lemma', 'pos', 'gloss_tr', 'visual_hint', 'previous_problem']);
    expect(c.previous_problem).toBe(REDRAW_PROBLEMS.has_text);
  });

  it('the instant path adds the server-side fallback', () => {
    const req = withServerFallback(buildImageRequest(INPUT, { model: 'm' }));
    expect(req.betas).toEqual([SERVER_FALLBACK_BETA]);
    expect(req.fallbacks).toBe('default');
  });

  it('the system prompt carries the style, the parts and the references, and nothing variable', () => {
    for (const p of IMAGE_PARTS) expect(IMAGE_SYSTEM_PROMPT).toContain(p.svg);
    for (const r of IMAGE_REFS) expect(IMAGE_SYSTEM_PROMPT).toContain(JSON.stringify(r.svg));
    for (const [light] of Object.values(IMAGE_PALETTE))
      expect(IMAGE_SYSTEM_PROMPT).toContain(light);
    expect(IMAGE_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(IMAGE_PROMPT_VERSION).toBe('image-v1');
  });
});

describe('parts library and references', () => {
  it.each(IMAGE_PARTS.map((p) => [p.name, p] as const))(
    '%s passes the sanitizer on the backdrop',
    (_n, p) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${BACKDROP_CIRCLE}${p.svg}</svg>`;
      expect(sanitizeSvg(svg).ok).toBe(true);
    },
  );

  it.each(IMAGE_REFS.map((r) => [r.slug, r] as const))('%s passes the contrast check', (_s, r) => {
    expect(contrastCheck(r.svg)).toMatchObject({ ok: true, problem: null });
  });
});

describe('parseImageResponse', () => {
  const answer = (o: Record<string, unknown>) =>
    JSON.stringify({
      drawable: true,
      svg: IMAGE_REFS[0]!.svg,
      alt_tr: 'Bir elma',
      confidence: 0.8,
      ...o,
    });

  it('reads a picture (thinking blocks are skipped)', () => {
    expect(parseImageResponse(msg(answer({})))).toEqual({
      kind: 'image',
      image: { svg: IMAGE_REFS[0]!.svg, alt_tr: 'Bir elma', confidence: 0.8 },
    });
  });

  it('clamps the confidence', () => {
    const r = parseImageResponse(msg(answer({ confidence: 4 })));
    expect(r.kind === 'image' && r.image.confidence).toBe(1);
  });

  it('declined, refused and broken answers', () => {
    expect(parseImageResponse(msg(answer({ drawable: false, svg: '', alt_tr: '' })))).toEqual({
      kind: 'declined',
    });
    expect(parseImageResponse({ stop_reason: 'refusal', content: [] })).toEqual({
      kind: 'refused',
    });
    expect(parseImageResponse(msg('{"drawable": tr', 'max_tokens'))).toEqual({
      kind: 'invalid',
      reason: 'max_tokens',
    });
    expect(parseImageResponse(msg('not json'))).toEqual({ kind: 'invalid', reason: 'not_json' });
    expect(parseImageResponse(msg('{"svg": 1}'))).toEqual({ kind: 'invalid', reason: 'bad_shape' });
    expect(parseImageResponse(msg(answer({ alt_tr: '' })))).toEqual({
      kind: 'invalid',
      reason: 'bad_shape',
    });
  });
});

describe('visual-v1', () => {
  const items = [
    { sense_id: 'a', lemma: 'apple', pos: 'noun', gloss_tr: 'elma' },
    { sense_id: 'b', lemma: 'although', pos: 'conjunction', gloss_tr: 'rağmen' },
    { sense_id: 'c', lemma: 'climb', pos: 'verb', gloss_tr: 'tırmanmak' },
  ];

  it('numbers the senses and sends no ids', () => {
    const req = buildVisualRequest(items, { model: 'h' });
    expect(req.messages[0]!.content).toBe(
      '[{"n":1,"lemma":"apple","pos":"noun","gloss_tr":"elma"},{"n":2,"lemma":"although","pos":"conjunction","gloss_tr":"rağmen"},{"n":3,"lemma":"climb","pos":"verb","gloss_tr":"tırmanmak"}]',
    );
    expect(req.system).toEqual([
      { type: 'text', text: VISUAL_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ]);
    expect(() => buildVisualRequest([], { model: 'h' })).toThrow();
  });

  it('maps numbers back, drops junk and keeps hints only for drawable meanings', () => {
    const out = parseVisualResponse(
      msg(
        JSON.stringify({
          items: [
            { n: 1, score: 3, hint: 'a red apple  <b>' },
            { n: 2, score: 0, hint: 'ignored' },
            { n: 2, score: 3, hint: 'duplicate' },
            { n: 9, score: 2, hint: 'out of range' },
            { n: 3, score: 7, hint: 'bad score' },
          ],
        }),
      ),
      items,
    );
    expect(out).toEqual([
      { sense_id: 'a', score: 3, hint: 'a red apple b' },
      { sense_id: 'b', score: 0, hint: null },
    ]);
    expect(parseVisualResponse({ stop_reason: 'refusal', content: [] }, items)).toEqual([]);
    expect(parseVisualResponse(msg('nope'), items)).toEqual([]);
  });
});

describe('imagecheck-v1', () => {
  it('shows the meaning (no hint) and both renders', () => {
    const req = buildCheckRequest(INPUT, { light: 'TElHSFQ=', dark: 'REFSSw==' }, { model: 'h' });
    const content = req.messages[0]!.content as { type: string }[];
    expect(content.map((c) => c.type)).toEqual(['text', 'image', 'image']);
    expect(content[0]).toEqual({
      type: 'text',
      text: '{"lemma":"umbrella","pos":"noun","gloss_tr":"şemsiye"}',
    });
  });

  it('reads the verdict and names the first problem', () => {
    const v = (o: Record<string, unknown>) =>
      parseCheckResponse(
        msg(
          JSON.stringify({
            depicts_sense: true,
            has_text: false,
            clutter: false,
            confidence: 0.9,
            ...o,
          }),
        ),
      );
    expect(verdictProblem(v({})!)).toBeNull();
    expect(verdictProblem(v({ has_text: true, depicts_sense: false })!)).toBe('has_text');
    expect(verdictProblem(v({ depicts_sense: false })!)).toBe('wrong_meaning');
    expect(verdictProblem(v({ confidence: 0.3 })!)).toBe('wrong_meaning');
    expect(verdictProblem(v({ clutter: true })!)).toBe('clutter');
    expect(v({ confidence: 2 })).toBeNull();
    expect(parseCheckResponse({ stop_reason: 'refusal', content: [] })).toBeNull();
  });
});

describe('contrastCheck', () => {
  const H = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#2b2824">';
  it('needs the backdrop and one colour that stands out in both themes', () => {
    expect(contrastCheck(`${H}<circle cx="1" cy="1" r="40" fill="#d55e00"/></svg>`).problem).toBe(
      'no_backdrop',
    );
    const pale = contrastCheck(
      `${H}${BACKDROP_CIRCLE}<circle cx="128" cy="128" r="40" fill="#ffffff"/><rect width="9" height="9" fill="#f0e442"/></svg>`,
    );
    expect(pale.problem).toBe('low_contrast');
    expect(pale.detail).toEqual(['#ffffff', '#f0e442']);
  });

  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#d55e00', '#d55e00')).toBe(1);
  });
});

describe('models and prices', () => {
  it('reads model ids from the environment only', () => {
    expect(imageModels(() => undefined)).toEqual({
      image: DEFAULT_IMAGE_MODEL,
      check: DEFAULT_CHECK_MODEL,
    });
    const env = { CLAUDE_IMAGE_MODEL: 'x', CLAUDE_CHECK_MODEL: ' y ' } as Record<string, string>;
    expect(imageModels((k) => env[k])).toEqual({ image: 'x', check: 'y' });
  });

  it('prices usage with caching, batches and fallbacks', () => {
    expect(callCostUsd('claude-opus-5-5', { input_tokens: 1000, output_tokens: 2000 })).toBe(0.044);
    expect(
      callCostUsd('claude-opus-5-5', {
        input_tokens: 100,
        output_tokens: 1000,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 0,
      }),
    ).toBe(0.0214);
    expect(
      callCostUsd('claude-opus-5-5', {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 5000,
        cache_creation: { ephemeral_1h_input_tokens: 5000, ephemeral_5m_input_tokens: 0 },
      }),
    ).toBe(0.04);
    expect(
      callCostUsd('claude-opus-5-5', { input_tokens: 1000, output_tokens: 2000 }, { batch: true }),
    ).toBe(0.022);
    expect(
      callCostUsd('claude-opus-5-5', {
        input_tokens: 2000,
        output_tokens: 3000,
        iterations: [
          { type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 1000 },
          {
            type: 'fallback_message',
            model: 'claude-opus-4-8',
            input_tokens: 1000,
            output_tokens: 2000,
          },
        ],
      }),
    ).toBe(0.024 + 0.055);
    expect(callCostUsd('claude-opus-5-5', null)).toBe(0);
  });

  it('the reservation is never below the real cost of a call within its limits', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('claude-opus-5-5', 'claude-haiku-5-5', 'unknown-model'),
        fc.integer({ min: 0, max: 20000 }),
        fc.integer({ min: 0, max: 16000 }),
        fc.integer({ min: 0, max: 20000 }),
        fc.boolean(),
        (model, input, output, cacheSplit, batch) => {
          const cached = Math.min(cacheSplit, input);
          const usage = {
            input_tokens: input - cached,
            output_tokens: output,
            cache_creation_input_tokens: cached,
            cache_creation: { ephemeral_1h_input_tokens: cached },
          };
          const cost = callCostUsd(model, usage, { batch });
          expect(
            reserveUsd(model, { inputTokens: input, maxTokens: 16000, batch }),
          ).toBeGreaterThanOrEqual(cost);
        },
      ),
    );
  });

  it('caps the budget at 80 % of the monthly credit', () => {
    expect(monthlyCapUsd(() => undefined)).toBe(80);
    expect(monthlyCapUsd((k) => (k === 'CLAUDE_MONTHLY_CREDIT_USD' ? '200' : undefined))).toBe(160);
    expect(monthlyCapUsd(() => 'abc')).toBe(80);
    expect(tokenBound('x'.repeat(300))).toBe(164);
  });
});
