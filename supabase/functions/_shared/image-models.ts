// Claude models and prices for the picture pipeline (decision 0030). Model ids come only from
// the environment (CLAUDE_IMAGE_MODEL, CLAUDE_CHECK_MODEL); the defaults below are used when a
// variable is unset, like DEFAULT_GEMINI_MODEL (AGENTS.md rule 5). Prices live only here.

type Env = (key: string) => string | undefined;

export const DEFAULT_IMAGE_MODEL = 'claude-opus-5-5';
export const DEFAULT_CHECK_MODEL = 'claude-haiku-5-5';

export interface ImageModels {
  /** Draws the pictures (image-v1). */
  image: string;
  /** Scores visualizability (visual-v1) and checks rendered pictures (imagecheck-v1). */
  check: string;
}

export function imageModels(env: Env): ImageModels {
  return {
    image: env('CLAUDE_IMAGE_MODEL')?.trim() || DEFAULT_IMAGE_MODEL,
    check: env('CLAUDE_CHECK_MODEL')?.trim() || DEFAULT_CHECK_MODEL,
  };
}

/** USD per million tokens. Cache writes: 5-minute TTL 1.25× input, 1-hour TTL 2× input. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * Claude API list prices (Oct 2026). A model missing here is priced as the most expensive
 * entry, so an unknown model can only make the budget guard stricter.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
};

const MAX_PRICE: ModelPrice = Object.values(MODEL_PRICES).reduce((a, b) => ({
  input: Math.max(a.input, b.input),
  output: Math.max(a.output, b.output),
  cacheRead: Math.max(a.cacheRead, b.cacheRead),
}));

export function priceOf(model: string | null | undefined): ModelPrice {
  return (model && MODEL_PRICES[model]) || MAX_PRICE;
}

/** Message Batches API: half price on every token. */
export const BATCH_DISCOUNT = 0.5;

/** The token counts of one model call (the shape of the API's `usage`). */
export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
  /** Per-iteration usage; a server-side fallback adds a `fallback_message` entry. */
  iterations?: readonly (TokenUsage & { type?: string; model?: string | null })[] | null;
}

const n = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? v : 0);

function usageCost(model: string | null | undefined, u: TokenUsage): number {
  const p = priceOf(model);
  const created = n(u.cache_creation_input_tokens);
  const h1 = Math.min(created, n(u.cache_creation?.ephemeral_1h_input_tokens));
  const m5 = created - h1;
  const usd =
    n(u.input_tokens) * p.input +
    n(u.output_tokens) * p.output +
    n(u.cache_read_input_tokens) * p.cacheRead +
    m5 * p.input * 1.25 +
    h1 * p.input * 2;
  return usd / 1_000_000;
}

/**
 * Real cost of one call from its `usage`, in USD. When the response lists iterations (a
 * server-side fallback ran), each is priced at the model that served it.
 */
export function callCostUsd(
  model: string,
  usage: TokenUsage | null | undefined,
  opts: { batch?: boolean } = {},
): number {
  if (!usage) return 0;
  const its = (usage.iterations ?? []).filter(
    (i) => i.type === 'message' || i.type === 'fallback_message',
  );
  const usd =
    its.length > 0
      ? its.reduce((sum, i) => sum + usageCost(i.model ?? model, i), 0)
      : usageCost(model, usage);
  return roundUsd(opts.batch ? usd * BATCH_DISCOUNT : usd);
}

/**
 * Upper bound of one call's cost, reserved before the call: every input token billed as a
 * 1-hour cache write and every allowed output token used. With a server-side fallback the
 * bound covers a second full attempt at the most expensive price.
 */
export function reserveUsd(
  model: string,
  opts: { inputTokens: number; maxTokens: number; batch?: boolean; fallback?: boolean },
): number {
  const one = (p: ModelPrice) => (opts.inputTokens * p.input * 2 + opts.maxTokens * p.output) / 1e6;
  let usd = one(priceOf(model));
  if (opts.fallback) usd += one(MAX_PRICE);
  return roundUsd(opts.batch ? usd * BATCH_DISCOUNT : usd, 'up');
}

/** Rough token count of a prompt (≈ 3 characters per token, rounded up; deliberately high). */
export function tokenBound(text: string): number {
  return Math.ceil(text.length / 3) + 64;
}

/** USD to 6 decimals (the numeric scale of the budget columns). */
export function roundUsd(usd: number, dir: 'near' | 'up' = 'near'): number {
  const f = dir === 'up' ? Math.ceil : Math.round;
  return f(usd * 1e6) / 1e6;
}

/** Monthly picture budget: 80 % of the linked subscription's API credit. */
export const IMAGE_BUDGET_SHARE = 0.8;
export const DEFAULT_MONTHLY_CREDIT_USD = 100;

export function monthlyCapUsd(env: Env): number {
  const credit = Number(env('CLAUDE_MONTHLY_CREDIT_USD'));
  const c = Number.isFinite(credit) && credit > 0 ? credit : DEFAULT_MONTHLY_CREDIT_USD;
  return roundUsd(c * IMAGE_BUDGET_SHARE);
}
