// @vitest-environment node
// The system jobs' text provider (decision 0077): Claude first under the system pool of the
// monthly text budget, Gemini when the pool is used up, Gemini only without a budget. Mocked
// fetch only: no live model call.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLAUDE_TEXT_MODEL } from '../../supabase/functions/_shared/ai-claude-text.ts';
import { MemoryTextBudgetStore, SYSTEM_POOL } from '../../supabase/functions/_shared/text-budget.ts';
import { envelope } from '../../supabase/functions/_shared/testing/gemini-fixtures.ts';
import { createSystemTextProvider, systemTextAiAvailable } from './system-ai.ts';

const ANSWER = { results: [] };
const req = {
  system: 'SYS',
  user: 'USER',
  schema: { type: 'object', properties: { results: { type: 'array' } }, required: ['results'] },
  maxOutputTokens: 8192,
};

function fakeApis() {
  const hosts: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    const claude = url.includes('anthropic.com');
    hosts.push(claude ? 'claude' : 'gemini');
    const body = claude
      ? {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: DEFAULT_CLAUDE_TEXT_MODEL,
          content: [{ type: 'text', text: JSON.stringify(ANSWER) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 2700, output_tokens: 1400 },
        }
      : envelope(ANSWER);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
    });
  }) as typeof fetch;
  return { fetch: fetchFn, hosts };
}

const env =
  (vars: Record<string, string>) =>
  (k: string): string | undefined =>
    vars[k];
const BOTH = env({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gem-main' });

describe('createSystemTextProvider', () => {
  it('books every Claude call on the system pool and the month', async () => {
    const store = new MemoryTextBudgetStore();
    const apis = fakeApis();
    const p = createSystemTextProvider(BOTH, { store, purpose: 'levels', fetch: apis.fetch });
    const r = await p.generateJson(req);
    expect(r.model).toBe(DEFAULT_CLAUDE_TEXT_MODEL);
    expect(apis.hosts).toEqual(['claude']);
    // 2 700 × $2 + 1 400 × $10 per million.
    expect(store.pools.get(SYSTEM_POOL)).toEqual({ spent: 0.0194, reserved: 0 });
    expect(store.spent).toBe(0.0194);
  });

  it('goes on with Gemini once the pool (1.5 USD of a 10 USD month) is used up', async () => {
    const store = new MemoryTextBudgetStore();
    store.pools.set(SYSTEM_POOL, { spent: 1.45, reserved: 0 });
    store.spent = 1.45;
    const apis = fakeApis();
    const tenUsd = env({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gem-main', CLAUDE_TEXT_MONTHLY_USD: '10' });
    const p = createSystemTextProvider(tenUsd, { store, purpose: 'levels', fetch: apis.fetch });
    const r = await p.generateJson(req);
    expect(r.model).toBe('gem-main');
    expect(apis.hosts).toEqual(['gemini']);
    expect(store.spent).toBe(1.45);
  });

  it('never uses Claude without a budget (a local run without the database)', async () => {
    const apis = fakeApis();
    const p = createSystemTextProvider(BOTH, { db: null, purpose: 'levels', fetch: apis.fetch });
    expect((await p.generateJson(req)).model).toBe('gem-main');
    expect(apis.hosts).toEqual(['gemini']);
    expect(systemTextAiAvailable(env({ ANTHROPIC_API_KEY: 'a' }), { db: null })).toBe(false);
    expect(
      systemTextAiAvailable(env({ ANTHROPIC_API_KEY: 'a' }), { store: new MemoryTextBudgetStore() }),
    ).toBe(true);
    expect(systemTextAiAvailable(env({ GEMINI_API_KEY: 'g' }), { db: null })).toBe(true);
  });
});
