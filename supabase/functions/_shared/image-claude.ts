// The Claude client of the picture pipeline: the official SDK, shared by the ai-image edge
// function (Deno, npm specifier from the import map) and the Node jobs. The API key comes only
// from the environment (ANTHROPIC_API_KEY, a Supabase function secret / GitHub secret) and is
// never logged.

import Anthropic from '@anthropic-ai/sdk';
import type { CalledMessage, ClaudeCall } from './image-pipeline.ts';
import { withServerFallback } from './image-prompt.ts';

type Env = (key: string) => string | undefined;

export function createAnthropic(env: Env, opts: { timeoutMs?: number } = {}): Anthropic {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  return new Anthropic({ apiKey, timeout: opts.timeoutMs ?? 120_000, maxRetries: 2 });
}

/** Messages API call; instant Opus calls add the server-side refusal fallback. */
export function claudeCall(client: Anthropic): ClaudeCall {
  return async (params, { fallback }): Promise<CalledMessage> => {
    const msg = fallback
      ? await client.beta.messages.create(withServerFallback(params))
      : await client.messages.create(params);
    return msg as unknown as CalledMessage;
  };
}

/** Transient errors worth a later retry (rate limit, overload, network), vs. our own bugs. */
export function isTransientClaudeError(e: unknown): boolean {
  if (e instanceof Anthropic.RateLimitError) return true;
  if (e instanceof Anthropic.InternalServerError) return true;
  if (e instanceof Anthropic.APIConnectionError) return true;
  return e instanceof Anthropic.APIError && (e.status === 529 || e.status === 503);
}
