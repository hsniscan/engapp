// Claude Haiku as the second provider of the text AI tasks (v0.5, plan A.8, decision 0044):
// when Gemini runs out of quota after its own fallback model, the same request (system
// prompt, user text, JSON schema, validator) runs on Claude with structured output.
// The official SDK; the key comes only from ANTHROPIC_API_KEY, the model only from
// CLAUDE_TEXT_MODEL (default below, AGENTS.md rule 5).

import Anthropic from '@anthropic-ai/sdk';
import {
  AiError,
  salvageTruncatedJson,
  type AiProvider,
  type GenerateJsonRequest,
  type GenerateJsonResult,
} from './ai-provider.ts';
import { callCostUsd, reserveUsd, tokenBound } from './image-models.ts';
import { reserveTextBudget, settleTextBudget, type TextBudget } from './text-budget.ts';

type Env = (key: string) => string | undefined;

/** Used when CLAUDE_TEXT_MODEL is unset (like DEFAULT_GEMINI_MODEL). */
export const DEFAULT_CLAUDE_TEXT_MODEL = 'claude-haiku-5-5';

export function claudeTextModel(env: Env): string {
  return env('CLAUDE_TEXT_MODEL')?.trim() || DEFAULT_CLAUDE_TEXT_MODEL;
}

/** One finished Claude text call, for the monthly text budget. */
export interface TextSpend {
  provider: 'claude';
  model: string;
  usd: number;
  input_tokens: number;
  output_tokens: number;
}

/**
 * Logs every answered Claude text call (USD and tokens). The monthly cap itself is enforced
 * by `budget` (text-budget.ts, decision 0047). Called after every Claude call; must never throw.
 */
export type RecordTextSpend = (spend: TextSpend) => Promise<void>;

export function logTextSpend(
  log?: (m: string, d?: Record<string, unknown>) => void,
): RecordTextSpend {
  return async (spend) => {
    (log ?? ((m, d) => console.log(JSON.stringify({ msg: m, ...d }))))('text spend', { ...spend });
  };
}

export interface ClaudeTextConfig {
  apiKey: string;
  model: string;
  /** Per-call timeout; default 60 s. */
  timeoutMs?: number;
  /** SDK retries on 408/409/429/5xx and connection errors; default 1. */
  maxRetries?: number;
  /** Attempts when the answer fails validation; default 2. */
  maxAttempts?: number;
  recordTextSpend?: RecordTextSpend;
  /**
   * The monthly text budget (CLAUDE_TEXT_MONTHLY_USD). Each call reserves its worst case first
   * and settles the real cost; a call the budget cannot cover is not sent and fails as
   * `quota_exceeded`. Absent: no cap (tests, local runs).
   */
  budget?: TextBudget;
  fetch?: typeof fetch;
  baseURL?: string;
}

const UNSUPPORTED = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
  'uniqueItems',
  'pattern',
  'propertyOrdering',
  'nullable',
  'default',
]);
const FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

/**
 * The task's Gemini JSON schema in the subset Claude's structured outputs accept: every
 * object closed (additionalProperties false), numeric / length / item-count constraints
 * dropped (the task's own validator still checks them), `type: [X, 'null']` as anyOf.
 */
export function toClaudeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toClaudeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (UNSUPPORTED.has(k)) continue;
    if (k === 'format' && !(typeof v === 'string' && FORMATS.has(v))) continue;
    if (k === 'minItems' && !(v === 0 || v === 1)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([p, s]) => [p, toClaudeSchema(s)]),
      );
    } else if (k === 'items' || k === 'anyOf' || k === 'allOf' || k === '$defs') {
      out[k] =
        k === '$defs' && v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(
              Object.entries(v as Record<string, unknown>).map(([p, s]) => [p, toClaudeSchema(s)]),
            )
          : toClaudeSchema(v);
    } else {
      out[k] = v;
    }
  }
  const type = out.type;
  if (type === 'object' || (Array.isArray(type) && type.includes('object'))) {
    out.additionalProperties = false;
  }
  if (Array.isArray(type)) {
    const types = type.filter((t): t is string => typeof t === 'string');
    if (types.length === 1) {
      out.type = types[0];
    } else if (types.length > 1) {
      // {type: ['object', 'null'], properties...} → anyOf [{type: 'object', properties...}, {type: 'null'}]
      const { type: _t, ...rest } = out;
      void _t;
      const nonNull = types.filter((t) => t !== 'null');
      const variants = nonNull.map((t) => {
        const v: Record<string, unknown> = { ...rest, type: t };
        if (t !== 'object') {
          delete v.properties;
          delete v.required;
          delete v.additionalProperties;
        }
        if (t !== 'array') delete v.items;
        if (t !== 'string') delete v.enum;
        return v;
      });
      const anyOf = types.includes('null') ? [...variants, { type: 'null' }] : variants;
      const keep: Record<string, unknown> = {};
      if (typeof rest.description === 'string') keep.description = rest.description;
      return { ...keep, anyOf };
    }
  }
  return out;
}

function isQuota(e: unknown): boolean {
  if (e instanceof Anthropic.RateLimitError) return true;
  return e instanceof Anthropic.APIError && (e.status === 529 || e.status === 503);
}

export function createClaudeTextProvider(cfg: ClaudeTextConfig): AiProvider {
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    timeout: cfg.timeoutMs ?? 60_000,
    maxRetries: cfg.maxRetries ?? 1,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
  });
  const maxAttempts = cfg.maxAttempts ?? 2;
  const record = cfg.recordTextSpend ?? logTextSpend();

  return {
    name: 'claude',
    async generateJson(req: GenerateJsonRequest): Promise<GenerateJsonResult> {
      const schema = toClaudeSchema(req.schema) as Record<string, unknown>;
      let last = 'no attempt';
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const maxTokens = (req.maxOutputTokens ?? 8192) + 2048;
        let hold: string | null = null;
        if (cfg.budget) {
          const bound = reserveUsd(cfg.model, {
            inputTokens: tokenBound(req.system + req.user),
            maxTokens,
          });
          hold = await reserveTextBudget(cfg.budget, bound, 'ai-fallback');
          if (!hold) throw new AiError('quota_exceeded', `${cfg.model}: monthly text budget`, 3600);
        }
        let msg: Anthropic.Message;
        try {
          msg = await client.messages.create(
            {
              model: cfg.model,
              // Haiku thinks adaptively; leave room for it on top of the answer.
              max_tokens: maxTokens,
              output_config: { effort: 'low', format: { type: 'json_schema', schema } },
              system: req.system,
              messages: [{ role: 'user', content: req.user }],
            },
            req.timeoutMs ? { timeout: req.timeoutMs } : undefined,
          );
        } catch (e) {
          if (hold) await settleTextBudget(cfg.budget!, hold, 0).catch(() => {});
          const m = e instanceof Error ? e.message : String(e);
          if (isQuota(e)) throw new AiError('quota_exceeded', `${cfg.model}: ${m}`, 60);
          throw new AiError('ai_failed', `${cfg.model}: ${m}`);
        }

        const usage = {
          input_tokens: msg.usage?.input_tokens ?? 0,
          output_tokens: msg.usage?.output_tokens ?? 0,
          thinking_tokens: 0,
        };
        // Every answered call is billed, valid or not.
        const usd = callCostUsd(cfg.model, msg.usage);
        if (hold) await settleTextBudget(cfg.budget!, hold, usd).catch(() => {});
        await record({
          provider: 'claude',
          model: msg.model || cfg.model,
          usd,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        }).catch(() => {});

        if (msg.stop_reason === 'refusal') throw new AiError('ai_failed', `${cfg.model}: refusal`);
        const text = msg.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        let data: unknown;
        let truncated = false;
        try {
          data = JSON.parse(text);
        } catch {
          const salvaged = msg.stop_reason === 'max_tokens' ? salvageTruncatedJson(text) : null;
          if (salvaged !== null && !req.validate?.(salvaged)) {
            data = salvaged;
            truncated = true;
          }
        }
        if (data === undefined) {
          last = `${cfg.model}: response is not valid JSON (stop ${msg.stop_reason})`;
          continue;
        }
        const problem = req.validate?.(data) ?? null;
        if (problem) {
          last = `${cfg.model}: schema mismatch: ${problem}`;
          continue;
        }
        return {
          data,
          model: cfg.model,
          attempts: attempt,
          usage,
          ...(truncated ? { truncated } : {}),
        };
      }
      throw new AiError('ai_failed', last);
    },
  };
}
