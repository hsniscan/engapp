// @vitest-environment node
// The monthly text-AI budget (decision 0047): the cap from CLAUDE_TEXT_MONTHLY_USD, reserve
// before / settle after, refusal over the cap, and that concurrent callers can never take
// more than the cap between them.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MemoryTextBudgetStore,
  recordTextSpend,
  reserveTextBudget,
  settleTextBudget,
  textMonthlyCapUsd,
} from './text-budget.ts';

const env = (vars: Record<string, string>) => (k: string) => vars[k];

describe('text budget', () => {
  it('reads the cap from CLAUDE_TEXT_MONTHLY_USD, 10 USD by default', () => {
    expect(textMonthlyCapUsd(env({}))).toBe(10);
    expect(textMonthlyCapUsd(env({ CLAUDE_TEXT_MONTHLY_USD: '25' }))).toBe(25);
    expect(textMonthlyCapUsd(env({ CLAUDE_TEXT_MONTHLY_USD: 'lots' }))).toBe(10);
    expect(textMonthlyCapUsd(env({ CLAUDE_TEXT_MONTHLY_USD: '-3' }))).toBe(10);
  });

  it('reserves the bound, then books the real cost', async () => {
    const store = new MemoryTextBudgetStore();
    const budget = { store, capUsd: 10 };
    const r = await recordTextSpend(budget, { purpose: 'story', boundUsd: 0.5 }, async () => {
      expect(store.reserved).toBe(0.5);
      return { value: 'ok', costUsd: 0.012 };
    });
    expect(r).toEqual({ kind: 'ok', value: 'ok', costUsd: 0.012 });
    expect(store.reserved).toBe(0);
    expect(store.spent).toBe(0.012);
    expect(store.holds.size).toBe(0);
  });

  it('refuses a call the month cannot cover, without calling', async () => {
    const store = new MemoryTextBudgetStore();
    store.spent = 9.8;
    let called = false;
    const r = await recordTextSpend({ store, capUsd: 10 }, { purpose: 'story', boundUsd: 0.5 }, async () => {
      called = true;
      return { value: 1, costUsd: 0.1 };
    });
    expect(r).toEqual({ kind: 'budget' });
    expect(called).toBe(false);
    expect(store.spent).toBe(9.8);
  });

  it('settles a failed call at 0 (not billed) and rethrows', async () => {
    const store = new MemoryTextBudgetStore();
    await expect(
      recordTextSpend({ store, capUsd: 10 }, { purpose: 'story', boundUsd: 1 }, async () => {
        throw new Error('overloaded');
      }),
    ).rejects.toThrow('overloaded');
    expect(store.reserved).toBe(0);
    expect(store.spent).toBe(0);
  });

  it('a batch hold stays reserved until it is settled', async () => {
    const store = new MemoryTextBudgetStore();
    const budget = { store, capUsd: 10 };
    const hold = await reserveTextBudget(budget, 6, 'graded', { batch: true });
    expect(hold).not.toBeNull();
    expect(store.holds.get(hold!)?.batch).toBe(true);
    expect(await reserveTextBudget(budget, 5, 'graded', { batch: true })).toBeNull();
    await settleTextBudget(budget, hold!, 2.5);
    expect(await reserveTextBudget(budget, 5, 'graded', { batch: true })).not.toBeNull();
    expect(store.spent).toBe(2.5);
  });

  it('never passes the cap under concurrent reservations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            bound: fc.integer({ min: 1, max: 400 }).map((c) => c / 100),
            // The real cost is never above the bound (reserveUsd is an upper bound).
            share: fc.integer({ min: 0, max: 100 }).map((p) => p / 100),
            fails: fc.boolean(),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        fc.integer({ min: 1, max: 20 }),
        async (calls, cap) => {
          const store = new MemoryTextBudgetStore();
          const budget = { store, capUsd: cap };
          let peak = 0;
          const watch = () => (peak = Math.max(peak, store.spent + store.reserved));
          await Promise.all(
            calls.map((c) =>
              recordTextSpend(budget, { purpose: 'story', boundUsd: c.bound }, async () => {
                watch();
                await new Promise((r) => setTimeout(r, Math.floor(c.share * 3)));
                watch();
                if (c.fails) throw new Error('down');
                return { value: null, costUsd: c.bound * c.share };
              }).catch(() => null),
            ),
          );
          watch();
          expect(peak).toBeLessThanOrEqual(cap + 1e-9);
          expect(store.spent).toBeLessThanOrEqual(cap + 1e-9);
          expect(store.reserved).toBe(0);
        },
      ),
      { numRuns: 60 },
    );
  });
});
