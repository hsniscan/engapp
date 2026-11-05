// @vitest-environment node
// Provider chain of the text AI tasks: Claude Sonnet first, Gemini behind it (decision 0077;
// before that Gemini → Claude Haiku, decision 0044). Mocked fetch only: no live model call.
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
import { CONTRAST_RESPONSE_SCHEMA } from './contrast-prompt.ts';
import { LEVEL_GUESS_RESPONSE_SCHEMA, LEVEL_TR_RESPONSE_SCHEMA } from './level-job.ts';
import { MNEMONIC_RESPONSE_SCHEMA } from './mnemonic-prompt.ts';
import { MORPHEME_RESPONSE_SCHEMA } from './morphemes.ts';
import { REPORT_RESPONSE_SCHEMA } from './report-prompt.ts';
import { STORY_RESPONSE_SCHEMA } from './story-prompt.ts';
import { THEMES_RESPONSE_SCHEMA } from './themes.ts';
import { MemoryAiStore } from './testing/memory-store.ts';
import { forUser, MemoryTextBudgetStore, type TextBudget } from './text-budget.ts';
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
  opts: { spend?: TextSpend[]; budget?: TextBudget | null; purpose?: string } = {},
) {
  const budget =
    opts.budget === null ? undefined : (opts.budget ?? { store: new MemoryTextBudgetStore(), capUsd: 10 });
  return createTextAiProvider(env(vars), {
    fetch: apis.fetch,
    gemini: { sleep: async () => {} },
    ...(budget ? { budget } : {}),
    ...(opts.purpose ? { purpose: opts.purpose } : {}),
    ...(opts.spend ? { recordTextSpend: async (s) => void opts.spend!.push(s) } : {}),
  });
}

const geminiModels = (apis: ReturnType<typeof fakeApis>) =>
  apis.gemini().map((c) => c.url.match(/models\/([^:]+):/)?.[1]);

describe('createTextAiProvider (decision 0077: Claude Sonnet first, Gemini behind it)', () => {
  it('defaults to Claude Sonnet', () => {
    expect(DEFAULT_CLAUDE_TEXT_MODEL).toBe('claude-sonnet-5-5');
  });

  it('asks Claude first and never Gemini while Claude answers', async () => {
    const spend: TextSpend[] = [];
    const apis = fakeApis(
      [{ status: 200, body: envelope(GOOD_EXTRACT) }],
      [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }],
    );
    const r = await provider(BOTH, apis, { spend }).generateJson(req);
    expect(r.data).toEqual(GOOD_EXTRACT);
    expect(r.model).toBe(DEFAULT_CLAUDE_TEXT_MODEL);
    expect(apis.gemini()).toHaveLength(0);
    const [call] = apis.claude();
    expect(call!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call!.headers.get('x-api-key')).toBe('a-key');
    expect(call!.body).toMatchObject({
      model: DEFAULT_CLAUDE_TEXT_MODEL,
      // Sonnet: no extended thinking, no room reserved for it.
      thinking: { type: 'between_tools' },
      max_tokens: 8192,
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'USER' }],
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: toClaudeSchema(EXTRACT_RESPONSE_SCHEMA) },
      },
    });
    // The current models reject sampling parameters, prefill and forced tool choice.
    for (const k of ['temperature', 'top_p', 'top_k', 'tool_choice', 'tools'])
      expect(call!.body).not.toHaveProperty(k);
    expect(spend).toEqual([
      {
        provider: 'claude',
        model: DEFAULT_CLAUDE_TEXT_MODEL,
        usd: 0.006, // 1000 × $2 + 400 × $10 per million
        input_tokens: 1000,
        output_tokens: 400,
      },
    ]);
  });

  it('falls back to Gemini when the monthly text budget is used up (Claude is not called)', async () => {
    const store = new MemoryTextBudgetStore();
    const apis = fakeApis(
      [{ status: 200, body: envelope(GOOD_EXTRACT) }],
      [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }],
    );
    const r = await provider(BOTH, apis, { budget: { store, capUsd: 0.0001 } }).generateJson(req);
    expect(r.model).toBe('gem-main');
    expect(apis.claude()).toHaveLength(0);
    expect(store.spent).toBe(0);
    expect(store.reserved).toBe(0);
  });

  it("falls back to Gemini when the user's monthly share is used up", async () => {
    const store = new MemoryTextBudgetStore();
    const apis = fakeApis(
      [{ status: 200, body: envelope(GOOD_EXTRACT) }],
      [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }],
    );
    const budget = forUser({ store, capUsd: 10 }, 'u1', 0.0001);
    const r = await provider(BOTH, apis, { budget }).generateJson(req);
    expect(r.model).toBe('gem-main');
    expect(apis.claude()).toHaveLength(0);
  });

  it.each([
    ['overloaded (529)', { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } } }],
    ['rate limited (429)', { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } } }],
    ['down (500)', { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'x' } } }],
    ['a bad key (401)', { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'x' } } }],
    ['a request it rejects (400)', { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'x' } } }],
    ['an answer that fails validation', { status: 200, body: claudeMessage({ words: [] }) }],
    ['a refusal', { status: 200, body: claudeMessage('', { stop_reason: 'refusal' }) }],
  ] as [string, Reply][])('falls back to Gemini when Claude gives %s', async (_n, reply) => {
    const store = new MemoryTextBudgetStore();
    const apis = fakeApis([{ status: 200, body: envelope(GOOD_EXTRACT) }], [reply]);
    const r = await provider(BOTH, apis, { budget: { store, capUsd: 10 } }).generateJson(req);
    expect(r.model).toBe('gem-main');
    // One Claude call only (no SDK retry, no second attempt): Gemini takes it from there.
    expect(apis.claude()).toHaveLength(1);
    expect(store.reserved).toBe(0);
  });

  it('keeps the whole reservation of a Claude call that timed out (it may be billed)', async () => {
    const store = new MemoryTextBudgetStore();
    const apis = fakeApis([{ status: 200, body: envelope(GOOD_EXTRACT) }], []);
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('anthropic.com')) throw new TypeError('fetch failed');
      return apis.fetch(input, init);
    }) as typeof fetch;
    const p = createTextAiProvider(env(BOTH), {
      fetch: fetchFn,
      gemini: { sleep: async () => {} },
      budget: { store, capUsd: 10 },
    });
    const r = await p.generateJson(req);
    expect(r.model).toBe('gem-main');
    expect(store.reserved).toBe(0);
    expect(store.spent).toBeGreaterThan(0.08); // the bound of 8192 output tokens on Sonnet
  });

  it('reports quota_exceeded when the budget is used up and Gemini runs out of quota too', async () => {
    const apis = fakeApis([QUOTA], []);
    const e = await provider(BOTH, apis, { budget: { store: new MemoryTextBudgetStore(), capUsd: 0.0001 } })
      .generateJson(req)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiError);
    expect((e as AiError).code).toBe('quota_exceeded');
    expect(geminiModels(apis)).toEqual(['gem-main', 'gem-main', 'gem-main', 'gem-lite', 'gem-lite', 'gem-lite']);
  });

  it('a quota error wins over the fallback failing', async () => {
    const apis = fakeApis(
      [{ status: 400, body: BAD_REQUEST_BODY }],
      [{ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } } }],
    );
    await expect(provider(BOTH, apis).generateJson(req)).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
  });

  it('takes the Claude model from CLAUDE_TEXT_MODEL (a thinking model gets room for it)', async () => {
    const apis = fakeApis([], [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }]);
    const r = await provider({ ...BOTH, CLAUDE_TEXT_MODEL: 'claude-test-model' }, apis).generateJson(req);
    expect(r.model).toBe('claude-test-model');
    const body = apis.claude()[0]!.body;
    expect(body.model).toBe('claude-test-model');
    expect(body).not.toHaveProperty('thinking');
    expect(body.max_tokens).toBe(8192 + 2048);
  });

  it('books the hold under the calling function', async () => {
    const store = new MemoryTextBudgetStore();
    const purposes: string[] = [];
    const orig = store.reserveForUser.bind(store);
    store.reserveForUser = (a, c, purpose, u, uc) => {
      purposes.push(purpose);
      return orig(a, c, purpose, u, uc);
    };
    const apis = fakeApis([], [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }]);
    await provider(BOTH, apis, {
      budget: forUser({ store, capUsd: 10 }, 'u1', 5),
      purpose: 'ai-extract',
    }).generateJson(req);
    // The database accepts ^[a-z][a-z0-9_]{0,31}$ only.
    expect(purposes).toEqual(['ai_extract']);
    expect(store.users.get('u1')!.spent).toBeGreaterThan(0);
  });

  it('uses Claude alone without a Gemini key, and reports quota_exceeded when its budget is gone', async () => {
    const ok = fakeApis([], [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }]);
    expect((await provider({ ANTHROPIC_API_KEY: 'a' }, ok).generateJson(req)).model).toBe(
      DEFAULT_CLAUDE_TEXT_MODEL,
    );
    const spent = fakeApis([], [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }]);
    await expect(
      provider({ ANTHROPIC_API_KEY: 'a' }, spent, {
        budget: { store: new MemoryTextBudgetStore(), capUsd: 0.0001 },
      }).generateJson(req),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(spent.claude()).toHaveLength(0);
  });

  it.each([
    ['without an Anthropic key', { GEMINI_API_KEY: 'g-key', GEMINI_MODEL: 'gem-main' }, undefined],
    ['with AI_CLAUDE_FALLBACK=off', { ...BOTH, AI_CLAUDE_FALLBACK: 'off' }, undefined],
    ['without a budget (Claude never runs unguarded)', BOTH, null],
  ] as [string, Record<string, string>, null | undefined][])(
    'uses Gemini alone %s',
    async (_n, vars, budget) => {
      const apis = fakeApis(
        [{ status: 200, body: envelope(GOOD_EXTRACT) }],
        [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }],
      );
      const r = await provider(vars, apis, { budget }).generateJson(req);
      expect(r.model).toBe('gem-main');
      expect(apis.claude()).toHaveLength(0);
    },
  );

  it('fails clearly when neither key is set', () => {
    expect(() => provider({}, fakeApis([], []))).toThrow(/GEMINI_API_KEY/);
  });

  it('AI_TEXT_PRIMARY=gemini restores the old order: Gemini, then Claude on quota only', async () => {
    const vars = { ...BOTH, AI_TEXT_PRIMARY: 'gemini' };
    const first = fakeApis([{ status: 200, body: envelope(GOOD_EXTRACT) }], []);
    expect((await provider(vars, first).generateJson(req)).model).toBe('gem-main');
    expect(first.claude()).toHaveLength(0);

    const quota = fakeApis([QUOTA], [{ status: 200, body: claudeMessage(GOOD_EXTRACT) }]);
    expect((await provider(vars, quota).generateJson(req)).model).toBe(DEFAULT_CLAUDE_TEXT_MODEL);
    expect(geminiModels(quota)).toHaveLength(6);

    const bad = fakeApis([{ status: 400, body: BAD_REQUEST_BODY }], []);
    await expect(provider(vars, bad).generateJson(req)).rejects.toMatchObject({ code: 'ai_failed' });
    expect(bad.claude()).toHaveLength(0);
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

  // Every text task Claude now answers first (decision 0077).
  it.each([
    ['extract', EXTRACT_RESPONSE_SCHEMA],
    ['enrich', ENRICH_RESPONSE_SCHEMA],
    ['themes', THEMES_RESPONSE_SCHEMA],
    ['mnemonic', MNEMONIC_RESPONSE_SCHEMA],
    ['contrast', CONTRAST_RESPONSE_SCHEMA],
    ['report', REPORT_RESPONSE_SCHEMA],
    ['story', STORY_RESPONSE_SCHEMA],
    ['level-tr', LEVEL_TR_RESPONSE_SCHEMA],
    ['level-guess', LEVEL_GUESS_RESPONSE_SCHEMA],
    ['morpheme', MORPHEME_RESPONSE_SCHEMA],
  ] as [string, unknown][])('%s schema: closed objects, no unsupported keywords, no type unions', (_n, schema) => {
    const out = toClaudeSchema(schema);
    walk(out, (o) => {
      if (o.type === 'object') {
        expect(o.additionalProperties).toBe(false);
        const props = Object.keys((o.properties as Record<string, unknown> | undefined) ?? {});
        for (const r of (o.required as string[] | undefined) ?? []) expect(props).toContain(r);
      }
      for (const k of ['minimum', 'maximum', 'maxItems', 'minLength', 'maxLength', 'pattern', 'nullable']) {
        expect(o).not.toHaveProperty(k);
      }
      if ('minItems' in o) expect([0, 1]).toContain(o.minItems);
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
  it('Claude answers with the same validation', async () => {
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
    expect(apis.gemini()).toHaveLength(0);
  });

  it('a used-up budget ends as a Gemini answer with the same validation', async () => {
    const apis = fakeApis([{ status: 200, body: envelope(ENRICH_BANK) }], []);
    const p = provider(BOTH, apis, { budget: { store: new MemoryTextBudgetStore(), capUsd: 0.0001 } });
    const res = await runEnrich(
      { term: 'bank' },
      { userId: 'u', store: new MemoryAiStore(), provider: () => p, dailyLimit: 5 },
    );
    expect(res.model).toBe('gem-main');
    expect(res.senses.length).toBeGreaterThan(0);
    expect(apis.claude()).toHaveLength(0);
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
