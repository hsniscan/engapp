// @vitest-environment node
// The monthly text-AI budget (decision 0047): the cap from CLAUDE_TEXT_MONTHLY_USD, reserve
// before / settle after, refusal over the cap, and that concurrent callers can never take
// more than the cap between them.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  budgetPurpose,
  forPool,
  forUser,
  MemoryTextBudgetStore,
  SYSTEM_POOL,
  textSystemMonthlyCapUsd,
  recordTextSpend,
  reserveTextBudget,
  settleTextBudget,
  textMonthlyCapUsd,
  textUserMonthlyCapUsd,
} from './text-budget.ts';
import { featureDailyLimit, dailyLimit } from './setup.ts';

const env = (vars: Record<string, string>) => (k: string) => vars[k];

describe('text budget', () => {
  it('reads the cap from CLAUDE_TEXT_MONTHLY_USD, 30 USD by default (owner, 2026-11-05)', () => {
    expect(textMonthlyCapUsd(env({}))).toBe(30);
    expect(textMonthlyCapUsd(env({ CLAUDE_TEXT_MONTHLY_USD: '25' }))).toBe(25);
    expect(textMonthlyCapUsd(env({ CLAUDE_TEXT_MONTHLY_USD: 'lots' }))).toBe(30);
    expect(textMonthlyCapUsd(env({ CLAUDE_TEXT_MONTHLY_USD: '-3' }))).toBe(30);
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

describe('per-user share (decision 0060)', () => {
  it('is 2 USD by default, never more than 20 % of the global cap (decision 0077)', () => {
    expect(textUserMonthlyCapUsd(env({}))).toBe(2);
    expect(textUserMonthlyCapUsd(env({ CLAUDE_TEXT_MONTHLY_USD: '5' }))).toBe(1);
    expect(textUserMonthlyCapUsd(env({ AI_USER_MONTHLY_USD: '3', CLAUDE_TEXT_MONTHLY_USD: '100' }))).toBe(3);
    expect(textUserMonthlyCapUsd(env({ AI_USER_MONTHLY_USD: '3', AI_USER_MAX_SHARE: '0.1', CLAUDE_TEXT_MONTHLY_USD: '10' }))).toBe(1);
    expect(textUserMonthlyCapUsd(env({ AI_USER_MAX_SHARE: 'x', AI_USER_MONTHLY_USD: '-1' }))).toBe(2);
  });

  it('gives the owner (APP_ADMIN_USER_ID) 75 % of the global cap', () => {
    const vars = { APP_ADMIN_USER_ID: 'AAAA-owner', CLAUDE_TEXT_MONTHLY_USD: '20' };
    expect(textUserMonthlyCapUsd(env(vars), 20, 'aaaa-owner')).toBe(15);
    expect(textUserMonthlyCapUsd(env(vars), 20, 'someone-else')).toBe(2);
    expect(textUserMonthlyCapUsd(env({ ...vars, AI_OWNER_MAX_SHARE: '0.9' }), 20, 'aaaa-owner')).toBe(18);
    expect(textUserMonthlyCapUsd(env({}), 10, 'aaaa-owner')).toBe(2);
  });

  it('one user cannot spend more than the share; another user still can', async () => {
    const store = new MemoryTextBudgetStore();
    const base = { store, capUsd: 10 };
    const alice = forUser(base, 'alice', 1);
    const bob = forUser(base, 'bob', 1);
    let calls = 0;
    const call = async () => ({ value: ++calls, costUsd: 0.3 });
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await recordTextSpend(alice, { purpose: 'story', boundUsd: 0.3 }, call)).kind);
    expect(results.filter((k) => k === 'ok')).toHaveLength(3);
    expect(results.at(-1)).toBe('budget');
    expect(store.users.get('alice')).toEqual({ spent: 0.9, reserved: 0 });
    expect((await recordTextSpend(bob, { purpose: 'story', boundUsd: 0.3 }, call)).kind).toBe('ok');
    expect(store.spent).toBeCloseTo(1.2, 6);
  });

  it('the global cap still applies to users with room in their share', async () => {
    const store = new MemoryTextBudgetStore();
    store.spent = 9.9;
    const u = forUser({ store, capUsd: 10 }, 'u', 1);
    expect(await reserveTextBudget(u, 0.2, 'ai-fallback')).toBeNull();
    expect(store.users.get('u')).toBeUndefined();
  });

  it('batch holds of system jobs never count against a user', async () => {
    const store = new MemoryTextBudgetStore();
    const hold = await reserveTextBudget(forUser({ store, capUsd: 10 }, 'u', 1), 5, 'graded', { batch: true });
    expect(hold).not.toBeNull();
    expect(store.users.size).toBe(0);
  });
});

describe('system jobs pool (decision 0077)', () => {
  it('is 2 USD by default, never more than 15 % of the global cap', () => {
    expect(textSystemMonthlyCapUsd(env({}))).toBe(2);
    expect(textSystemMonthlyCapUsd(env({ CLAUDE_TEXT_MONTHLY_USD: '10' }))).toBe(1.5);
    expect(textSystemMonthlyCapUsd(env({ CLAUDE_TEXT_MONTHLY_USD: '20' }))).toBe(2);
    expect(textSystemMonthlyCapUsd(env({ CLAUDE_TEXT_MONTHLY_USD: '30', AI_SYSTEM_MONTHLY_USD: '9' }))).toBe(4.5);
    expect(textSystemMonthlyCapUsd(env({ AI_SYSTEM_MAX_SHARE: '0.5', AI_SYSTEM_MONTHLY_USD: '9', CLAUDE_TEXT_MONTHLY_USD: '10' }))).toBe(5);
  });

  it('a job stops at its pool and leaves the rest of the month for the users', async () => {
    const store = new MemoryTextBudgetStore();
    const job = forPool({ store, capUsd: 10 }, SYSTEM_POOL, 1.5);
    const call = async () => ({ value: 1, costUsd: 0.03 });
    let ok = 0;
    for (let i = 0; i < 200; i++) {
      const r = await recordTextSpend(job, { purpose: 'levels', boundUsd: 0.12 }, call);
      if (r.kind === 'budget') break;
      ok++;
    }
    // Each call reserves 0.12 and costs 0.03: it stops once spent + 0.12 would pass 1.5.
    expect(ok).toBe(47);
    expect(store.pools.get(SYSTEM_POOL)).toEqual({ spent: 1.41, reserved: 0 });
    expect(store.spent).toBeCloseTo(1.41, 6);
    const user = forUser({ store, capUsd: 10 }, 'u', 2);
    expect((await recordTextSpend(user, { purpose: 'ai-extract', boundUsd: 0.3 }, call)).kind).toBe('ok');
  });

  it('the global cap still applies to the pool, batch holds included', async () => {
    const store = new MemoryTextBudgetStore();
    store.spent = 9.95;
    const job = forPool({ store, capUsd: 10 }, SYSTEM_POOL, 1.5);
    expect(await reserveTextBudget(job, 0.1, 'levels')).toBeNull();
    expect(await reserveTextBudget(job, 0.1, 'levels', { batch: true })).toBeNull();
    expect(store.pools.get(SYSTEM_POOL)).toBeUndefined();
  });

  it('purposes are stored in the form the database accepts', () => {
    expect(budgetPurpose('ai-extract')).toBe('ai_extract');
    expect(budgetPurpose('Story')).toBe('story');
    expect(budgetPurpose('9-lives')).toBe('lives');
    expect(budgetPurpose('---')).toBe('text');
    expect(budgetPurpose('x'.repeat(40))).toHaveLength(32);
  });
});

describe('daily AI limits (decision 0060)', () => {
  it('a lower shared default and one limit per feature, each overridable', () => {
    expect(dailyLimit(env({}))).toBe(120);
    expect(featureDailyLimit(env({}), 'ai-extract')).toBe(60);
    expect(featureDailyLimit(env({}), 'ai-report')).toBe(4);
    expect(featureDailyLimit(env({ AI_DAILY_LIMIT_EXTRACT: '80' }), 'ai-extract')).toBe(80);
    expect(featureDailyLimit(env({ AI_DAILY_LIMIT_EXTRACT: 'lots' }), 'ai-extract')).toBe(60);
    expect(featureDailyLimit(env({}), 'ai-new-thing')).toBe(20);
  });
});
