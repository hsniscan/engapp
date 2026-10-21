import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiClientError } from '@/ai/client';
import type { ExamplesRequest, ExamplesResponse } from '@/ai/examples';
import { addNoteWithSenses, db, EXAMPLES_SINCE_KEY, exampleCallsToday, META, setMeta } from '@/data';
import type { ExampleJob, LexiconExample } from '@/domain/types';
import { resetDb } from '@/test/db';
import {
  DAILY_LIMIT_PAUSE_MS,
  MAX_JOB_ATTEMPTS,
  pickBatch,
  processExampleQueue,
  requestExamples,
  type ExampleQueueDeps,
} from './queue';

const T = Date.UTC(2026, 9, 22, 9);

function respond(req: ExamplesRequest, aiCalled = true): ExamplesResponse {
  const examples: LexiconExample[] = req.sense_ids.flatMap((sid) =>
    req.contexts.map((c) => ({
      id: `${sid}-${c}`,
      sense_id: sid,
      context: c,
      level_band: req.level_band,
      text_en: `A ${c} sentence with the word.`,
      span: [2, 3] as [number, number],
      translations: { tr: 'Bir cümle.' },
      status: 'active' as const,
      updated_at: T,
    })),
  );
  return {
    prompt_version: 'examples-v1',
    ai_called: aiCalled,
    model: aiCalled ? 'm' : null,
    level_band: req.level_band,
    examples,
    new_ids: aiCalled ? examples.map((e) => e.id) : [],
    counts: { requested: examples.length, cached: 0, generated: examples.length, dropped: {} },
    usage: null,
  };
}

function deps(over: Partial<ExampleQueueDeps> = {}): ExampleQueueDeps & { calls: ExamplesRequest[] } {
  const calls: ExamplesRequest[] = [];
  return {
    calls,
    generate: vi.fn(async (req: ExamplesRequest) => {
      calls.push(req);
      return respond(req);
    }),
    isOnline: () => true,
    isSignedIn: async () => true,
    sleep: async () => {},
    now: () => T,
    gapMs: 0,
    dailyCalls: 50,
    ...over,
  };
}

async function addSenses(n: number) {
  for (let i = 0; i < n; i++) {
    await addNoteWithSenses({ term: `word${i}`, senses: [{ meaning_tr: `anlam ${i}`, lexicon_sense_id: `ls-${i}` }] }, T - 1000 + i);
  }
}

beforeEach(async () => {
  await resetDb();
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.userId, 'user-1');
    await setMeta(EXAMPLES_SINCE_KEY, 0);
  });
});

describe('processExampleQueue', () => {
  it('sends batches of at most 8 senses with only ids, band and contexts', async () => {
    await addSenses(10);
    const d = deps();
    expect(await processExampleQueue(d)).toBe('idle');
    expect(d.calls.map((c) => c.sense_ids.length)).toEqual([8, 2]);
    expect(Object.keys(d.calls[0]!).sort()).toEqual(['contexts', 'level_band', 'sense_ids']);
    expect(d.calls[0]).toMatchObject({ level_band: 'B1', contexts: ['daily', 'conversation', 'work', 'formal'] });
    expect(await db.lexicon_examples.count()).toBe(40);
    expect((await db.example_jobs.toArray()).every((j) => j.status === 'done')).toBe(true);
    expect(await exampleCallsToday(T)).toBe(2);

    // Everything is prepared: a second run asks nothing.
    expect(await processExampleQueue(d)).toBe('idle');
    expect(d.calls).toHaveLength(2);
  });

  it('waits while offline or signed out', async () => {
    await addSenses(1);
    const off = deps({ isOnline: () => false });
    expect(await processExampleQueue(off)).toBe('offline');
    const out = deps({ isSignedIn: async () => false });
    expect(await processExampleQueue(out)).toBe('signed_out');
    expect(off.calls.length + out.calls.length).toBe(0);
  });

  it('stops at the background daily cap; cache answers do not count', async () => {
    await addSenses(17);
    const d = deps({ dailyCalls: 2 });
    expect(await processExampleQueue(d)).toBe('daily_cap');
    expect(d.calls).toHaveLength(2);
    expect(await db.example_jobs.where('status').equals('queued').count()).toBe(1);

    const cached = deps({ dailyCalls: 2, generate: async (req) => respond(req, false) });
    await db.transaction('rw', db.meta, () => setMeta(`example_calls:2026-10-22`, 0));
    expect(await processExampleQueue(cached)).toBe('idle');
  });

  it('pauses on the server daily limit and keeps the jobs', async () => {
    await addSenses(1);
    const d = deps({
      generate: async () => {
        throw new AiClientError('daily_limit', 'limit', 429);
      },
    });
    expect(await processExampleQueue(d)).toBe('daily_limit');
    const [job] = await db.example_jobs.toArray();
    expect(job).toMatchObject({ status: 'queued', error: 'daily_limit', next_attempt_at: T + DAILY_LIMIT_PAUSE_MS });
  });

  it('retries a busy model with backoff, then marks the jobs failed', async () => {
    await addSenses(1);
    let now = T;
    const d = deps({
      now: () => now,
      generate: async () => {
        throw new AiClientError('ai_failed', 'busy', 503);
      },
    });
    for (let i = 0; i < MAX_JOB_ATTEMPTS; i++) {
      expect(await processExampleQueue(d)).toBe('idle');
      now += 24 * 60 * 60_000;
    }
    const [job] = await db.example_jobs.toArray();
    expect(job).toMatchObject({ status: 'failed', attempts: MAX_JOB_ATTEMPTS, error: 'ai_failed' });
  });
});

describe('pickBatch', () => {
  const job = (key: string, contexts: string[], band: ExampleJob['level_band'] = 'B1'): ExampleJob => ({
    key,
    sense_id: key,
    level_band: band,
    contexts,
    status: 'queued',
    priority: 1,
    attempts: 0,
    next_attempt_at: 0,
    created_at: 0,
    updated_at: 0,
    error: null,
  });
  it('keeps one band and at most four contexts', () => {
    const b = pickBatch([
      job('a', ['daily', 'work']),
      job('b', ['travel'], 'B2'),
      job('c', ['formal', 'conversation']),
      job('d', ['health']),
    ]);
    expect(b.jobs.map((j) => j.key)).toEqual(['a', 'c']);
    expect(b.contexts).toEqual(['daily', 'work', 'formal', 'conversation']);
  });
});

describe('requestExamples', () => {
  it('asks for one fresh sentence and stores it', async () => {
    const d = deps();
    const res = await requestExamples({ lexiconSenseId: 'ls-1', band: 'B1', context: 'travel', fresh: true }, d);
    expect(res).toEqual({ ok: true, newIds: ['ls-1-travel'] });
    expect(d.calls[0]).toEqual({ sense_ids: ['ls-1'], level_band: 'B1', contexts: ['travel'], fresh: { sense_id: 'ls-1', context: 'travel' } });
    expect(await db.lexicon_examples.get('ls-1-travel')).toBeDefined();
  });

  it('maps failures to what the user can do', async () => {
    const fail = (code: ConstructorParameters<typeof AiClientError>[0]) =>
      requestExamples(
        { lexiconSenseId: 'ls-1', band: 'B1', context: 'daily', fresh: true },
        deps({
          generate: async () => {
            throw new AiClientError(code, code);
          },
        }),
      );
    expect(await fail('daily_limit')).toEqual({ ok: false, error: 'daily_limit' });
    expect(await fail('quota_exceeded')).toEqual({ ok: false, error: 'busy' });
    expect(await fail('offline')).toEqual({ ok: false, error: 'offline' });
    expect(
      await requestExamples({ lexiconSenseId: null, band: 'B1', context: 'daily', fresh: false }, deps()),
    ).toEqual({ ok: false, error: 'no_lexicon' });
    expect(
      await requestExamples({ lexiconSenseId: 'ls-1', band: 'B1', context: 'daily', fresh: false }, deps({ isSignedIn: async () => false })),
    ).toEqual({ ok: false, error: 'signed_out' });
  });
});
