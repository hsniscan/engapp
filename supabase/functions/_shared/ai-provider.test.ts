// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  AiError,
  classifyHttpError,
  createAiProvider,
  createGeminiProvider,
  salvageTruncatedJson,
} from './ai-provider.ts';
import {
  BAD_REQUEST_BODY,
  envelope,
  fakeFetch,
  GOOD_EXTRACT,
  NOT_FOUND_BODY,
  OVERLOADED_BODY,
  QUOTA_ERROR_BODY,
  SCHEMA_ERROR,
} from './testing/gemini-fixtures.ts';

const req = {
  system: 'SYS',
  user: 'USER',
  schema: { type: 'object' },
  validate: (d: unknown) =>
    d && typeof d === 'object' && 'candidates' in d ? null : 'no candidates',
};

function provider(
  replies: Parameters<typeof fakeFetch>[0],
  extra: Partial<Parameters<typeof createGeminiProvider>[0]> = {},
) {
  const f = fakeFetch(replies);
  const sleep = vi.fn(async (_ms: number) => {});
  const p = createGeminiProvider({
    apiKey: 'test-key',
    model: 'primary-m',
    fallbackModel: 'fallback-m',
    fetch: f.fetch,
    sleep,
    ...extra,
  });
  return { p, calls: f.calls, sleep };
}

describe('gemini provider', () => {
  it('sends a structured-output request and ignores thought parts', async () => {
    const { p, calls } = provider([{ status: 200, body: envelope(GOOD_EXTRACT) }]);
    const r = await p.generateJson(req);
    expect(r.data).toEqual(GOOD_EXTRACT);
    expect(r.model).toBe('primary-m');
    expect(r.usage).toEqual({ input_tokens: 1233, output_tokens: 410, thinking_tokens: 12 });
    expect(calls[0]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/primary-m:generateContent',
    );
    expect(calls[0]!.headers['x-goog-api-key']).toBe('test-key');
    expect(calls[0]!.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'SYS' }] },
      contents: [{ role: 'user', parts: [{ text: 'USER' }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseJsonSchema: { type: 'object' },
      },
    });
  });

  it('retries a quota error with exponential backoff, honouring RetryInfo', async () => {
    const { p, calls, sleep } = provider([
      { status: 429, body: QUOTA_ERROR_BODY },
      {
        status: 429,
        body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } },
      },
      { status: 200, body: envelope(GOOD_EXTRACT) },
    ]);
    const r = await p.generateJson(req);
    expect(r.attempts).toBe(3);
    expect(calls.every((c) => c.url.includes('primary-m'))).toBe(true);
    const waits = sleep.mock.calls.map((c) => c[0] as number);
    expect(waits[0]).toBeGreaterThanOrEqual(3000); // RetryInfo 3s > 1s backoff
    expect(waits[1]).toBeGreaterThanOrEqual(2000); // 2nd backoff step
  });

  it('falls back to GEMINI_FALLBACK_MODEL when the primary stays overloaded (503)', async () => {
    const { p, calls } = provider([
      { status: 503, body: OVERLOADED_BODY },
      { status: 503, body: OVERLOADED_BODY },
      { status: 503, body: OVERLOADED_BODY },
      { status: 200, body: envelope(GOOD_EXTRACT) },
    ]);
    const r = await p.generateJson(req);
    expect(r.model).toBe('fallback-m');
    expect(calls.map((c) => c.url.match(/models\/([^:]+)/)![1])).toEqual([
      'primary-m',
      'primary-m',
      'primary-m',
      'fallback-m',
    ]);
  });

  it('reports quota_exceeded when both models are exhausted', async () => {
    const { p, calls } = provider([{ status: 429, body: QUOTA_ERROR_BODY }]);
    const err = await p.generateJson(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe('quota_exceeded');
    expect((err as AiError).retryAfterS).toBe(3);
    expect(calls).toHaveLength(6);
  });

  it('times out each attempt and ends with ai_failed', async () => {
    const { p, calls } = provider(['timeout'], { timeoutMs: 5, fallbackModel: null });
    const err = await p.generateJson(req).catch((e: unknown) => e);
    expect((err as AiError).code).toBe('ai_failed');
    expect((err as AiError).message).toMatch(/timeout/);
    expect(calls).toHaveLength(3);
  });

  it('retries output that does not match the schema', async () => {
    const { p, calls } = provider([
      { status: 200, body: envelope(SCHEMA_ERROR) },
      { status: 200, body: envelope(GOOD_EXTRACT) },
    ]);
    const r = await p.generateJson(req);
    expect(r.data).toEqual(GOOD_EXTRACT);
    expect(calls).toHaveLength(2);
  });

  it('retries a response whose text is not JSON (e.g. cut off by MAX_TOKENS)', async () => {
    const truncated = envelope(GOOD_EXTRACT);
    truncated.candidates[0]!.content.parts[1]!.text = '{"candidates": [{"term": "give';
    truncated.candidates[0]!.finishReason = 'MAX_TOKENS';
    const { p } = provider([
      { status: 200, body: truncated },
      { status: 200, body: envelope(GOOD_EXTRACT) },
    ]);
    expect((await p.generateJson(req)).attempts).toBe(2);
  });

  it('keeps the complete items of a long answer cut off by MAX_TOKENS (no retry)', async () => {
    const full = JSON.stringify(GOOD_EXTRACT);
    const cut = full.slice(0, full.indexOf('"turn down"') + 5); // inside the third item
    const truncated = envelope(GOOD_EXTRACT);
    truncated.candidates[0]!.content.parts[1]!.text = cut;
    truncated.candidates[0]!.finishReason = 'MAX_TOKENS';
    const { p, calls } = provider([{ status: 200, body: truncated }]);
    const r = await p.generateJson(req);
    expect(calls).toHaveLength(1);
    expect(r.truncated).toBe(true);
    expect(r.data).toEqual({ candidates: GOOD_EXTRACT.candidates.slice(0, 2) });
  });

  it('salvageTruncatedJson handles strings with brackets and escapes', () => {
    expect(salvageTruncatedJson('{"a": [{"t": "x]}\\"{"}, {"t": "y"}, {"t": "z')).toEqual({
      a: [{ t: 'x]}"{' }, { t: 'y' }],
    });
    expect(salvageTruncatedJson('{"a": [{"t": "x')).toBeNull();
    expect(salvageTruncatedJson('[1, 2')).toBeNull();
  });

  it('passes a per-request timeout and output budget', async () => {
    const { p, calls } = provider([{ status: 200, body: envelope(GOOD_EXTRACT) }]);
    await p.generateJson({ ...req, maxOutputTokens: 32_768, timeoutMs: 60_000 });
    expect(calls[0]!.body).toMatchObject({ generationConfig: { maxOutputTokens: 32_768 } });
  });

  it('does not retry a 400 (bad request)', async () => {
    const { p, calls } = provider([{ status: 400, body: BAD_REQUEST_BODY }]);
    const err = await p.generateJson(req).catch((e: unknown) => e);
    expect((err as AiError).code).toBe('ai_failed');
    expect(calls).toHaveLength(1);
  });

  it('moves to the fallback model at once when the model does not exist (404)', async () => {
    const { p, calls } = provider([
      { status: 404, body: NOT_FOUND_BODY },
      { status: 200, body: envelope(GOOD_EXTRACT) },
    ]);
    expect((await p.generateJson(req)).model).toBe('fallback-m');
    expect(calls).toHaveLength(2);
  });

  it('treats a blocked prompt as fatal', async () => {
    const { p } = provider([{ status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }]);
    await expect(p.generateJson(req)).rejects.toMatchObject({ code: 'ai_failed' });
  });

  it('stops starting attempts when the total budget is spent', async () => {
    let t = 0;
    const { p, calls } = provider([{ status: 503, body: OVERLOADED_BODY }], {
      totalBudgetMs: 2500,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    await expect(p.generateJson(req)).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(calls.length).toBeLessThan(6);
  });
});

describe('classifyHttpError', () => {
  it('classifies status codes', () => {
    expect(classifyHttpError(429, JSON.stringify(QUOTA_ERROR_BODY))).toMatchObject({
      kind: 'retry',
      quota: true,
      retryAfterMs: 3000,
    });
    expect(classifyHttpError(503, JSON.stringify(OVERLOADED_BODY))).toMatchObject({
      kind: 'retry',
      quota: true,
    });
    expect(classifyHttpError(500, 'oops')).toMatchObject({ kind: 'retry', quota: false });
    expect(classifyHttpError(404, '')).toMatchObject({ kind: 'next_model' });
    expect(classifyHttpError(403, '')).toMatchObject({ kind: 'fatal' });
    expect(classifyHttpError(429, '', '7')).toMatchObject({ retryAfterMs: 7000 });
  });
});

describe('createAiProvider (env)', () => {
  it('reads model names from the environment only', async () => {
    const f = fakeFetch([{ status: 200, body: envelope(GOOD_EXTRACT) }]);
    const env: Record<string, string> = { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'env-model' };
    const p = createAiProvider((k) => env[k], { fetch: f.fetch });
    expect((await p.generateJson(req)).model).toBe('env-model');
  });
  it('rejects unknown providers and a missing key', () => {
    expect(() =>
      createAiProvider((k) => ({ AI_PROVIDER: 'openai', GEMINI_API_KEY: 'k' })[k]),
    ).toThrow(/not implemented/);
    expect(() => createAiProvider(() => undefined)).toThrow(/GEMINI_API_KEY/);
  });
});
