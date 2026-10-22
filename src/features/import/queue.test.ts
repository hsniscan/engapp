import { beforeEach, describe, expect, it } from 'vitest';
import { AiClientError, type ExtractResponse } from '@/ai/client';
import {
  createImportJob,
  db,
  getImportJob,
  listImportCandidates,
  setKnownTermsProvider,
} from '@/data';
import { chunkText, hashChunk } from '@/domain/chunking';
import { resetDb } from '@/test/db';
import {
  CHUNK_CONCURRENCY,
  CHUNK_GAP_MS,
  processImportQueue,
  resetImportPrefetchForTesting,
  type ImportQueueDeps,
} from './queue';
import { FAKE_SPECS, fakeExtractResponse, fakeText } from './testing/fakeData';

interface Harness {
  deps: ImportQueueDeps;
  calls: string[];
  clock: { now: number };
  online: { value: boolean };
  fail: (AiClientError | null)[];
}

function harness(opts: { latencyMs?: number; gapMs?: number } = {}): Harness {
  const clock = { now: Date.UTC(2026, 9, 21, 9) };
  const online = { value: true };
  const calls: string[] = [];
  const fail: (AiClientError | null)[] = [];
  const deps: ImportQueueDeps = {
    extract: async ({ text }) => {
      calls.push(text);
      clock.now += opts.latencyMs ?? 0;
      const f = fail.shift();
      if (f) throw f;
      return {
        ...(fakeExtractResponse(text) as ExtractResponse),
        chunk_hash: await hashChunk(text),
      };
    },
    isOnline: () => online.value,
    isSignedIn: async () => true,
    sleep: async (ms) => {
      clock.now += ms;
    },
    now: () => clock.now,
    gapMs: opts.gapMs ?? 600,
  };
  return { deps, calls, clock, online, fail };
}

beforeEach(async () => {
  resetImportPrefetchForTesting();
  await resetDb();
});

describe('import queue', () => {
  it('processes chunks in order and produces candidates', async () => {
    const h = harness();
    const text = fakeText();
    const chunks = chunkText(text, 1200);
    expect(chunks.length).toBeGreaterThan(1);
    const job = await createImportJob({ kind: 'text', title: 'T', chunks, level: 'B1' });
    expect(await processImportQueue(h.deps)).toBe('idle');
    expect(h.calls).toEqual(chunks);
    const j = (await getImportJob(job.id))!;
    expect(j).toMatchObject({ status: 'ready', chunk_done: chunks.length });
    expect(await listImportCandidates(job.id)).toHaveLength(FAKE_SPECS.length);
  });

  it('extract-v5: stores the chunk topics, the text topics and the local cache keeps them', async () => {
    const h = harness();
    const extract = h.deps.extract;
    h.deps.extract = async (input) => ({ ...(await extract(input)), topics: ['technology'] });
    const chunks = chunkText(fakeText(), 1500);
    const job = await createImportJob({ kind: 'text', title: 'T', chunks, level: 'B1' });
    await processImportQueue(h.deps);
    const j = (await getImportJob(job.id))!;
    expect(j.chunk_topics).toEqual(chunks.map(() => ['technology']));
    expect((await db.sources.get(j.source_id))?.topics).toEqual(['technology']);
    // The same text again comes from the local chunk cache, topics included.
    const again = await createImportJob({ kind: 'text', title: 'T2', chunks, level: 'B1' });
    const calls = h.calls.length;
    await processImportQueue(h.deps);
    expect(h.calls.length).toBe(calls);
    expect((await db.sources.get((await getImportJob(again.id))!.source_id))?.topics).toEqual(['technology']);
  });

  it('the same text a second time makes no AI call (acceptance criterion 8)', async () => {
    const h = harness();
    const chunks = chunkText(fakeText(), 1500);
    await createImportJob({ kind: 'text', title: 'first', chunks, level: 'B1' });
    await processImportQueue(h.deps);
    const first = h.calls.length;
    expect(first).toBe(chunks.length);
    // Again, even offline: everything comes from chunk_cache.
    h.online.value = false;
    const again = await createImportJob({ kind: 'text', title: 'second', chunks, level: 'B1' });
    expect(await processImportQueue(h.deps)).toBe('idle');
    expect(h.calls.length).toBe(first);
    expect(await getImportJob(again.id)).toMatchObject({
      status: 'ready',
      chunk_cache_hits: chunks.length,
    });
    expect(await listImportCandidates(again.id)).toHaveLength(FAKE_SPECS.length);
  });

  it('a chunk cached by an older prompt version is extracted again', async () => {
    const h = harness();
    const chunks = chunkText(fakeText(), 1500);
    for (const c of chunks) {
      const old = { ...fakeExtractResponse(c), prompt_version: 'extract-v1' };
      await db.chunk_cache.put({
        chunk_hash: await hashChunk(c),
        result: { prompt_version: old.prompt_version, level: 'B1', candidates: old.candidates },
        created_at: 0,
      });
    }
    await createImportJob({ kind: 'text', title: 'again', chunks, level: 'B1' });
    expect(await processImportQueue(h.deps)).toBe('idle');
    expect(h.calls).toEqual(chunks);
  });

  it('waits while offline and resumes where it stopped', async () => {
    const h = harness();
    const chunks = chunkText(fakeText(), 1000);
    const job = await createImportJob({ kind: 'text', title: 'T', chunks, level: 'B1' });
    h.fail.push(null, new AiClientError('offline', 'Failed to fetch'));
    const extract = h.deps.extract;
    let n = 0;
    h.deps.extract = async (input) => {
      if (++n === 2) h.online.value = false; // the connection drops during the second call
      return extract(input);
    };
    expect(await processImportQueue(h.deps)).toBe('offline');
    expect(await getImportJob(job.id)).toMatchObject({ status: 'queued', chunk_done: 1 });
    expect(await processImportQueue(h.deps)).toBe('offline');
    h.online.value = true;
    expect(await processImportQueue(h.deps)).toBe('idle');
    expect(await getImportJob(job.id)).toMatchObject({
      status: 'ready',
      chunk_done: chunks.length,
    });
    expect(h.calls).toHaveLength(chunks.length + 1); // one lost call was repeated
  });

  it('a failed request while online is retried, not parked as offline', async () => {
    const h = harness();
    const chunks = chunkText(fakeText(), 1000);
    const job = await createImportJob({ kind: 'text', title: 'T', chunks, level: 'B1' });
    h.fail.push(new AiClientError('offline', 'Failed to fetch')); // e.g. CORS rejection
    expect(await processImportQueue(h.deps)).toBe('idle');
    expect(await getImportJob(job.id)).toMatchObject({ status: 'ready' });
  });

  it('a server that stays unreachable fails the job with a clear error', async () => {
    const h = harness();
    const job = await createImportJob({
      kind: 'text',
      title: 'T',
      chunks: ['Hello there.'],
      level: 'B1',
    });
    for (let i = 0; i < 5; i++) h.fail.push(new AiClientError('offline', 'Failed to fetch'));
    expect(await processImportQueue(h.deps)).toBe('idle');
    expect(await getImportJob(job.id)).toMatchObject({
      status: 'failed',
      error_code: 'unreachable',
    });
  });

  it('daily_limit stops the queue with a friendly error; retrying continues', async () => {
    const h = harness();
    const chunks = chunkText(fakeText(), 1000);
    const job = await createImportJob({ kind: 'text', title: 'T', chunks, level: 'B1' });
    h.fail.push(null, new AiClientError('daily_limit', 'limit', 429));
    expect(await processImportQueue(h.deps)).toBe('daily_limit');
    expect(await getImportJob(job.id)).toMatchObject({
      status: 'failed',
      error_code: 'daily_limit',
      chunk_done: 1,
    });
    const { retryImportJob } = await import('@/data');
    await retryImportJob(job.id);
    expect(await processImportQueue(h.deps)).toBe('idle');
    expect(await getImportJob(job.id)).toMatchObject({ status: 'ready', error_code: null });
  });

  it('quota_exceeded is retried with backoff before failing', async () => {
    const h = harness();
    const job = await createImportJob({
      kind: 'text',
      title: 'T',
      chunks: [fakeText(3)],
      level: 'B1',
    });
    h.fail.push(new AiClientError('quota_exceeded', 'busy', 503, 20));
    expect(await processImportQueue(h.deps)).toBe('idle');
    expect(await getImportJob(job.id)).toMatchObject({ status: 'ready' });
    expect(h.calls).toHaveLength(2);

    const job2 = await createImportJob({
      kind: 'text',
      title: 'T2',
      chunks: ['A completely different sentence about rivers.'],
      level: 'B1',
    });
    h.fail.push(...[1, 2, 3].map(() => new AiClientError('quota_exceeded', 'busy', 503)));
    expect(await processImportQueue(h.deps)).toBe('idle');
    expect(await getImportJob(job2.id)).toMatchObject({
      status: 'failed',
      error_code: 'quota_exceeded',
    });
  });

  it('signed out: the job stays queued and resumes after sign-in', async () => {
    const h = harness();
    let signedIn = false;
    h.deps.isSignedIn = async () => signedIn;
    const job = await createImportJob({
      kind: 'text',
      title: 'T',
      chunks: [fakeText(2)],
      level: 'B1',
    });
    expect(await processImportQueue(h.deps)).toBe('signed_out');
    expect(await getImportJob(job.id)).toMatchObject({
      status: 'queued',
      error_code: 'not_signed_in',
    });
    signedIn = true;
    expect(await processImportQueue(h.deps)).toBe('idle');
    expect(await getImportJob(job.id)).toMatchObject({ status: 'ready', error_code: null });
  });

  it('20-page PDF: candidates within 60 s at realistic model latency (acceptance criterion 5)', async () => {
    // A typical book/article page holds ~2,800 characters; 20 pages ≈ 56k chars.
    const page = Array.from(
      { length: 50 },
      (_, i) => FAKE_SPECS[i % FAKE_SPECS.length]!.sentence,
    ).join(' ');
    const text = Array.from({ length: 20 }, () => page).join('\n\n');
    const chunks = chunkText(text);
    const latency = 4_500; // per chunk: smoke run 2–20 s with flash-lite; median assumption
    const h = harness({ latencyMs: latency });
    const job = await createImportJob({ kind: 'pdf', title: '20 sayfa', chunks, level: 'B1' });
    const start = h.clock.now;
    await processImportQueue(h.deps);
    const elapsed = h.clock.now - start;
    // Identical pages hit the local chunk cache after the first one; use distinct chunks for the bound.
    const distinct = new Set(chunks).size;
    const worst = chunks.length * latency + (chunks.length - 1) * h.deps.gapMs;
    console.info(
      `[import timing] ${text.length} chars → ${chunks.length} chunks (${distinct} distinct); simulated ${elapsed / 1000}s; ` +
        `all-distinct bound ${worst / 1000}s at ${latency / 1000}s/chunk + ${h.deps.gapMs}ms gap`,
    );
    expect(await getImportJob(job.id)).toMatchObject({ status: 'ready' });
    expect(chunks.length).toBeLessThanOrEqual(11);
    expect(worst).toBeLessThanOrEqual(60_000);
  });

  it('two jobs run one after the other; a failing job does not block the next', async () => {
    const h = harness();
    const a = await createImportJob({
      kind: 'text',
      title: 'A',
      chunks: ['The river bank flooded again.'],
      level: 'B1',
    });
    const b = await createImportJob({
      kind: 'text',
      title: 'B',
      chunks: [fakeText(2)],
      level: 'B1',
    });
    h.fail.push(new AiClientError('invalid_input', 'bad'));
    await processImportQueue(h.deps);
    expect(await getImportJob(a.id)).toMatchObject({
      status: 'failed',
      error_code: 'invalid_input',
    });
    expect(await getImportJob(b.id)).toMatchObject({ status: 'ready' });
    expect(await db.import_jobs.count()).toBe(2);
  });
});

describe('import queue concurrency (acceptance criterion 5)', () => {
  /** ~51,000 characters, like a 20-page article PDF: corpus sentences plus filler prose. */
  function longText(): string {
    const filler =
      'The council met again on Tuesday to discuss the plan for the new library and the park. ';
    const parts: string[] = [];
    let i = 0;
    while (parts.join(' ').length < 51_000) {
      parts.push(FAKE_SPECS[i % FAKE_SPECS.length]!.sentence, filler.repeat(6).trim());
      i++;
    }
    return parts.join(' ');
  }

  it(`a 51k-character text at 4.5 s per chunk finishes well under 60 s with ${CHUNK_CONCURRENCY} in flight`, async () => {
    // Real timers, scaled 1:100 (45 ms stands for 4.5 s, 6 ms for the 600 ms gap).
    const SCALE = 100;
    const text = longText();
    const chunks = chunkText(text);
    expect(text.length).toBeGreaterThanOrEqual(51_000);
    expect(chunks.length).toBeGreaterThanOrEqual(9);
    let inFlight = 0;
    let maxInFlight = 0;
    const deps: ImportQueueDeps = {
      extract: async ({ text: t }) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 4500 / SCALE));
        inFlight--;
        return { ...(fakeExtractResponse(t) as ExtractResponse), chunk_hash: await hashChunk(t) };
      },
      isOnline: () => true,
      isSignedIn: async () => true,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms / SCALE)),
      now: () => Date.now(),
      gapMs: CHUNK_GAP_MS,
    };
    const job = await createImportJob({ kind: 'pdf', title: '20 sayfa', chunks, level: 'B1' });
    const t0 = performance.now();
    expect(await processImportQueue(deps)).toBe('idle');
    const simulatedMs = (performance.now() - t0) * SCALE;
    const sequentialMs = chunks.length * 4500 + (chunks.length - 1) * CHUNK_GAP_MS;
    expect(maxInFlight).toBe(CHUNK_CONCURRENCY);
    expect(sequentialMs).toBeGreaterThan(45_000); // one by one this was close to the limit
    expect(simulatedMs).toBeLessThan(30_000);
    console.info(
      `criterion 5: ${chunks.length} chunks, ${text.length} chars → ~${Math.round(simulatedMs / 1000)} s (one by one: ${Math.round(sequentialMs / 1000)} s)`,
    );
    const j = (await getImportJob(job.id))!;
    expect(j).toMatchObject({ status: 'ready', chunk_done: chunks.length });
    // Same candidates, in chunk order, as processing one by one.
    const cands = await listImportCandidates(job.id);
    const orders = cands.map((c) => c.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(cands.map((c) => c.lexicon_sense_id)).size).toBe(cands.length);
  });

  it('records chunks in order even when later requests answer first', async () => {
    const h = harness();
    const chunks = chunkText(fakeText(), 400);
    expect(chunks.length).toBeGreaterThan(4);
    let n = 0;
    h.deps.extract = async ({ text }) => {
      h.calls.push(text);
      // Earlier chunks are slower than later ones.
      await new Promise((r) => setTimeout(r, Math.max(0, 30 - 10 * n++)));
      return {
        ...(fakeExtractResponse(text) as ExtractResponse),
        chunk_hash: await hashChunk(text),
      };
    };
    const job = await createImportJob({ kind: 'text', title: 'T', chunks, level: 'B1' });
    expect(await processImportQueue(h.deps)).toBe('idle');
    const cands = await listImportCandidates(job.id);
    expect(cands.map((c) => c.term)).toEqual(
      FAKE_SPECS.filter((s) => chunks.join(' ').includes(s.sentence)).map((s) => s.term),
    );
  });
});

describe('smart extraction privacy', () => {
  it('what the learner knows never reaches the AI request; it is used on the device', async () => {
    setKnownTermsProvider({
      getKnownTermKeys: () => Promise.resolve(new Set(['outweigh', 'widespread'])),
      markKnown: () => Promise.resolve(),
    });
    try {
      const h = harness();
      const inputs: unknown[] = [];
      const extract = h.deps.extract;
      h.deps.extract = (input) => {
        inputs.push(input);
        return extract(input);
      };
      const text = fakeText();
      const job = await createImportJob({
        kind: 'text',
        title: 'T',
        chunks: chunkText(text, 1500),
        level: 'B1',
      });
      expect(await processImportQueue(h.deps)).toBe('idle');
      expect(inputs.length).toBeGreaterThan(1);
      for (const input of inputs)
        expect(Object.keys(input as object).sort()).toEqual(['level', 'text']);
      expect(JSON.stringify(inputs)).not.toMatch(/known/i);
      const rows = await listImportCandidates(job.id);
      const outweigh = rows.find((r) => r.term === 'outweigh')!;
      expect([outweigh.bucket, outweigh.selected]).toEqual(['known', false]);
    } finally {
      setKnownTermsProvider(null);
    }
  });
});
