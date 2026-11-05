// Provider chain of the text AI tasks (decision 0077, before that 0044). The pipelines still
// see one AiProvider:
//
//   Claude (CLAUDE_TEXT_MODEL, Sonnet by default) under the monthly text budget
//     -> Gemini (GEMINI_MODEL, then GEMINI_FALLBACK_MODEL, ai-provider.ts), free tier
//
// Gemini takes over whenever Claude gives no usable answer: the month's (or the user's, or
// the system pool's) budget is used up, Claude is rate limited, overloaded, down or times
// out, refuses, or answers something that fails validation. So the app keeps working when
// the budget is gone or a key is missing. AI_TEXT_PRIMARY=gemini restores the old order
// (Gemini first, Claude only when Gemini's quota runs out).
//
// Claude is only used under a budget (every call reserves its worst case first, text-budget.ts):
// without one (a local script without a database) the chain is Gemini alone, unless the caller
// passes `unbudgeted: true` (tests).

import { AiError, createAiProvider, type AiProvider, type GeminiConfig } from './ai-provider.ts';
import {
  claudeTextModel,
  createClaudeTextProvider,
  logTextSpend,
  type RecordTextSpend,
} from './ai-claude-text.ts';
import type { TextBudget } from './text-budget.ts';

type Env = (key: string) => string | undefined;
type Log = (msg: string, data?: Record<string, unknown>) => void;

/** `primary`, and `fallback` (created on first use) when `primary` runs out of quota. */
export function withQuotaFallback(
  primary: AiProvider,
  fallback: () => AiProvider,
  log?: Log,
): AiProvider {
  let second: AiProvider | null = null;
  return {
    name: `${primary.name}+fallback`,
    async generateJson(req) {
      try {
        return await primary.generateJson(req);
      } catch (e) {
        if (!(e instanceof AiError) || e.code !== 'quota_exceeded') throw e;
        second ??= fallback();
        log?.('provider fallback', { from: primary.name, to: second.name, reason: e.message });
        return second.generateJson(req);
      }
    },
  };
}

/**
 * `primary`, and `fallback` (created on first use) after ANY failure of `primary`: a budget
 * refusal, quota, an outage, a timeout, a refusal or an unusable answer (decision 0077). Used
 * with Claude in front of Gemini: Gemini is another model on a free tier, so trying it costs
 * nothing and often succeeds where Claude did not. When the fallback fails too, its error is
 * the one reported, except that a quota error of either side wins over ai_failed (the client
 * then waits and tries again instead of showing a failure).
 */
export function withAnyFallback(
  primary: AiProvider,
  fallback: () => AiProvider,
  log?: Log,
): AiProvider {
  let second: AiProvider | null = null;
  return {
    name: `${primary.name}>fallback`,
    async generateJson(req) {
      let first: unknown;
      try {
        return await primary.generateJson(req);
      } catch (e) {
        first = e;
      }
      try {
        second ??= fallback();
      } catch {
        throw first; // no fallback can be built (no key): the primary's error stands
      }
      log?.('provider fallback', {
        from: primary.name,
        to: second.name,
        reason: (first instanceof Error ? first.message : String(first)).slice(0, 200),
      });
      try {
        return await second.generateJson(req);
      } catch (e) {
        const quota = (x: unknown) => x instanceof AiError && x.code === 'quota_exceeded';
        if (quota(first) && !quota(e)) throw first;
        throw e;
      }
    },
  };
}

export interface TextAiOptions {
  log?: Log;
  /** Logs each Claude call; default: the function log. */
  recordTextSpend?: RecordTextSpend;
  /** The monthly text budget Claude runs under (decision 0047). Without it Claude is off. */
  budget?: TextBudget;
  /** Use Claude without a budget (tests and fakes only). */
  unbudgeted?: boolean;
  /** What Claude's budget holds are for (text_budget_holds.purpose): the function or job name. */
  purpose?: string;
  fetch?: typeof fetch;
  /** Overrides of the Gemini provider (tests: an instant `sleep`; scripts: longer timeouts). */
  gemini?: Partial<GeminiConfig>;
  /** Overrides of the Claude provider's timeout per call (scripts). */
  claudeTimeoutMs?: number;
}

/** Which provider the chain starts with: AI_TEXT_PRIMARY (claude | gemini), default claude. */
export function textPrimary(env: Env): 'claude' | 'gemini' {
  return (env('AI_TEXT_PRIMARY') ?? '').trim().toLowerCase() === 'gemini' ? 'gemini' : 'claude';
}

/** Whether Claude may be used at all: a key, a budget, and not switched off. */
export function claudeTextEnabled(
  env: Env,
  opts: Pick<TextAiOptions, 'budget' | 'unbudgeted'>,
): boolean {
  if (!env('ANTHROPIC_API_KEY')) return false;
  // AI_CLAUDE_FALLBACK=off (the name from decision 0044) still switches Claude off entirely.
  if ((env('AI_CLAUDE_FALLBACK') ?? '').trim().toLowerCase() === 'off') return false;
  return !!opts.budget || opts.unbudgeted === true;
}

/**
 * The text AI provider from the environment (decision 0077): Claude first, Gemini behind it.
 * Only Claude (no Gemini key) or only Gemini (no Anthropic key, no budget, or Claude switched
 * off) when one side is missing; an error when neither can be built.
 */
export function createTextAiProvider(env: Env, opts: TextAiOptions = {}): AiProvider {
  const useClaude = claudeTextEnabled(env, opts);
  const hasGemini = !!env('GEMINI_API_KEY');
  const claude = () =>
    createClaudeTextProvider({
      apiKey: env('ANTHROPIC_API_KEY')!,
      model: claudeTextModel(env),
      recordTextSpend: opts.recordTextSpend ?? logTextSpend(opts.log),
      purpose: opts.purpose ?? 'text',
      // Gemini catches what Claude cannot answer: one Claude attempt, no SDK retry, so a slow
      // or failing call leaves time for the fallback inside the function's wall clock.
      ...(hasGemini && textPrimary(env) === 'claude' ? { maxAttempts: 1, maxRetries: 0 } : {}),
      ...(opts.claudeTimeoutMs ? { timeoutMs: opts.claudeTimeoutMs } : {}),
      ...(opts.budget ? { budget: opts.budget } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  const gemini = () =>
    createAiProvider(env, {
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...opts.gemini,
    });

  if (!useClaude) return gemini(); // throws ai_failed when GEMINI_API_KEY is missing too
  if (!hasGemini) return claude();
  if (textPrimary(env) === 'gemini') return withQuotaFallback(gemini(), claude, opts.log);
  return withAnyFallback(claude(), gemini, opts.log);
}
