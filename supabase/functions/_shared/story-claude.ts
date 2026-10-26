// The daily story's model (decision 0050): Claude Haiku through the text provider of
// ai-claude-text.ts (structured output, the same schema conversion and JSON handling), one
// answered call per `call`. The model id comes only from CLAUDE_STORY_MODEL, else
// CLAUDE_TEXT_MODEL, else the provider's default (AGENTS.md rule 5); the key only from
// ANTHROPIC_API_KEY. The monthly text budget is applied by the pipeline (story.ts), which
// wraps every call in recordTextSpend with the cost reported here.

import { claudeTextModel, createClaudeTextProvider, type TextSpend } from './ai-claude-text.ts';
import type { StoryModel } from './story.ts';

type Env = (key: string) => string | undefined;
type Log = (msg: string, data?: Record<string, unknown>) => void;

export function claudeStoryModel(env: Env): string {
  return env('CLAUDE_STORY_MODEL')?.trim() || claudeTextModel(env);
}

export interface ClaudeStoryConfig {
  apiKey: string;
  model: string;
  log?: Log;
  fetch?: typeof fetch;
  baseURL?: string;
}

export function createClaudeStoryModel(cfg: ClaudeStoryConfig): StoryModel {
  return {
    model: cfg.model,
    async call(req) {
      // A provider per call: the spend callback below belongs to this call alone.
      const seen: { usd: number; model: string | null } = { usd: 0, model: null };
      const provider = createClaudeTextProvider({
        apiKey: cfg.apiKey,
        model: cfg.model,
        timeoutMs: req.timeoutMs,
        maxRetries: 1,
        // The pipeline decides about a second try (and budgets it).
        maxAttempts: 1,
        recordTextSpend: async (s: TextSpend) => {
          seen.usd += s.usd;
          seen.model = s.model;
          cfg.log?.('text spend', { ...s, purpose: 'story' });
        },
        ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
        ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      });
      try {
        const r = await provider.generateJson({
          system: req.system,
          user: req.user,
          schema: req.schema,
          maxOutputTokens: req.maxOutputTokens,
          timeoutMs: req.timeoutMs,
        });
        return { data: r.data, costUsd: seen.usd, model: seen.model ?? r.model };
      } catch (e) {
        // Answered (and billed) but unusable (not JSON, a refusal): the pipeline books the
        // cost and may try once more.
        if (seen.model !== null) {
          cfg.log?.('ai-story answer not usable', { error: e instanceof Error ? e.message : String(e) });
          return { data: undefined, costUsd: seen.usd, model: seen.model };
        }
        throw e;
      }
    },
  };
}

export function storyModelFromEnv(env: Env, log?: Log, fetchImpl?: typeof fetch): (() => StoryModel) | null {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return null;
  const model = claudeStoryModel(env);
  return () =>
    createClaudeStoryModel({ apiKey: key, model, ...(log ? { log } : {}), ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}
