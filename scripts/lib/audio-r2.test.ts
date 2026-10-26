// @vitest-environment node
// The R2 side of the audio jobs and the one-time copy (decision 0053). Mocked I/O only.
import { describe, expect, it, vi } from 'vitest';
import { R2Client } from '../../supabase/functions/_shared/r2.ts';
import { AUDIO_CACHE_CONTROL } from '../../supabase/functions/_shared/tts-r2.ts';
import {
  addToListing,
  emptyListing,
  listR2Audio,
  planCopy,
  runCopy,
  samplePaths,
  unionPaths,
  uploadAudioToR2,
  verifyPublic,
  type AudioListing,
} from './audio-r2.ts';

function listing(entries: Record<string, number>): AudioListing {
  const l = emptyListing();
  for (const [p, s] of Object.entries(entries)) addToListing(l, p, s);
  return l;
}

describe('listings', () => {
  it('counts mp3 and wav, ignores anything else and duplicates', () => {
    const l = listing({ 'en-US/a.mp3': 10, 'en-US/b.wav': 30, 'en-US/.emptyFolderPlaceholder': 0 });
    addToListing(l, 'en-US/a.mp3', 10);
    expect(l.counts).toEqual({ mp3: 1, wav: 1 });
    expect(l.bytes).toEqual({ mp3: 10, wav: 30 });
    expect([...l.paths]).toEqual(['en-US/a.mp3', 'en-US/b.wav']);
  });

  it('lists R2 per voice prefix', async () => {
    const list = vi.fn(async (prefix: string) =>
      prefix === 'en-US/' ? [{ key: 'en-US/a.mp3', size: 5 }] : [{ key: 'en-GB/b.mp3', size: 6 }],
    );
    const l = await listR2Audio({ list }, ['en-US', 'en-GB']);
    expect(list.mock.calls.map((c) => c[0])).toEqual(['en-US/', 'en-GB/']);
    expect(l.sizes).toEqual(
      new Map([
        ['en-US/a.mp3', 5],
        ['en-GB/b.mp3', 6],
      ]),
    );
  });

  it('a file in either bucket is present', () => {
    expect(unionPaths(listing({ 'en-US/a.mp3': 1 }), listing({ 'en-US/b.mp3': 1 }))).toEqual(
      new Set(['en-US/a.mp3', 'en-US/b.mp3']),
    );
  });
});

describe('uploadAudioToR2', () => {
  it('puts with the type and the immutable cache header', async () => {
    const put = vi.fn(async () => {});
    await uploadAudioToR2({ put }, 'en-US/a.mp3', new Uint8Array([1]));
    await uploadAudioToR2({ put }, 'en-US/a.wav', new Uint8Array([1]));
    expect(put.mock.calls.map((c) => (c as unknown[])[2])).toEqual([
      { contentType: 'audio/mpeg', cacheControl: AUDIO_CACHE_CONTROL },
      { contentType: 'audio/wav', cacheControl: AUDIO_CACHE_CONTROL },
    ]);
  });

  it('retries, then gives up with the last error', async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => {
      waits.push(ms);
    };
    let n = 0;
    const flaky = vi.fn(async () => {
      if (++n < 3) throw new Error(`boom ${n}`);
    });
    await uploadAudioToR2({ put: flaky }, 'en-US/a.mp3', new Uint8Array([1]), { wait });
    expect(flaky).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([2000, 4000]);
    const broken = vi.fn(async () => Promise.reject(new Error('denied')));
    await expect(
      uploadAudioToR2({ put: broken }, 'en-US/a.mp3', new Uint8Array([1]), { wait }),
    ).rejects.toThrow('denied');
  });

  it('works with the real client over a mocked fetch (signed PUT)', async () => {
    const seen: { url: string; auth: string; type: string }[] = [];
    const f = (async (u: string | URL | Request, init?: RequestInit) => {
      const h = init!.headers as Record<string, string>;
      seen.push({ url: String(u), auth: h.authorization!, type: h['content-type']! });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const r2 = new R2Client(
      { accountId: 'acc', accessKeyId: 'id', secretAccessKey: 's', bucket: 'b' },
      { fetch: f },
    );
    await uploadAudioToR2(r2, 'en-GB/x.mp3', new Uint8Array([9, 9]));
    expect(seen).toEqual([
      {
        url: 'https://acc.r2.cloudflarestorage.com/b/en-GB/x.mp3',
        auth: expect.stringMatching(/^AWS4-HMAC-SHA256 Credential=id\//),
        type: 'audio/mpeg',
      },
    ]);
  });
});

describe('planCopy', () => {
  it('copies only what R2 lacks or holds with another size, sorted', () => {
    const source = listing({
      'en-US/c.mp3': 3,
      'en-US/a.mp3': 1,
      'en-GB/b.wav': 2,
      'en-US/d.mp3': 4,
    });
    const target = listing({ 'en-US/a.mp3': 1, 'en-US/d.mp3': 99, 'en-US/only-r2.mp3': 5 });
    const plan = planCopy(source, target);
    expect(plan.jobs).toEqual([
      { path: 'en-GB/b.wav', size: 2 },
      { path: 'en-US/c.mp3', size: 3 },
      { path: 'en-US/d.mp3', size: 4 },
    ]);
    expect(plan).toMatchObject({ source: 4, present: 1, mismatched: 1, bytes: 9 });
  });

  it('is empty once everything is copied (idempotent)', () => {
    const source = listing({ 'en-US/a.mp3': 1, 'en-US/b.mp3': 2 });
    expect(planCopy(source, listing({ 'en-US/a.mp3': 1, 'en-US/b.mp3': 2 })).jobs).toEqual([]);
  });

  it('caps a run with max', () => {
    const source = listing({ 'en-US/a.mp3': 1, 'en-US/b.mp3': 2, 'en-US/c.mp3': 3 });
    const plan = planCopy(source, emptyListing(), 2);
    expect(plan.jobs.map((j) => j.path)).toEqual(['en-US/a.mp3', 'en-US/b.mp3']);
    expect(plan.bytes).toBe(3);
  });
});

describe('runCopy', () => {
  const jobs = ['en-US/a.mp3', 'en-US/b.mp3', 'en-US/c.mp3'].map((path) => ({ path, size: 2 }));

  it('copies every job and counts bytes; resumes with only what is left', async () => {
    const r2 = new Map<string, Uint8Array>();
    const deps = {
      download: async () => new Uint8Array([1, 2]),
      upload: async (p: string, b: Uint8Array) => void r2.set(p, b),
      log: () => {},
    };
    const first = await runCopy(jobs.slice(0, 2), deps, { concurrency: 2 });
    expect(first).toMatchObject({ copied: 2, failed: 0, bytes: 4, left: 0, stopped: 'complete' });
    // The second run plans against what R2 now holds.
    const source = listing(Object.fromEntries(jobs.map((j) => [j.path, 2])));
    const target = listing(Object.fromEntries([...r2].map(([p, b]) => [p, b.length])));
    const again = planCopy(source, target);
    expect(again.jobs.map((j) => j.path)).toEqual(['en-US/c.mp3']);
    await runCopy(again.jobs, deps);
    expect(r2.size).toBe(3);
  });

  it('counts failures and goes on', async () => {
    const logs: string[] = [];
    const r = await runCopy(
      jobs,
      {
        download: async (p) => (p.includes('b') ? new Uint8Array() : new Uint8Array([1])),
        upload: async () => {},
        log: (m) => logs.push(m),
      },
      { concurrency: 1 },
    );
    expect(r).toMatchObject({ copied: 2, failed: 1, failures: ['en-US/b.mp3'], left: 0 });
    expect(logs).toContain('audio copy failed');
  });

  it('stops after repeated failures', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ path: `en-US/${i}.mp3`, size: 1 }));
    const r = await runCopy(
      many,
      {
        download: async () => Promise.reject(new Error('down')),
        upload: async () => {},
        log: () => {},
      },
      { concurrency: 1, maxConsecutiveFailures: 5 },
    );
    expect(r).toMatchObject({ failed: 5, left: 45, stopped: 'failures' });
  });

  it('stops starting new copies at the deadline', async () => {
    let t = 0;
    const r = await runCopy(
      jobs,
      {
        download: async () => {
          t += 10;
          return new Uint8Array([1]);
        },
        upload: async () => {},
        log: () => {},
        now: () => t,
      },
      { concurrency: 1, deadline: 15 },
    );
    expect(r).toMatchObject({ copied: 2, left: 1, stopped: 'deadline' });
  });
});

describe('verifyPublic', () => {
  const sample = [
    { path: 'en-US/a.mp3', size: 3 },
    { path: 'en-US/b.mp3', size: 3 },
  ];

  it('passes when every file is served with audio type, size and CORS', async () => {
    const f = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'access-control-allow-origin': '*' },
        }),
    );
    const v = await verifyPublic(sample, {
      baseUrl: 'https://pub-x.r2.dev/',
      origin: 'https://app.example',
      fetch: f as unknown as typeof fetch,
    });
    expect(v).toEqual({ checked: 2, ok: 2, bad: [], cors: true });
    expect(f).toHaveBeenCalledWith('https://pub-x.r2.dev/en-US/a.mp3', {
      headers: { Origin: 'https://app.example' },
    });
  });

  it('reports missing files, wrong sizes and a missing CORS policy', async () => {
    const f = async (u: string | URL | Request) =>
      String(u).endsWith('a.mp3')
        ? new Response(null, { status: 404 })
        : new Response(new Uint8Array([1]), {
            status: 200,
            headers: { 'content-type': 'audio/mpeg' },
          });
    const v = await verifyPublic(sample, {
      baseUrl: 'https://pub-x.r2.dev',
      origin: 'https://app.example',
      fetch: f as typeof fetch,
    });
    expect(v.ok).toBe(0);
    expect(v.bad).toEqual([
      { path: 'en-US/a.mp3', reason: 'HTTP 404' },
      { path: 'en-US/b.mp3', reason: 'size 1 ≠ 3' },
    ]);
    expect(v.cors).toBe(false);
  });

  it('samples evenly and deterministically', () => {
    const paths = Array.from({ length: 100 }, (_, i) => `en-US/${String(i).padStart(3, '0')}.mp3`);
    expect(samplePaths(paths, 4)).toEqual([
      'en-US/000.mp3',
      'en-US/025.mp3',
      'en-US/050.mp3',
      'en-US/075.mp3',
    ]);
    expect(samplePaths(paths.slice(0, 2), 4)).toHaveLength(2);
  });
});
