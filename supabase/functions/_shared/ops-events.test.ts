// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors.ts';
import { createHandler } from './http.ts';
import { eventForError, opsEvents, type OpsRpc } from './ops-events.ts';

function fakeRpc(fail = false) {
  const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const client: OpsRpc = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      return Promise.resolve({ error: fail ? { message: 'no such function' } : null });
    },
  };
  return { client, calls };
}

describe('ops events (decision 0076)', () => {
  it('counts failures and quota refusals, not the user’s own mistakes', () => {
    expect(eventForError('ai_failed')).toBe('fn_error');
    expect(eventForError('internal')).toBe('fn_error');
    expect(eventForError('fetch_failed')).toBe('fn_error');
    expect(eventForError('quota_exceeded')).toBe('ai_quota');
    expect(eventForError('budget_exhausted')).toBe('ai_quota');
    for (const c of ['unauthorized', 'invalid_input', 'daily_limit', 'paywalled', 'robots_disallowed']) {
      expect(eventForError(c)).toBeNull();
    }
  });

  it('records the function name and the code only', () => {
    const { client, calls } = fakeRpc();
    const ev = opsEvents(client, 'tts');
    ev.onError('ai_failed');
    ev.onError('invalid_input');
    ev.onError('quota_exceeded');
    expect(calls).toEqual([
      { fn: 'ops_event', args: { p_kind: 'fn_error', p_detail: { fn: 'tts', code: 'ai_failed' } } },
      { fn: 'ops_event', args: { p_kind: 'ai_quota', p_detail: { fn: 'tts', code: 'quota_exceeded' } } },
    ]);
  });

  it('turns a provider fallback log line into an ai_fallback event and keeps the log', () => {
    const { client, calls } = fakeRpc();
    const inner = vi.fn();
    const logger = opsEvents(client, 'ai-extract').wrapLog(inner);
    logger('provider fallback', { from: 'gemini', to: 'claude' });
    logger('something else');
    expect(inner).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([{ fn: 'ops_event', args: { p_kind: 'ai_fallback', p_detail: { fn: 'ai-extract' } } }]);
  });

  it('never throws, also without a database or when the insert fails', async () => {
    expect(() => opsEvents(null, 'x').onError('internal')).not.toThrow();
    const log = vi.fn();
    const { client } = fakeRpc(true);
    opsEvents(client, 'x', log).record('fn_error');
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toHaveBeenCalledWith('ops event not stored', expect.objectContaining({ kind: 'fn_error' }));
    const throwing: OpsRpc = {
      rpc: () => {
        throw new Error('boom');
      },
    };
    expect(() => opsEvents(throwing, 'x').record('fn_error')).not.toThrow();
  });

  it('createHandler reports the code of every error answer', async () => {
    const onError = vi.fn();
    const h = createHandler({
      cors: { allowedOrigins: ['*'] },
      authenticate: async () => 'u1',
      run: async () => {
        throw new ApiError('ai_failed', 'bad answer');
      },
      onError,
    });
    const res = await h(new Request('https://x/fn', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(502);
    expect(onError).toHaveBeenCalledWith('ai_failed');
    const h2 = createHandler({
      cors: { allowedOrigins: ['*'] },
      authenticate: async () => 'u1',
      run: async () => {
        throw new Error('unexpected');
      },
      onError,
    });
    await h2(new Request('https://x/fn', { method: 'POST', body: '{}' }));
    expect(onError).toHaveBeenLastCalledWith('internal');
  });
});
