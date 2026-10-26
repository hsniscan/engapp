// The monthly text-AI budget (decision 0047, migration 20261101000500_text_budget.sql): every
// Claude call of a text job (the graded library now, the daily story later) reserves an upper
// bound of its cost first, settles the real cost from `usage` after, and is refused when the
// month's spent + reserved + bound would pass the cap. Same rule as the picture budget
// (image_budget_*), with its own cap: CLAUDE_TEXT_MONTHLY_USD (default 10 USD, owner's
// decision 2026-10-25).
//
// Environment-neutral (Deno edge functions and the Node jobs). Prices and the bound come from
// image-models.ts (callCostUsd, reserveUsd); this file only does the bookkeeping.

import type { SupabaseClient } from '@supabase/supabase-js';
import { roundUsd } from './image-models.ts';

type Env = (key: string) => string | undefined;

export const DEFAULT_TEXT_MONTHLY_USD = 10;

/** The month's text cap in USD: CLAUDE_TEXT_MONTHLY_USD when it is a positive number, else 10. */
export function textMonthlyCapUsd(env: Env): number {
  const v = Number(env('CLAUDE_TEXT_MONTHLY_USD'));
  return roundUsd(Number.isFinite(v) && v > 0 ? v : DEFAULT_TEXT_MONTHLY_USD);
}

export interface TextBudgetStatus {
  month: string;
  cap_usd: number;
  spent_usd: number;
  reserved_usd: number;
}

/** The database side (SupabaseTextBudgetStore; tests use an in-memory fake). */
export interface TextBudgetStore {
  /** Hold id, or null when the month's budget cannot cover the amount. */
  reserve(amountUsd: number, capUsd: number, purpose: string, opts?: { batch?: boolean }): Promise<string | null>;
  /** Ends a hold: its amount leaves `reserved`, `actualUsd` joins `spent`. */
  settle(holdId: string, actualUsd: number): Promise<void>;
  status(): Promise<TextBudgetStatus>;
}

/** A store plus the cap the caller runs under. */
export interface TextBudget {
  store: TextBudgetStore;
  capUsd: number;
}

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export class SupabaseTextBudgetStore implements TextBudgetStore {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async reserve(
    amountUsd: number,
    capUsd: number,
    purpose: string,
    opts: { batch?: boolean } = {},
  ): Promise<string | null> {
    const r = await this.db.rpc('text_budget_reserve', {
      p_amount: amountUsd,
      p_cap: capUsd,
      p_purpose: purpose,
      p_batch: opts.batch ?? false,
    });
    return (check(r, 'text_budget_reserve') as string | null) ?? null;
  }

  async settle(holdId: string, actualUsd: number): Promise<void> {
    check(
      await this.db.rpc('text_budget_settle', { p_hold: holdId, p_actual: actualUsd }),
      'text_budget_settle',
    );
  }

  async releaseStale(olderThan = '1 hour'): Promise<number> {
    return check(
      await this.db.rpc('text_budget_release_stale', { p_older_than: olderThan }),
      'text_budget_release_stale',
    ) as number;
  }

  async status(): Promise<TextBudgetStatus> {
    const s = check(await this.db.rpc('text_budget_status'), 'text_budget_status') as Record<
      string,
      unknown
    >;
    return {
      month: String(s.month),
      cap_usd: Number(s.cap_usd),
      spent_usd: Number(s.spent_usd),
      reserved_usd: Number(s.reserved_usd),
    };
  }
}

/**
 * Reserves `boundUsd` (an upper bound from reserveUsd) for one call or one Message Batch.
 * Returns the hold id, or null when the cap would be passed (nothing may be sent then).
 */
export async function reserveTextBudget(
  budget: TextBudget,
  boundUsd: number,
  purpose: string,
  opts: { batch?: boolean } = {},
): Promise<string | null> {
  if (!(boundUsd > 0)) throw new Error('a text budget reservation must be positive');
  return budget.store.reserve(roundUsd(boundUsd, 'up'), budget.capUsd, purpose, opts);
}

/** Settles a hold with the real cost (callCostUsd of the response's usage; 0 when not billed). */
export async function settleTextBudget(
  budget: TextBudget,
  holdId: string,
  actualUsd: number,
): Promise<void> {
  await budget.store.settle(holdId, roundUsd(Math.max(0, actualUsd)));
}

export type TextSpend<T> =
  | { kind: 'ok'; value: T; costUsd: number }
  /** The month's text budget cannot cover the call: it was not made. */
  | { kind: 'budget' };

/**
 * One budgeted model call: reserve the bound, run `call`, settle the real cost it reports.
 * A call that throws was not billed by the API (transport or API error): it is settled at 0
 * and the error is rethrown. The edge functions (the daily story) use this for every call.
 */
export async function recordTextSpend<T>(
  budget: TextBudget,
  opts: { purpose: string; boundUsd: number },
  call: () => Promise<{ value: T; costUsd: number }>,
): Promise<TextSpend<T>> {
  const hold = await reserveTextBudget(budget, opts.boundUsd, opts.purpose);
  if (!hold) return { kind: 'budget' };
  let out: { value: T; costUsd: number };
  try {
    out = await call();
  } catch (e) {
    await settleTextBudget(budget, hold, 0);
    throw e;
  }
  await settleTextBudget(budget, hold, out.costUsd);
  return { kind: 'ok', value: out.value, costUsd: roundUsd(out.costUsd) };
}

/**
 * In-memory store with the SQL functions' rule (spent + reserved + amount ≤ cap, checked and
 * booked in one step). For tests of the jobs and of callers such as the story function.
 */
export class MemoryTextBudgetStore implements TextBudgetStore {
  spent = 0;
  reserved = 0;
  cap = 0;
  readonly holds = new Map<string, { amount: number; purpose: string; batch: boolean }>();
  private next = 0;

  async reserve(
    amountUsd: number,
    capUsd: number,
    purpose: string,
    opts: { batch?: boolean } = {},
  ): Promise<string | null> {
    // A real round trip: concurrent callers interleave here, as they would on the network.
    await Promise.resolve();
    if (!(amountUsd > 0) || capUsd < 0) throw new Error('invalid arguments');
    this.cap = capUsd;
    if (roundUsd(this.spent + this.reserved + amountUsd) > capUsd) return null;
    this.reserved = roundUsd(this.reserved + amountUsd);
    const id = `hold-${++this.next}`;
    this.holds.set(id, { amount: amountUsd, purpose, batch: opts.batch ?? false });
    return id;
  }

  async settle(holdId: string, actualUsd: number): Promise<void> {
    await Promise.resolve();
    const h = this.holds.get(holdId);
    this.holds.delete(holdId);
    this.reserved = roundUsd(Math.max(0, this.reserved - (h?.amount ?? 0)));
    this.spent = roundUsd(this.spent + actualUsd);
  }

  async status(): Promise<TextBudgetStatus> {
    return {
      month: new Date().toISOString().slice(0, 7) + '-01',
      cap_usd: this.cap,
      spent_usd: this.spent,
      reserved_usd: this.reserved,
    };
  }
}
