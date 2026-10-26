// Provider chain of the text AI tasks (plan A.8, decision 0044). The pipelines still see one
// AiProvider: Gemini (its model, then GEMINI_FALLBACK_MODEL, ai-provider.ts) and, when
// Gemini answers with quota exhaustion (429 / RESOURCE_EXHAUSTED, or 503 overload) after
// both, the same request on Claude Haiku (ai-claude-text.ts). Other failures are not
// retried on Claude: a bad request or a broken answer would fail there too.

import { AiError, createAiProvider, type AiProvider, type GeminiConfig } from './ai-provider.ts';
import {
  claudeTextModel,
  createClaudeTextProvider,
  logTextSpend,
  type RecordTextSpend,
} from './ai-claude-text.ts';

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

export interface TextAiOptions {
  log?: Log;
  /** Seam for the monthly text budget (TODO v0.5 merge, see RecordTextSpend). */
  recordTextSpend?: RecordTextSpend;
  fetch?: typeof fetch;
  /** Overrides of the Gemini provider (tests: an instant `sleep`). */
  gemini?: Partial<GeminiConfig>;
}

/**
 * The text AI provider from the environment: Gemini with the Claude fallback when
 * ANTHROPIC_API_KEY is set (AI_CLAUDE_FALLBACK=off disables it). Without a Gemini key but
 * with a Claude key, Claude alone.
 */
export function createTextAiProvider(env: Env, opts: TextAiOptions = {}): AiProvider {
  const key = env('ANTHROPIC_API_KEY');
  const enabled = !!key && (env('AI_CLAUDE_FALLBACK') ?? '').toLowerCase() !== 'off';
  const claude = () =>
    createClaudeTextProvider({
      apiKey: key!,
      model: claudeTextModel(env),
      recordTextSpend: opts.recordTextSpend ?? logTextSpend(opts.log),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  let gemini: AiProvider;
  try {
    gemini = createAiProvider(env, {
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...opts.gemini,
    });
  } catch (e) {
    if (enabled) return claude();
    throw e;
  }
  return enabled ? withQuotaFallback(gemini, claude, opts.log) : gemini;
}
