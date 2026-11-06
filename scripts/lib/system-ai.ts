// The text AI provider of the system jobs (decision 0077): the same chain as the edge functions
// (Claude Sonnet first, Gemini behind it, supabase/functions/_shared/ai.ts), with every Claude
// call reserved on the monthly text budget AND on the system jobs' pool (text_budget_pools,
// AI_SYSTEM_MONTHLY_USD, at most AI_SYSTEM_MAX_SHARE of CLAUDE_TEXT_MONTHLY_USD). When the pool
// or the month is used up, the job continues on Gemini (free tier); without a database (a local
// run without SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) Claude is never used: Gemini only.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AiProvider, GeminiConfig } from '../../supabase/functions/_shared/ai-provider.ts';
import { claudeTextEnabled, createTextAiProvider } from '../../supabase/functions/_shared/ai.ts';
import {
  forPool,
  SupabaseTextBudgetStore,
  SYSTEM_POOL,
  textMonthlyCapUsd,
  textSystemMonthlyCapUsd,
  type TextBudget,
  type TextBudgetStore,
} from '../../supabase/functions/_shared/text-budget.ts';

type Env = (key: string) => string | undefined;
type Log = (msg: string, data?: Record<string, unknown>) => void;

/** The service-role client from the environment, or null when the job runs without one. */
export function serviceClientFromEnv(env: Env): SupabaseClient | null {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The monthly text budget charged to the system pool; undefined without a store. */
export function systemTextBudget(env: Env, store: TextBudgetStore | null): TextBudget | undefined {
  if (!store) return undefined;
  const capUsd = textMonthlyCapUsd(env);
  return forPool({ store, capUsd }, SYSTEM_POOL, textSystemMonthlyCapUsd(env, capUsd));
}

export interface SystemAiOptions {
  /** The budget's database; null: no Claude (Gemini only). */
  db?: SupabaseClient | null;
  /** A budget store other than the database (tests). */
  store?: TextBudgetStore | null;
  /** text_budget_holds.purpose, e.g. 'levels'. */
  purpose: string;
  log?: Log;
  gemini?: Partial<GeminiConfig>;
  claudeTimeoutMs?: number;
  fetch?: typeof fetch;
}

/** Whether the job can make text AI calls at all (a Gemini key, or Claude under a budget). */
export function systemTextAiAvailable(
  env: Env,
  opts: Pick<SystemAiOptions, 'db' | 'store'>,
): boolean {
  const budget = systemTextBudget(
    env,
    opts.store ?? (opts.db ? new SupabaseTextBudgetStore(opts.db) : null),
  );
  return !!env('GEMINI_API_KEY') || claudeTextEnabled(env, budget ? { budget } : {});
}

export function createSystemTextProvider(env: Env, opts: SystemAiOptions): AiProvider {
  const store = opts.store ?? (opts.db ? new SupabaseTextBudgetStore(opts.db) : null);
  const budget = systemTextBudget(env, store);
  const claude = claudeTextEnabled(env, budget ? { budget } : {});
  opts.log?.('text ai', {
    chain: claude ? (env('GEMINI_API_KEY') ? 'claude>gemini' : 'claude') : 'gemini',
    ...(budget ? { pool_cap_usd: budget.pool!.capUsd, month_cap_usd: budget.capUsd } : {}),
  });
  return createTextAiProvider(env, {
    purpose: opts.purpose,
    ...(budget ? { budget } : {}),
    ...(opts.log ? { log: opts.log } : {}),
    ...(opts.gemini ? { gemini: opts.gemini } : {}),
    ...(opts.claudeTimeoutMs ? { claudeTimeoutMs: opts.claudeTimeoutMs } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}
