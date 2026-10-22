// @vitest-environment node
import type Anthropic from '@anthropic-ai/sdk';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors.ts';
import { aiImageResponse, type ImageRequestInput } from './image-contract.ts';
import { runAiImage } from './image-instant.ts';
import { callCostUsd } from './image-models.ts';
import {
  drawSense,
  type CalledMessage,
  type PipelineDeps,
  type Rendered,
} from './image-pipeline.ts';
import { IMAGE_SYSTEM_PROMPT, REDRAW_PROBLEMS } from './image-prompt.ts';
import { BAD_SVG, DECLINED, drawing, PALE, REFUSAL, verdict } from './testing/image-fixtures.ts';
import { BudgetLedger, MemoryImageStore } from './testing/memory-image-store.ts';

const SENSE = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const INPUT: ImageRequestInput = {
  sense_id: SENSE,
  lemma: 'umbrella',
  pos: 'noun',
  gloss_tr: 'şemsiye',
  visual_hint: null,
};
const MODELS = { image: 'claude-opus-5-5', check: 'claude-haiku-5-5' };

type Call = { params: Anthropic.MessageCreateParamsNonStreaming; fallback: boolean };

/** A scripted Claude: answers in order, records every request. */
function scripted(...answers: (CalledMessage | Error)[]) {
  const calls: Call[] = [];
  const fn = vi.fn(
    async (params: Anthropic.MessageCreateParamsNonStreaming, opts: { fallback: boolean }) => {
      calls.push({ params, fallback: opts.fallback });
      const a = answers.shift();
      if (!a) throw new Error('unexpected call');
      if (a instanceof Error) throw a;
      return a;
    },
  );
  return { fn, calls };
}

function deps(
  store: MemoryImageStore,
  claude: PipelineDeps['claude'],
  o: Partial<PipelineDeps> = {},
): PipelineDeps {
  return {
    claude,
    models: MODELS,
    store,
    capUsd: 80,
    purpose: 'instant',
    fallback: true,
    render: null,
    passStatus: 'review',
    ...o,
  };
}

const rendered = (coverage = 0.3): Rendered => ({
  light: { png: 'TElHSFQ=', coverage },
  dark: { png: 'REFSSw==', coverage },
});

const userText = (c: Call) => c.params.messages[0]!.content;

describe('drawSense', () => {
  it('stores a passing drawing for review with the vision check pending (no renderer)', async () => {
    const store = new MemoryImageStore();
    const { fn, calls } = scripted(drawing());
    const out = await drawSense(INPUT, deps(store, fn));
    expect(out.outcome).toBe('image');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fallback).toBe(true);
    expect(store.images).toHaveLength(1);
    const row = store.images[0]!;
    expect(row).toMatchObject({ status: 'review', variant: 0, model: 'claude-opus-5-5' });
    expect(row.checks).toMatchObject({ sanitize: 'ok', vision: 'pending', attempt: 1 });
    expect(row.cost_usd).toBe(callCostUsd('claude-opus-5-5', drawing().usage));
    expect(store.ledger.spent).toBe(row.cost_usd);
    expect(store.ledger.reserved).toBe(0);
    expect(store.ledger.holds.size).toBe(0);
  });

  it('redraws once with the fixed problem sentence, keeping the failed attempt as rejected', async () => {
    const store = new MemoryImageStore();
    const { fn, calls } = scripted(BAD_SVG, drawing());
    const out = await drawSense(INPUT, deps(store, fn));
    expect(out).toMatchObject({ outcome: 'image', attempts: 2 });
    expect(store.images.map((i) => i.status)).toEqual(['rejected', 'review']);
    expect(store.images[0]!.checks).toMatchObject({
      sanitize: 'element:script',
      problem: 'invalid_svg',
    });
    expect(store.images[0]!.svg).toBe('');
    expect(JSON.parse(userText(calls[1]!) as string)).toMatchObject({
      previous_problem: REDRAW_PROBLEMS.invalid_svg,
    });
  });

  it('rejects after the second failure', async () => {
    const store = new MemoryImageStore();
    const { fn } = scripted(PALE, PALE);
    const out = await drawSense(INPUT, deps(store, fn));
    expect(out).toMatchObject({ outcome: 'failed', attempts: 2, problem: 'low_contrast' });
    expect(store.images.map((i) => i.status)).toEqual(['rejected', 'rejected']);
    expect(store.images.every((i) => i.cost_usd > 0)).toBe(true);
  });

  it('a declined or refused drawing is not_visual and stores nothing', async () => {
    for (const answer of [DECLINED, REFUSAL]) {
      const store = new MemoryImageStore();
      const out = await drawSense(INPUT, deps(store, scripted(answer).fn));
      expect(out.outcome).toBe('not_visual');
      expect(store.images).toHaveLength(0);
      expect(store.ledger.spent).toBeGreaterThan(0); // the call is still paid
    }
  });

  it('refuses before calling when the budget cannot cover the call', async () => {
    const store = new MemoryImageStore();
    const { fn } = scripted();
    const out = await drawSense(INPUT, deps(store, fn, { capUsd: 0.01 }));
    expect(out.outcome).toBe('budget');
    expect(fn).not.toHaveBeenCalled();
  });

  it('settles a failed request at 0 and rethrows', async () => {
    const store = new MemoryImageStore();
    const { fn } = scripted(new Error('overloaded'));
    await expect(drawSense(INPUT, deps(store, fn))).rejects.toThrow('overloaded');
    expect(store.ledger).toMatchObject({ spent: 0, reserved: 0 });
  });

  it('with a renderer: vision check passes', async () => {
    const store = new MemoryImageStore();
    const { fn, calls } = scripted(drawing(), verdict());
    const out = await drawSense(
      INPUT,
      deps(store, fn, {
        render: () => rendered(),
        passStatus: 'review',
        fallback: false,
        purpose: 'pilot',
      }),
    );
    expect(out.outcome).toBe('image');
    expect(calls.map((c) => c.params.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
    expect(calls.every((c) => !c.fallback)).toBe(true);
    const row = store.images[0]!;
    expect(row.checks).toMatchObject({
      vision: { depicts_sense: true },
      coverage: { light: 0.3, dark: 0.3 },
    });
    expect(row.cost_usd).toBeCloseTo(
      callCostUsd('claude-opus-5-5', drawing().usage) +
        callCostUsd('claude-haiku-5-5', verdict().usage),
      6,
    );
    expect(store.purposes).toEqual(['pilot', 'check']);
  });

  it('with a renderer: a wrong meaning is redrawn, text is redrawn, low coverage fails', async () => {
    const store = new MemoryImageStore();
    const { fn, calls } = scripted(
      drawing(),
      verdict({ depicts_sense: false }),
      drawing(),
      verdict({ has_text: true }),
    );
    const out = await drawSense(INPUT, deps(store, fn, { render: () => rendered() }));
    expect(out).toMatchObject({ outcome: 'failed', problem: 'has_text' });
    expect(JSON.parse(userText(calls[2]!) as string).previous_problem).toBe(
      REDRAW_PROBLEMS.wrong_meaning,
    );

    const s2 = new MemoryImageStore();
    const out2 = await drawSense(
      INPUT,
      deps(s2, scripted(drawing(), drawing()).fn, { render: () => rendered(0.01) }),
    );
    expect(out2).toMatchObject({ outcome: 'failed', problem: 'low_contrast' });
  });
});

describe('ai-image (runAiImage)', () => {
  function setup(answers: (CalledMessage | Error)[], o: { cap?: number; limit?: number } = {}) {
    const store = new MemoryImageStore();
    store.senses.set(SENSE, INPUT);
    store.cards.set(USER, new Set([SENSE]));
    const s = scripted(...answers);
    const run = (body: unknown = { sense_id: SENSE }) =>
      runAiImage(body, {
        userId: USER,
        store,
        claude: () => s.fn,
        models: MODELS,
        capUsd: o.cap ?? 80,
        dailyLimit: o.limit ?? 10,
      });
    return { store, run, calls: s.calls };
  }

  it('draws now and answers per the contract', async () => {
    const { store, run, calls } = setup([drawing()]);
    const res = await run();
    expect(aiImageResponse.parse(res)).toEqual(res);
    expect(res).toMatchObject({ ok: true, image: { sense_id: SENSE, status: 'review' } });
    expect(res.ok && 'cost_usd' in res.image).toBe(false);
    expect(store.requests.get(SENSE)).toMatchObject({ state: 'done' });
    expect(calls[0]!.fallback).toBe(true);
  });

  it('privacy: the model gets only the fixed system prompt and the four meaning fields', async () => {
    const { run, calls } = setup([BAD_SVG, drawing()]);
    await run();
    for (const c of calls) {
      expect(c.params.system).toEqual([
        {
          type: 'text',
          text: IMAGE_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ]);
      expect(c.params.messages).toHaveLength(1);
      const keys = Object.keys(JSON.parse(userText(c) as string) as object);
      expect(keys.slice(0, 4)).toEqual(['lemma', 'pos', 'gloss_tr', 'visual_hint']);
      expect(keys.slice(4).every((k) => k === 'previous_problem')).toBe(true);
      expect(JSON.stringify(c.params)).not.toContain(USER);
      expect(JSON.stringify(c.params)).not.toContain(SENSE);
    }
  });

  it('daily limit, budget, not visual, failed', async () => {
    const a = setup([drawing()], { limit: 1 });
    await a.run();
    expect(await a.run()).toEqual({ ok: false, reason: 'daily_limit' });

    const b = setup([], { cap: 0.01 });
    expect(await b.run()).toEqual({ ok: false, reason: 'budget' });
    expect(b.store.daily.get(USER)).toBeUndefined(); // a spent budget does not use a daily picture

    const c = setup([DECLINED]);
    expect(await c.run()).toEqual({ ok: false, reason: 'not_visual' });
    expect(c.store.requests.get(SENSE)).toMatchObject({ state: 'skipped' });

    const d = setup([PALE, PALE]);
    expect(await d.run()).toEqual({ ok: false, reason: 'failed' });
  });

  it("refuses bad input and senses outside the user's cards", async () => {
    const { run, store } = setup([]);
    await expect(run({ sense_id: 'nope' })).rejects.toBeInstanceOf(ApiError);
    await expect(run({ sense_id: '55555555-5555-4555-8555-555555555555' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(store.ledger.holds.size).toBe(0);
  });

  it('a provider error is ai_failed', async () => {
    const { run } = setup([new Error('boom')]);
    await expect(run()).rejects.toMatchObject({ code: 'ai_failed' });
  });
});

describe('budget guard (property)', () => {
  it('never lets spent + reserved pass the cap, under any interleaving of concurrent calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 200 }).map((n) => n / 2), // cap 0..100 USD
        fc.array(
          fc.record({
            amount: fc.integer({ min: 1, max: 40_000 }).map((n) => n / 1000),
            used: fc.double({ min: 0, max: 1, noNaN: true }),
            delay: fc.integer({ min: 0, max: 3 }),
          }),
          { maxLength: 40 },
        ),
        async (cap, calls) => {
          const ledger = new BudgetLedger();
          const tick = () => new Promise<void>((r) => setTimeout(r, 0));
          const check = () => {
            expect(ledger.spent + ledger.reserved).toBeLessThanOrEqual(cap + 1e-9);
          };
          await Promise.all(
            calls.map(async (c) => {
              for (let i = 0; i < c.delay; i++) await tick();
              const hold = ledger.reserve(c.amount, cap);
              check();
              if (!hold) return;
              await tick();
              // The real cost never exceeds the reserved upper bound (tested in image-prompt.test.ts).
              ledger.settle(hold, Math.round(c.amount * c.used * 1e6) / 1e6);
              check();
            }),
          );
          expect(ledger.reserved).toBe(0);
          expect(ledger.spent).toBeLessThanOrEqual(cap + 1e-9);
        },
      ),
      { numRuns: 200 },
    );
  });
});
