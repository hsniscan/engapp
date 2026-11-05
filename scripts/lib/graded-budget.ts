// What the graded library job may spend (v0.5.3, decision 0073).
//
// The library's batches are reserved on the monthly Claude budget the picture and word-bank
// jobs share (image_budget_*, 80 % of CLAUDE_MONTHLY_CREDIT_USD) — the account-wide guard — and
// on a cap of the library's own for the month (GRADED_MONTHLY_USD, default 20 US$, a workflow
// input), counted from graded_batches. Before v0.5.3 the library drew on the text budget
// (CLAUDE_TEXT_MONTHLY_USD, 10 US$) that the stories and the in-app AI use; a 360-text run
// there would have used up the month for the app's own features, so it moved here.
//
// Both checks must pass before a batch is sent; the job runs one at a time (workflow
// concurrency group), so the library's own sum cannot race.

import type { SupabaseClient } from '@supabase/supabase-js';
import { roundUsd } from '../../supabase/functions/_shared/image-models.ts';
import type { TextBudgetStatus, TextBudgetStore } from '../../supabase/functions/_shared/text-budget.ts';

type Env = (key: string) => string | undefined;

/** The library's monthly cap when nothing sets one (owner, 2026-11-05: about 20 US$). */
export const DEFAULT_GRADED_MONTHLY_USD = 20;

/** GRADED_MONTHLY_USD when it is a positive number, else 20 US$. */
export function gradedMonthlyCapUsd(env: Env): number {
  const v = Number(env('GRADED_MONTHLY_USD'));
  return roundUsd(Number.isFinite(v) && v > 0 ? v : DEFAULT_GRADED_MONTHLY_USD);
}

/** Start of the current UTC month, ISO. */
export function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * A budget store with an extra cap: a reservation is refused when `spentUsd()` (what the library
 * has spent or holds this month) plus the amount would pass `capUsd`; otherwise the inner store
 * (the shared monthly budget, with its own cap) decides.
 */
export class CappedBudgetStore implements TextBudgetStore {
  private readonly inner: TextBudgetStore;
  private readonly own: { capUsd: number; spentUsd: () => Promise<number> };

  constructor(inner: TextBudgetStore, own: { capUsd: number; spentUsd: () => Promise<number> }) {
    this.inner = inner;
    this.own = own;
  }

  get capUsd(): number {
    return this.own.capUsd;
  }

  spentUsd(): Promise<number> {
    return this.own.spentUsd();
  }

  async reserve(amountUsd: number, capUsd: number, purpose: string, opts?: { batch?: boolean }): Promise<string | null> {
    const spent = await this.own.spentUsd();
    if (roundUsd(spent + amountUsd) > this.own.capUsd) return null;
    return this.inner.reserve(amountUsd, capUsd, purpose, opts);
  }

  reserveForUser(): Promise<string | null> {
    return Promise.reject(new Error('the graded library is a system job: no per-user reservations'));
  }

  settle(holdId: string, actualUsd: number): Promise<void> {
    return this.inner.settle(holdId, actualUsd);
  }

  status(): Promise<TextBudgetStatus> {
    return this.inner.status();
  }
}

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

/**
 * The shared monthly Claude budget (image_budget_*, migration 20261025000200) as a budget store.
 * Holds use the purpose 'batch' (a Message Batch hold: never released as stale, settled by
 * collect), so no migration has to widen the purpose list.
 */
export class ClaudeMonthlyBudgetStore implements TextBudgetStore {
  private readonly db: SupabaseClient;

  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async reserve(amountUsd: number, capUsd: number): Promise<string | null> {
    const r = await this.db.rpc('image_budget_reserve', { p_amount: amountUsd, p_cap: capUsd, p_purpose: 'batch' });
    return (check(r, 'image_budget_reserve') as string | null) ?? null;
  }

  reserveForUser(): Promise<string | null> {
    return Promise.reject(new Error('no per-user reservations on the monthly Claude budget'));
  }

  async settle(holdId: string, actualUsd: number): Promise<void> {
    check(await this.db.rpc('image_budget_settle', { p_hold: holdId, p_actual: actualUsd }), 'image_budget_settle');
  }

  async status(): Promise<TextBudgetStatus> {
    const s = check(await this.db.rpc('image_budget_status'), 'image_budget_status') as Record<string, unknown>;
    return {
      month: String(s.month),
      cap_usd: Number(s.cap_usd),
      spent_usd: Number(s.spent_usd),
      reserved_usd: Number(s.reserved_usd),
    };
  }
}
