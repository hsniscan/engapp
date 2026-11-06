// @vitest-environment node
// The graded library's money (decision 0073): its own monthly cap (GRADED_MONTHLY_USD, default
// 20 US$) on top of the shared monthly Claude budget; both must allow a batch.
import { describe, expect, it } from 'vitest';
import { MemoryTextBudgetStore } from '../../supabase/functions/_shared/text-budget.ts';
import { CappedBudgetStore, gradedMonthlyCapUsd, monthStartIso } from './graded-budget.ts';

const env = (vars: Record<string, string>) => (k: string) => vars[k];

describe('graded budget', () => {
  it('reads the library cap, 20 US$ by default', () => {
    expect(gradedMonthlyCapUsd(env({}))).toBe(20);
    expect(gradedMonthlyCapUsd(env({ GRADED_MONTHLY_USD: '12.5' }))).toBe(12.5);
    expect(gradedMonthlyCapUsd(env({ GRADED_MONTHLY_USD: 'lots' }))).toBe(20);
    expect(gradedMonthlyCapUsd(env({ GRADED_MONTHLY_USD: '0' }))).toBe(20);
  });

  it('starts the month in UTC', () => {
    expect(monthStartIso(new Date('2026-11-30T23:59:00Z'))).toBe('2026-11-01T00:00:00.000Z');
  });

  it('refuses what passes the library cap, even when the shared budget has room', async () => {
    const inner = new MemoryTextBudgetStore();
    let spent = 15;
    const store = new CappedBudgetStore(inner, { capUsd: 20, spentUsd: async () => spent });
    expect(await store.reserve(6, 80, 'graded', { batch: true })).toBeNull();
    expect(inner.reserved).toBe(0);
    const hold = await store.reserve(5, 80, 'graded', { batch: true });
    expect(hold).not.toBeNull();
    expect(inner.reserved).toBe(5);
    spent = 20;
    await store.settle(hold!, 3);
    expect(inner.spent).toBe(3);
  });

  it('refuses what passes the shared monthly budget, even under the library cap', async () => {
    const inner = new MemoryTextBudgetStore();
    inner.spent = 79;
    const store = new CappedBudgetStore(inner, { capUsd: 20, spentUsd: async () => 0 });
    expect(await store.reserve(2, 80, 'graded')).toBeNull();
    expect(await store.reserve(1, 80, 'graded')).not.toBeNull();
  });

  it('takes no per-user reservations', async () => {
    const store = new CappedBudgetStore(new MemoryTextBudgetStore(), { capUsd: 20, spentUsd: async () => 0 });
    await expect(store.reserveForUser()).rejects.toThrow(/system job/);
  });
});
