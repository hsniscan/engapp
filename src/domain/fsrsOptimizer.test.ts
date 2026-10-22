import fc from 'fast-check';
import { default_w } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { simulateLogs } from '../test/fsrsSim';
import { makeLog } from '../test/factories';
import { createScheduler } from './fsrs';
import {
  buildDataset,
  clipToBounds,
  evaluate,
  MIN_REVIEWS,
  memoryStateOf,
  normalizeParams,
  optimizeParams,
  PARAM_COUNT,
  REOPTIMIZE_AFTER_MS,
  shouldSuggest,
  type Trainer,
} from './fsrsOptimizer';
import { replayCard } from './recompute';
import type { RatingValue } from './types';

const DEFAULTS = [...default_w];
/** A learner who forgets faster and finds first answers harder than the defaults assume. */
const LEARNER = clipToBounds(
  DEFAULTS.map((v, i) =>
    i === 0 ? 0.1 : i === 2 ? 1.2 : i === 3 ? 4 : i === 8 ? 1.5 : i === 20 ? 0.35 : v,
  ),
);
const input = { current: null, request_retention: 0.9, daily_new_limit: 10 };

describe('normalizeParams', () => {
  it('null is the ts-fsrs FSRS-6 default (21 weights)', () => {
    expect(normalizeParams(null)).toEqual(DEFAULTS);
    expect(normalizeParams(null)).toHaveLength(PARAM_COUNT);
  });

  it('older 19-weight sets are migrated the way the scheduler does', () => {
    const w = normalizeParams(DEFAULTS.slice(0, 19));
    expect(w).toHaveLength(21);
    expect(w[20]).toBe(0.5);
  });
});

describe('memory model', () => {
  it('matches ts-fsrs replay for any answer history', () => {
    const T = Date.UTC(2026, 0, 1, 8);
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 40 * 24 * 60 })),
          {
            minLength: 1,
            maxLength: 25,
          },
        ),
        fc.boolean(),
        (answers, personal) => {
          const w = personal ? LEARNER : DEFAULTS;
          const scheduler = createScheduler({
            request_retention: 0.9,
            fsrs_params: personal ? LEARNER : null,
          });
          let at = T;
          const logs = answers.map(([g, gapMin], i) => {
            at += i === 0 ? 0 : gapMin * 60_000 + 1000;
            return makeLog({ card_id: 'c', reviewed_at: at, rating: g as RatingValue });
          });
          const { fsrs } = replayCard(scheduler, { id: 'c', created_at: T }, logs);
          const days = logs.map((l) => Math.floor(l.reviewed_at / 86_400_000));
          const ours = memoryStateOf(
            w,
            logs.map((l, i) => [l.rating, i === 0 ? 0 : days[i]! - days[i - 1]!] as const),
          )!;
          // ts-fsrs rounds to 8 decimals at every step; we do not.
          expect(Math.abs(ours.stability - fsrs.stability)).toBeLessThan(
            1e-6 * Math.max(1, fsrs.stability),
          );
          expect(ours.difficulty).toBeCloseTo(fsrs.difficulty, 5);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Training is CPU-bound: generous timeouts so a busy CI machine does not fail them.
describe('optimizeParams', { timeout: 60_000 }, () => {
  it('learns a learner that differs from the defaults and adopts it (better on held-out reviews)', () => {
    const logs = simulateLogs({ cards: 900, trueW: LEARNER, schedW: DEFAULTS, seed: 3 });
    expect(logs.length).toBeGreaterThan(MIN_REVIEWS);
    const ds = buildDataset(logs);
    const started = performance.now();
    const res = optimizeParams(ds, input);
    const ms = performance.now() - started;
    expect(res.adopted).toBe(true);
    expect(res.reason).toBe('better');
    expect(res.next!.logLoss).toBeLessThan(res.current!.logLoss);
    expect(res.next!.rmseBins).toBeLessThan(res.current!.rmseBins);
    expect(res.accuracyGainPct).toBeGreaterThan(0);
    expect(res.params).toHaveLength(PARAM_COUNT);
    // The scheduler accepts them unchanged.
    expect(
      createScheduler({ request_retention: 0.9, fsrs_params: res.params }).engine.parameters.w,
    ).toEqual(res.params);
    // This learner forgets faster: more reviews per day.
    expect(res.workloadNext).toBeGreaterThan(res.workloadNow);
    expect(ms).toBeLessThan(10_000);
  });

  it('never adopts parameters that are worse on the held-out reviews', () => {
    const logs = simulateLogs({ cards: 900, trueW: DEFAULTS, schedW: DEFAULTS, seed: 5 });
    const ds = buildDataset(logs);
    // A "trained" set that is clearly wrong for this learner.
    const worse: Trainer = () =>
      clipToBounds(DEFAULTS.map((v, i) => (i < 4 ? v * 6 : i === 20 ? 0.8 : v)));
    const res = optimizeParams(ds, input, { trainer: worse });
    expect(res.adopted).toBe(false);
    expect(res.reason).toBe('not_better');
    expect(res.params).toEqual(DEFAULTS);
    expect(res.next!.logLoss).toBeGreaterThan(res.current!.logLoss);
    expect(res.workloadNext).toBe(res.workloadNow);
  });

  it('needs both metrics to improve: a better log-loss alone is not enough', () => {
    const logs = simulateLogs({ cards: 900, trueW: LEARNER, schedW: DEFAULTS, seed: 11 });
    const ds = buildDataset(logs);
    const current = normalizeParams(LEARNER);
    // Candidate = the current params themselves: equal, not better.
    const same: Trainer = (_ds, start) => [...start];
    const res = optimizeParams(ds, { ...input, current }, { trainer: same });
    expect(res.adopted).toBe(false);
    expect(res.params).toEqual(current);
  });

  it('rejects non-finite or wrong-length candidates', () => {
    const ds = buildDataset(simulateLogs({ cards: 600, trueW: DEFAULTS, schedW: DEFAULTS }));
    for (const bad of [[1, 2, 3], DEFAULTS.map((v, i) => (i === 5 ? NaN : v))]) {
      const res = optimizeParams(ds, input, { trainer: () => bad });
      expect(res.adopted).toBe(false);
      expect(res.params).toEqual(DEFAULTS);
    }
  });

  it('whatever it decides, the stored result is never worse than the current params', () => {
    // Data from the current params: there is little to gain; if it adopts, it must be better.
    const ds = buildDataset(
      simulateLogs({ cards: 700, trueW: DEFAULTS, schedW: DEFAULTS, seed: 21 }),
    );
    const res = optimizeParams(ds, input);
    const cutoffEval = res.adopted ? res.next! : (res.current ?? res.next);
    if (res.adopted) {
      expect(cutoffEval!.logLoss).toBeLessThan(res.current!.logLoss);
      expect(cutoffEval!.rmseBins).toBeLessThan(res.current!.rmseBins);
    } else {
      expect(res.params).toEqual(DEFAULTS);
    }
  });

  it('too few reviews: nothing is trained or changed', () => {
    const ds = buildDataset(simulateLogs({ cards: 20, trueW: DEFAULTS, schedW: DEFAULTS }));
    let called = false;
    const res = optimizeParams(ds, input, {
      trainer: (_d, s) => {
        called = true;
        return [...s];
      },
    });
    expect(res).toMatchObject({ adopted: false, reason: 'too_few' });
    expect(called).toBe(false);
  });

  it('is deterministic (same reviews → same parameters on every device)', () => {
    const ds = buildDataset(
      simulateLogs({ cards: 500, trueW: LEARNER, schedW: DEFAULTS, seed: 9 }),
    );
    expect(optimizeParams(ds, input).params).toEqual(optimizeParams(ds, input).params);
  });

  it('a typical history (≈ 20 000 reviews) trains within a few seconds', () => {
    const logs = simulateLogs({
      cards: 4000,
      trueW: LEARNER,
      schedW: DEFAULTS,
      days: 500,
      seed: 13,
    });
    expect(logs.length).toBeGreaterThan(15_000);
    const ds = buildDataset(logs);
    const started = performance.now();
    let calls = 0;
    const res = optimizeParams(ds, input, { onProgress: () => calls++ });
    // ~1.5 s on an idle laptop; phones are ~3–5× slower and the budget there is 30 s. The
    // bound is loose so a loaded CI machine does not fail it.
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(calls).toBeGreaterThan(0);
    expect(res.adopted).toBe(true);
  });
});

describe('evaluate', () => {
  it('the true parameters fit their own data better than the defaults', () => {
    const ds = buildDataset(
      simulateLogs({ cards: 800, trueW: LEARNER, schedW: DEFAULTS, seed: 4 }),
    );
    const all = () => true;
    const truth = evaluate(LEARNER, ds, all);
    const defaults = evaluate(DEFAULTS, ds, all);
    expect(truth.logLoss).toBeLessThan(defaults.logLoss);
    expect(truth.rmseBins).toBeLessThan(defaults.rmseBins);
  });
});

describe('shouldSuggest', () => {
  const now = Date.UTC(2026, 9, 22);
  it('at 1 000 reviews, then a month after the last run when there are new reviews', () => {
    expect(shouldSuggest({ reviews: 999, reviewsSinceLastRun: 999, lastRunAt: null, now })).toBe(
      false,
    );
    expect(shouldSuggest({ reviews: 1000, reviewsSinceLastRun: 1000, lastRunAt: null, now })).toBe(
      true,
    );
    const last = now - REOPTIMIZE_AFTER_MS + 1;
    expect(shouldSuggest({ reviews: 5000, reviewsSinceLastRun: 300, lastRunAt: last, now })).toBe(
      false,
    );
    expect(
      shouldSuggest({ reviews: 5000, reviewsSinceLastRun: 300, lastRunAt: last - 1, now }),
    ).toBe(true);
    expect(shouldSuggest({ reviews: 5000, reviewsSinceLastRun: 0, lastRunAt: last - 1, now })).toBe(
      false,
    );
  });
});
