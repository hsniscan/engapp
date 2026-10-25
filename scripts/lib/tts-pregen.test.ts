// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  TTS_SAMPLE_TEXT,
  ttsObjectPath,
  ttsOnDemandObjectPath,
} from '../../supabase/functions/_shared/tts-contract.ts';
import {
  estimate,
  parseVoices,
  planJobs,
  publicTexts,
  replacedOnDemandFiles,
  runJobs,
  shardOf,
  type PregenJob,
} from './tts-pregen.ts';

const rows = {
  terms: [
    { lemma: 'reluctant', lemma_norm: 'reluctant' },
    { lemma: 'Monday', lemma_norm: 'monday' },
    { lemma: 'run out of', lemma_norm: 'run out of' },
    { lemma: '42', lemma_norm: '42' }, // no Latin letter: the server would refuse it
  ],
  examples: [
    { text_en: 'She was  reluctant to leave.' },
    { text_en: 'She was reluctant to leave.' }, // same text once normalised
    { text_en: 'x'.repeat(301) }, // too long
  ],
};

describe('publicTexts', () => {
  it('mirrors tts_text_source: headwords (both spellings), examples, the sample', () => {
    const set = publicTexts(rows);
    expect(set.texts).toEqual(
      [
        'Monday',
        'monday',
        'reluctant',
        'run out of',
        'She was reluctant to leave.',
        TTS_SAMPLE_TEXT,
      ].sort(),
    );
    expect(set.words).toBe(4);
    expect(set.sentences).toBe(2);
    expect(set.skipped).toBe(2);
  });
});

const mp3 = (n = 1000) => new Uint8Array(n).fill(0xff);

describe('planJobs', () => {
  const texts = publicTexts(rows).texts;

  it('makes every text in every voice, named exactly as the app looks it up', async () => {
    const plan = await planJobs(texts, new Set(), {
      voices: ['en-US', 'en-GB'],
      shard: 0,
      shards: 1,
      max: 1000,
    });
    expect(plan.total).toBe(texts.length * 2);
    expect(plan.missing).toBe(plan.total);
    const job = plan.jobs.find((j) => j.voice === 'en-GB' && j.text === 'reluctant')!;
    expect(job.path).toBe(await ttsObjectPath('en-GB', 'reluctant'));
    expect(job.id).toBe(job.path.replace('/', '-').replace('.mp3', ''));
  });

  it('skips files the bucket already has (resume)', async () => {
    const existing = new Set([
      await ttsObjectPath('en-US', 'reluctant'),
      await ttsObjectPath('en-US', 'Monday'),
    ]);
    const plan = await planJobs(texts, existing, {
      voices: ['en-US'],
      shard: 0,
      shards: 1,
      max: 1000,
    });
    expect(plan.present).toBe(2);
    expect(plan.jobs.map((j) => j.text)).not.toContain('reluctant');
    expect(plan.jobs).toHaveLength(texts.length - 2);
  });

  it('caps a run at max', async () => {
    const plan = await planJobs(texts, new Set(), {
      voices: ['en-US'],
      shard: 0,
      shards: 1,
      max: 2,
    });
    expect(plan.jobs).toHaveLength(2);
    expect(plan.missing).toBe(texts.length);
  });

  it('splits the work into disjoint shards that together cover everything', async () => {
    const all = new Set<string>();
    let total = 0;
    for (let shard = 0; shard < 3; shard++) {
      const plan = await planJobs(texts, new Set(), {
        voices: ['en-US', 'en-GB'],
        shard,
        shards: 3,
        max: 1000,
      });
      total += plan.total;
      for (const j of plan.jobs) {
        expect(shardOf(j.path, 3)).toBe(shard);
        expect(all.has(j.path)).toBe(false);
        all.add(j.path);
      }
    }
    expect(all.size).toBe(texts.length * 2);
    expect(total).toBe(texts.length * 2);
  });

  it('rejects a bad shard', async () => {
    await expect(
      planJobs(texts, new Set(), { voices: ['en-US'], shard: 2, shards: 2, max: 1 }),
    ).rejects.toThrow('shard');
  });
});

describe('parseVoices', () => {
  it('accepts one voice or both', () => {
    expect(parseVoices('both')).toEqual(['en-US', 'en-GB']);
    expect(parseVoices('en-GB')).toEqual(['en-GB']);
    expect(() => parseVoices('fr-FR')).toThrow();
  });
});

function jobs(n: number): PregenJob[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `en-US-${i}`,
    text: `word${i}`,
    voice: 'en-US' as const,
    path: `en-US/${i}.mp3`,
  }));
}

describe('runJobs', () => {
  it('uploads every clip once it is made', async () => {
    const bucket = new Map<string, Uint8Array>();
    const r = await runJobs(jobs(5), {
      synth: async () => mp3(),
      upload: async (p, b) => void bucket.set(p, b),
      log: () => {},
    });
    expect(r).toEqual({ done: 5, failed: 0, bytes: 5000, left: 0, stopped: 'complete' });
    expect([...bucket.keys()]).toEqual(jobs(5).map((j) => j.path));
  });

  it('keeps going past a bad clip and reports it', async () => {
    const log = vi.fn();
    const r = await runJobs(jobs(3), {
      synth: async (j) => (j.id.endsWith('1') ? Promise.reject(new Error('no phonemes')) : mp3()),
      upload: async () => {},
      log,
    });
    expect(r).toMatchObject({ done: 2, failed: 1, stopped: 'complete' });
    expect(log).toHaveBeenCalledWith(
      'tts clip failed',
      expect.objectContaining({ stage: 'synth' }),
    );
  });

  it('never uploads an empty or tiny file', async () => {
    const upload = vi.fn(async () => {});
    const r = await runJobs(jobs(1), { synth: async () => mp3(10), upload, log: () => {} });
    expect(r.failed).toBe(1);
    expect(upload).not.toHaveBeenCalled();
  });

  it('stops at the deadline and leaves the rest for the next run', async () => {
    let t = 0;
    const r = await runJobs(
      jobs(10),
      {
        synth: async () => {
          t += 1000;
          return mp3();
        },
        upload: async () => {},
        log: () => {},
        now: () => t,
      },
      { deadline: 3000 },
    );
    expect(r).toMatchObject({ done: 3, left: 7, stopped: 'deadline' });
  });

  it('gives up after repeated failures (engine or Storage broken)', async () => {
    const r = await runJobs(
      jobs(50),
      {
        synth: async () => mp3(),
        upload: async () => Promise.reject(new Error('403')),
        log: () => {},
      },
      { maxConsecutiveFailures: 5, uploadConcurrency: 1 },
    );
    expect(r.stopped).toBe('failures');
    expect(r.done).toBe(0);
    expect(r.left).toBeGreaterThan(0);
  });

  it('a second run over the same bucket has nothing left to do (idempotent)', async () => {
    const texts = publicTexts(rows).texts;
    const bucket = new Map<string, Uint8Array>();
    const deps = {
      synth: async () => mp3(),
      upload: async (p: string, b: Uint8Array) => void bucket.set(p, b),
      log: () => {},
    };
    const opts = { voices: ['en-US', 'en-GB'] as const, shard: 0, shards: 1, max: 3 };
    // First run is cut short by max; the next ones pick up where it stopped.
    for (let i = 0; i < 10; i++) {
      const plan = await planJobs(texts, new Set(bucket.keys()), opts);
      if (plan.jobs.length === 0) break;
      await runJobs(plan.jobs, deps);
    }
    const last = await planJobs(texts, new Set(bucket.keys()), opts);
    expect(last.missing).toBe(0);
    expect(bucket.size).toBe(texts.length * 2);
  });
});

describe('replacedOnDemandFiles', () => {
  it('lists on-demand WAVs only where the MP3 exists', async () => {
    const texts = ['reluctant', 'flat'];
    const existing = new Set([
      await ttsOnDemandObjectPath('en-US', 'reluctant'),
      await ttsObjectPath('en-US', 'reluctant'),
      await ttsOnDemandObjectPath('en-US', 'flat'), // no MP3 yet: keep
    ]);
    expect(await replacedOnDemandFiles(texts, ['en-US'], existing)).toEqual([
      await ttsOnDemandObjectPath('en-US', 'reluctant'),
    ]);
  });
});

describe('estimate', () => {
  it('sizes a word at ~7 KB and a sentence at ~20 KB', () => {
    const e = estimate([{ text: 'word' }, { text: 'x'.repeat(60) }]);
    expect(e.bytes).toBeGreaterThan(20_000);
    expect(e.bytes).toBeLessThan(35_000);
  });
});
