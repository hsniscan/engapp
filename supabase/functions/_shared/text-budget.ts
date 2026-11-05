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
/**
 * One user's share of the month (decision 0060): AI_USER_MONTHLY_USD … Raised from 1 to 2 USD
 * with Claude Sonnet as the primary text model (decision 0077): 1 USD were ~25 word
 * extractions a month on Sonnet, after which the user's calls go to Gemini.
 */
export const DEFAULT_USER_MONTHLY_USD = 2;
/** … and never more than this fraction of the global cap (AI_USER_MAX_SHARE; was 0.1). */
export const DEFAULT_USER_MAX_SHARE = 0.2;
/**
 * The owner's share (APP_ADMIN_USER_ID, decision 0077): AI_OWNER_MAX_SHARE of the global cap.
 * The owner is the main user; the rest of the month stays for other users and the system
 * jobs' pool.
 */
export const DEFAULT_OWNER_MAX_SHARE = 0.75;
/**
 * The system jobs' pool (nightly level job, morpheme meanings, level-test bank; decision 0077):
 * AI_SYSTEM_MONTHLY_USD (default 2 USD), at most AI_SYSTEM_MAX_SHARE (default 15 %) of the
 * global cap. On Sonnet the level job's 100 calls a day would cost ~3 USD a day: without its
 * own share it would use up the month in a few nights.
 */
export const DEFAULT_SYSTEM_MONTHLY_USD = 2;
export const DEFAULT_SYSTEM_MAX_SHARE = 0.15;
/** Pool name of the system jobs (text_budget_pools.pool). */
export const SYSTEM_POOL = 'system';

function share(env: Env, key: string, fallback: number): number {
  const v = Number(env(key));
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
}

function usd(env: Env, key: string, fallback: number): number {
  const v = Number(env(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** The month's text cap in USD: CLAUDE_TEXT_MONTHLY_USD when it is a positive number, else 10. */
export function textMonthlyCapUsd(env: Env): number {
  const v = Number(env('CLAUDE_TEXT_MONTHLY_USD'));
  return roundUsd(Number.isFinite(v) && v > 0 ? v : DEFAULT_TEXT_MONTHLY_USD);
}

/**
 * The most one user's calls may spend in a month: AI_USER_MONTHLY_USD (default 2 USD), but
 * at most AI_USER_MAX_SHARE (default 20 %) of the global cap, so no single account can use up
 * the month for everyone (review S2). The owner (`userId` equal to APP_ADMIN_USER_ID) gets
 * AI_OWNER_MAX_SHARE (default 75 %) of the global cap instead (decision 0077).
 */
export function textUserMonthlyCapUsd(
  env: Env,
  globalCapUsd = textMonthlyCapUsd(env),
  userId?: string,
): number {
  const owner = env('APP_ADMIN_USER_ID')?.trim().toLowerCase();
  if (owner && userId && userId.toLowerCase() === owner) {
    return roundUsd(globalCapUsd * share(env, 'AI_OWNER_MAX_SHARE', DEFAULT_OWNER_MAX_SHARE));
  }
  const cap = usd(env, 'AI_USER_MONTHLY_USD', DEFAULT_USER_MONTHLY_USD);
  return roundUsd(
    Math.min(cap, globalCapUsd * share(env, 'AI_USER_MAX_SHARE', DEFAULT_USER_MAX_SHARE)),
  );
}

/**
 * The system jobs' monthly pool: AI_SYSTEM_MONTHLY_USD (default 2 USD), at most
 * AI_SYSTEM_MAX_SHARE (default 15 %) of the global cap. Its calls count against the global cap
 * too, so the month's total never passes CLAUDE_TEXT_MONTHLY_USD.
 */
export function textSystemMonthlyCapUsd(env: Env, globalCapUsd = textMonthlyCapUsd(env)): number {
  const cap = usd(env, 'AI_SYSTEM_MONTHLY_USD', DEFAULT_SYSTEM_MONTHLY_USD);
  return roundUsd(
    Math.min(cap, globalCapUsd * share(env, 'AI_SYSTEM_MAX_SHARE', DEFAULT_SYSTEM_MAX_SHARE)),
  );
}

/** A budget hold's purpose as the database accepts it (`^[a-z][a-z0-9_]{0,31}$`). */
export function budgetPurpose(name: string): string {
  const p = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 32);
  return p || 'text';
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
  /**
   * A reservation that also counts against one user's monthly share (decision 0060). Null
   * when either the user's cap or the global cap cannot cover the amount.
   */
  reserveForUser(
    amountUsd: number,
    capUsd: number,
    purpose: string,
    userId: string,
    userCapUsd: number,
  ): Promise<string | null>;
  /** Ends a hold: its amount leaves `reserved`, `actualUsd` joins `spent`. */
  /**
   * A reservation that also counts against a named pool's monthly cap (the system jobs,
   * decision 0077). Null when either the pool's cap or the global cap cannot cover it.
   */
  reservePool(
    amountUsd: number,
    capUsd: number,
    purpose: string,
    pool: string,
    poolCapUsd: number,
    opts?: { batch?: boolean },
  ): Promise<string | null>;
  settle(holdId: string, actualUsd: number): Promise<void>;
  status(): Promise<TextBudgetStatus>;
}

/** A store plus the cap the caller runs under. */
export interface TextBudget {
  store: TextBudgetStore;
  capUsd: number;
  /** The user whose request pays (edge functions); absent for system jobs. */
  user?: { id: string; capUsd: number };
  /** The pool a system job pays from (decision 0077); ignored when `user` is set. */
  pool?: { name: string; capUsd: number };
}

/** `budget` charged to one user as well (per request in the edge functions). */
export function forUser(budget: TextBudget, userId: string, userCapUsd: number): TextBudget {
  return { ...budget, user: { id: userId, capUsd: userCapUsd } };
}

/** `budget` charged to a pool as well (the system jobs). */
export function forPool(budget: TextBudget, name: string, poolCapUsd: number): TextBudget {
  return { ...budget, pool: { name, capUsd: poolCapUsd } };
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

  async reserveForUser(
    amountUsd: number,
    capUsd: number,
    purpose: string,
    userId: string,
    userCapUsd: number,
  ): Promise<string | null> {
    const r = await this.db.rpc('text_budget_reserve_user', {
      p_amount: amountUsd,
      p_cap: capUsd,
      p_purpose: purpose,
      p_user: userId,
      p_user_cap: userCapUsd,
    });
    return (check(r, 'text_budget_reserve_user') as string | null) ?? null;
  }

  async reservePool(
    amountUsd: number,
    capUsd: number,
    purpose: string,
    pool: string,
    poolCapUsd: number,
    opts: { batch?: boolean } = {},
  ): Promise<string | null> {
    const r = await this.db.rpc('text_budget_reserve_pool', {
      p_amount: amountUsd,
      p_cap: capUsd,
      p_purpose: purpose,
      p_pool: pool,
      p_pool_cap: poolCapUsd,
      p_batch: opts.batch ?? false,
    });
    return (check(r, 'text_budget_reserve_pool') as string | null) ?? null;
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
  const amount = roundUsd(boundUsd, 'up');
  const p = budgetPurpose(purpose);
  if (budget.user && !opts.batch) {
    return budget.store.reserveForUser(amount, budget.capUsd, p, budget.user.id, budget.user.capUsd);
  }
  if (budget.pool) {
    return budget.store.reservePool(amount, budget.capUsd, p, budget.pool.name, budget.pool.capUsd, opts);
  }
  return budget.store.reserve(amount, budget.capUsd, p, opts);
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
 * A call that throws with an API error was not billed: it is settled at 0 and the error is
 * rethrown. One that may have been billed (an error with `maybeBilled`, e.g. a timeout) keeps
 * its whole bound (decision 0077). The edge functions (the daily story) use this for every call.
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
    const billed = !!e && typeof e === 'object' && (e as { maybeBilled?: unknown }).maybeBilled === true;
    await settleTextBudget(budget, hold, billed ? opts.boundUsd : 0);
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
  readonly holds = new Map<
    string,
    { amount: number; purpose: string; batch: boolean; user?: string; pool?: string }
  >();
  /** Per-user spent + reserved this month (reserveForUser). */
  readonly users = new Map<string, { spent: number; reserved: number }>();
  /** Per-pool spent + reserved this month (reservePool). */
  readonly pools = new Map<string, { spent: number; reserved: number }>();
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

  async reserveForUser(
    amountUsd: number,
    capUsd: number,
    purpose: string,
    userId: string,
    userCapUsd: number,
  ): Promise<string | null> {
    await Promise.resolve();
    if (!(amountUsd > 0) || userCapUsd < 0) throw new Error('invalid arguments');
    const u = this.users.get(userId) ?? { spent: 0, reserved: 0 };
    if (roundUsd(u.spent + u.reserved + amountUsd) > userCapUsd) return null;
    if (roundUsd(this.spent + this.reserved + amountUsd) > capUsd) return null;
    this.cap = capUsd;
    this.reserved = roundUsd(this.reserved + amountUsd);
    u.reserved = roundUsd(u.reserved + amountUsd);
    this.users.set(userId, u);
    const id = `hold-${++this.next}`;
    this.holds.set(id, { amount: amountUsd, purpose, batch: false, user: userId });
    return id;
  }

  async reservePool(
    amountUsd: number,
    capUsd: number,
    purpose: string,
    pool: string,
    poolCapUsd: number,
    opts: { batch?: boolean } = {},
  ): Promise<string | null> {
    await Promise.resolve();
    if (!(amountUsd > 0) || poolCapUsd < 0) throw new Error('invalid arguments');
    const p = this.pools.get(pool) ?? { spent: 0, reserved: 0 };
    if (roundUsd(p.spent + p.reserved + amountUsd) > poolCapUsd) return null;
    if (roundUsd(this.spent + this.reserved + amountUsd) > capUsd) return null;
    this.cap = capUsd;
    this.reserved = roundUsd(this.reserved + amountUsd);
    p.reserved = roundUsd(p.reserved + amountUsd);
    this.pools.set(pool, p);
    const id = `hold-${++this.next}`;
    this.holds.set(id, { amount: amountUsd, purpose, batch: opts.batch ?? false, pool });
    return id;
  }

  async settle(holdId: string, actualUsd: number): Promise<void> {
    await Promise.resolve();
    const h = this.holds.get(holdId);
    this.holds.delete(holdId);
    const u = h?.user ? this.users.get(h.user) : h?.pool ? this.pools.get(h.pool) : undefined;
    if (u) {
      u.reserved = roundUsd(Math.max(0, u.reserved - h!.amount));
      u.spent = roundUsd(u.spent + actualUsd);
    }
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
