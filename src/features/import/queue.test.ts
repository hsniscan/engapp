import { beforeEach, describe, expect, it } from 'vitest';
import { AiClientError, type ExtractResponse } from '@/ai/client';
import { createImportJob, db, getImportJob, listImportCandidates } from '@/data';
import { chunkText, hashChunk } from '@/domain/chunking';
import { resetDb } from '@/test/db';
import { processImportQueue, type ImportQueueDeps } from './queue';
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

beforeEach(resetDb);

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
