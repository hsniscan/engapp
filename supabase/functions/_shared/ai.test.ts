// @vitest-environment node
// Gemini → Claude Haiku fallback of the text AI tasks (decision 0044). Mocked fetch only:
// no live model call.
import { describe, expect, it } from 'vitest';
import { AiError, type GenerateJsonRequest } from './ai-provider.ts';
import {
  createClaudeTextProvider,
  DEFAULT_CLAUDE_TEXT_MODEL,
  toClaudeSchema,
  type TextSpend,
} from './ai-claude-text.ts';
import { createTextAiProvider, withQuotaFallback } from './ai.ts';
import { runEnrich } from './enrich.ts';
import { ENRICH_RESPONSE_SCHEMA, EXTRACT_RESPONSE_SCHEMA } from './prompts.ts';
import { MemoryAiStore } from './testing/memory-store.ts';
import { MemoryTextBudgetStore } from './text-budget.ts';
import {
  BAD_REQUEST_BODY,
  ENRICH_BANK,
  envelope,
  GOOD_EXTRACT,
  QUOTA_ERROR_BODY,
} from './testing/gemini-fixtures.ts';

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}
type Reply = { status: number; body: unknown };

/** One fake fetch for both APIs: replies are taken per host, the last one repeats. */
function fakeApis(gemini: Reply[], claude: Reply[]) {
  const calls: Call[] = [];
  let g = 0;
  let c = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, body, headers: new Headers(init?.headers) });
    const isClaude = url.includes('anthropic.com');
    const list = isClaude ? claude : gemini;
    const reply = list[Math.min(isClaude ? c++ : g++, list.length - 1)]!;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
    });
  }) as typeof fetch;
  return {
    fetch: fetchFn,
    calls,
    gemini: () => calls.filter((x) => !x.url.includes('anthropic.com')),
    claude: () => calls.filter((x) => x.url.includes('anthropic.com')),
  };
}

const claudeMessage = (payload: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: DEFAULT_CLAUDE_TEXT_MODEL,
  content: [
    { type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1000, output_tokens: 400 },
  ...extra,
});

const QUOTA: Reply = { status: 429, body: QUOTA_ERROR_BODY };
const req: GenerateJsonRequest = {
  system: 'SYS',
  user: 'USER',
  schema: EXTRACT_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
  validate: (d) => (d && typeof d === 'object' && 'candidates' in d ? null : 'no candidates'),
};

const env =
  (vars: Record<string, string>) =>
  (k: string): string | undefined =>
    vars[k];
const BOTH = {
  GEMINI_API_KEY: 'g-key',
  GEMINI_MODEL: 'gem-main',
  GEMINI_FALLBACK_MODEL: 'gem-lite',
  ANTHROPIC_API_KEY: 'a-key',
};

/** Gemini with instant backoff so the quota path does not wait in tests. */
function provider(
  vars: Record<string, string>,
  apis: ReturnType<typeof fakeApis>,
  spend?: TextSpend[],
) {
  return createTextAiProvider(env(vars), {
    fetch: apis.fetch,
    gemini: { sleep: async () => {} },
    ...(spend ? { recordTextSpend: async (s) => void spend.push(s) } : {}),
  });
}

describe('createTextAiProvider', () => {
  it('uses Gemini alone while it answers', async () => {
    const apis = fakeApis([{ status: 200, body: envelope(GOOD_EXTRACT) }], []);
    const r = await provider(BOTH, apis).generateJson(req);
    expect(r.model).toBe('gem-main');
    expect(apis.claude()).toHaveLength(0);
  });

  it('retries the same task on Claude Haiku after both Gemini models run out of quota', async () => {
    const spend: TextSpend[] = [];
    const apis = fakeApis([QUOTA], [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }]);
    const r = await provider(BOTH, apis, spend).generateJson(req);
    expect(r.data).toEqual(GOOD_EXTRACT);
    expect(r.model).toBe(DEFAULT_CLAUDE_TEXT_MODEL);
    // Gemini: 3 attempts on each model first.
    const models = apis.gemini().map((c) => c.url.match(/models\/([^:]+):/)?.[1]);
    expect(models).toEqual([
      'gem-main',
      'gem-main',
      'gem-main',
      'gem-lite',
      'gem-lite',
      'gem-lite',
    ]);
    const [call] = apis.claude();
    expect(call!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call!.headers.get('x-api-key')).toBe('a-key');
    expect(call!.body).toMatchObject({
      model: DEFAULT_CLAUDE_TEXT_MODEL,
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
      output_config: {
        format: { type: 'json_schema', schema: toClaudeSchema(EXTRACT_RESPONSE_SCHEMA) },
      },
    });
    expect(call!.body).not.toHaveProperty('temperature');
    expect(spend).toEqual([
      {
        provider: 'claude',
        model: DEFAULT_CLAUDE_TEXT_MODEL,
        usd: 0.0003, // 1000 × $0.10 + 400 × $0.50 per million
        input_tokens: 1000,
        output_tokens: 400,
      },
    ]);
  });

  it('takes the Claude model from CLAUDE_TEXT_MODEL', async () => {
    const apis = fakeApis([QUOTA], [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }]);
    const r = await provider(
      { ...BOTH, CLAUDE_TEXT_MODEL: 'claude-test-model' },
      apis,
    ).generateJson(req);
    expect(r.model).toBe('claude-test-model');
    expect(apis.claude()[0]!.body.model).toBe('claude-test-model');
  });

  it('does not use Claude for a request error, only for quota', async () => {
    const apis = fakeApis([{ status: 400, body: BAD_REQUEST_BODY }], []);
    await expect(provider(BOTH, apis).generateJson(req)).rejects.toMatchObject({
      code: 'ai_failed',
    });
    expect(apis.claude()).toHaveLength(0);
  });

  it('keeps quota_exceeded without an Anthropic key, or with AI_CLAUDE_FALLBACK=off', async () => {
    for (const vars of [
      { GEMINI_API_KEY: 'g', GEMINI_FALLBACK_MODEL: '' },
      { ...BOTH, GEMINI_FALLBACK_MODEL: '', AI_CLAUDE_FALLBACK: 'off' },
    ]) {
      const apis = fakeApis([QUOTA], []);
      await expect(provider(vars, apis).generateJson(req)).rejects.toMatchObject({
        code: 'quota_exceeded',
      });
      expect(apis.claude()).toHaveLength(0);
    }
  });

  it('uses Claude alone when only the Anthropic key is set', async () => {
    const apis = fakeApis([], [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }]);
    const r = await provider({ ANTHROPIC_API_KEY: 'a' }, apis).generateJson(req);
    expect(r.model).toBe(DEFAULT_CLAUDE_TEXT_MODEL);
  });
});

describe('Claude text provider', () => {
  const claude = (apis: ReturnType<typeof fakeApis>) =>
    createClaudeTextProvider({ apiKey: 'k', model: 'claude-x', fetch: apis.fetch, maxRetries: 0 });

  it('retries once on an answer that fails validation', async () => {
    const apis = fakeApis(
      [],
      [
        { status: 200, body: claudeMessage({ words: [] }) },
        { status: 200, body: claudeMessage(GOOD_EXTRACT) },
      ],
    );
    const r = await claude(apis).generateJson(req);
    expect(r.attempts).toBe(2);
  });

  it('maps a rate limit to quota_exceeded and a refusal to ai_failed', async () => {
    const limited = fakeApis(
      [],
      [
        {
          status: 429,
          body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
        },
      ],
    );
    await expect(claude(limited).generateJson(req)).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    const refused = fakeApis(
      [],
      [{ status: 200, body: claudeMessage('', { stop_reason: 'refusal' }) }],
    );
    await expect(claude(refused).generateJson(req)).rejects.toBeInstanceOf(AiError);
  });

  it('keeps the complete items of an answer cut at max_tokens', async () => {
    const full = JSON.stringify(GOOD_EXTRACT);
    const cut = full.slice(0, full.lastIndexOf('},') + 2) + '{"te';
    const apis = fakeApis(
      [],
      [{ status: 200, body: claudeMessage(cut, { stop_reason: 'max_tokens' }) }],
    );
    const r = await claude(apis).generateJson(req);
    expect(r.truncated).toBe(true);
  });
});

describe('Claude fallback under the monthly text budget', () => {
  const budgeted = (
    apis: ReturnType<typeof fakeApis>,
    store: MemoryTextBudgetStore,
    capUsd: number,
  ) =>
    createClaudeTextProvider({
      apiKey: 'k',
      model: DEFAULT_CLAUDE_TEXT_MODEL,
      fetch: apis.fetch,
      maxRetries: 0,
      budget: { store, capUsd },
    });

  it('reserves before the call and settles the real cost after it', async () => {
    const store = new MemoryTextBudgetStore();
    const apis = fakeApis([], [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }]);
    await budgeted(apis, store, 10).generateJson(req);
    expect(store.spent).toBeGreaterThan(0);
    expect(store.reserved).toBe(0);
  });

  it('sends nothing and answers quota_exceeded when the month is spent', async () => {
    const store = new MemoryTextBudgetStore();
    const apis = fakeApis([], [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }]);
    const e = await budgeted(apis, store, 0.0001)
      .generateJson(req)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiError);
    expect((e as AiError).code).toBe('quota_exceeded');
    expect(apis.claude()).toHaveLength(0);
  });

  it('frees the hold when the API call fails', async () => {
    const store = new MemoryTextBudgetStore();
    const apis = fakeApis(
      [],
      [
        {
          status: 400,
          body: { type: 'error', error: { type: 'invalid_request_error', message: 'x' } },
        },
      ],
    );
    await budgeted(apis, store, 10)
      .generateJson(req)
      .catch(() => {});
    expect(store.reserved).toBe(0);
    expect(store.spent).toBe(0);
  });
});

describe('toClaudeSchema', () => {
  const walk = (s: unknown, visit: (o: Record<string, unknown>) => void) => {
    if (Array.isArray(s)) s.forEach((x) => walk(x, visit));
    else if (s && typeof s === 'object') {
      visit(s as Record<string, unknown>);
      Object.values(s).forEach((x) => walk(x, visit));
    }
  };

  it.each([
    ['extract', EXTRACT_RESPONSE_SCHEMA],
    ['enrich', ENRICH_RESPONSE_SCHEMA],
  ])('%s schema: closed objects, no unsupported keywords, no type unions', (_n, schema) => {
    const out = toClaudeSchema(schema);
    walk(out, (o) => {
      if (o.type === 'object') expect(o.additionalProperties).toBe(false);
      for (const k of ['minimum', 'maximum', 'maxItems', 'minLength', 'maxLength']) {
        expect(o).not.toHaveProperty(k);
      }
      expect(Array.isArray(o.type)).toBe(false);
    });
  });

  it('turns a nullable type into anyOf', () => {
    expect(
      toClaudeSchema({
        type: 'object',
        properties: { a: { type: ['string', 'null'] }, n: { type: 'number', minimum: 0 } },
        required: ['a'],
      }),
    ).toEqual({
      type: 'object',
      properties: { a: { anyOf: [{ type: 'string' }, { type: 'null' }] }, n: { type: 'number' } },
      required: ['a'],
      additionalProperties: false,
    });
  });
});

describe('wired into an existing task (ai-enrich)', () => {
  it('a Gemini quota error ends as a Claude answer with the same validation', async () => {
    const apis = fakeApis([QUOTA], [{ status: 200, body: claudeMessage(ENRICH_BANK) }]);
    const p = provider(BOTH, apis);
    const store = new MemoryAiStore();
    const res = await runEnrich(
      { term: 'bank' },
      { userId: 'u', store, provider: () => p, dailyLimit: 5 },
    );
    expect(res.ai_called).toBe(true);
    expect(res.model).toBe(DEFAULT_CLAUDE_TEXT_MODEL);
    expect(res.senses.length).toBeGreaterThan(0);
  });

  it('withQuotaFallback passes other errors through', async () => {
    const boom = new AiError('ai_failed', 'x');
    const p = withQuotaFallback(
      { name: 'a', generateJson: async () => Promise.reject(boom) },
      () => {
        throw new Error('must not be created');
      },
    );
    await expect(p.generateJson(req)).rejects.toBe(boom);
  });
});
