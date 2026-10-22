// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { WordRefs } from '../../supabase/functions/_shared/level.ts';
import type { LevelSenseRow, TrPendingItem } from '../../supabase/functions/_shared/level-job.ts';
import { lateJobs, heartbeat, type RpcClient } from './heartbeat.ts';
import { runLevels, type LevelAi, type LevelDb, type LevelPlan } from './level-run.ts';

const row = (id: string, lemma: string, over: Partial<LevelSenseRow> = {}): LevelSenseRow => ({
  id,
  term_id: `t-${lemma}`,
  lemma_norm: lemma,
  term_type: 'word',
  pos: 'noun',
  gloss_en: lemma,
  zipf: null,
  cefr: null,
  cefr_source: null,
  cefr_list: null,
  cefr_reason_tr: null,
  cefr_guess: null,
  cefr_guess_at: null,
  ...over,
});

const REFS: Record<string, WordRefs> = {
  apple: { zipf: 4.6, refs: [{ pos: 'noun', cefr: 'A1', source: 'cefrj' }] },
  bridge: { zipf: 4.4, refs: [{ pos: 'noun', cefr: 'A2', source: 'cefrj' }] },
};

function fakeDb(rows: LevelSenseRow[], pending: TrPendingItem[] = []) {
  const writes: LevelPlan[] = [];
  const db: LevelDb = {
    senses: async () => rows,
    refs: async () => ({ lookup: (l) => REFS[l], minZipf: 3 }),
    write: async (plan, dryRun) => {
      if (!dryRun) writes.push(plan);
      return { senses: plan.senses.length, terms: plan.terms.length };
    },
    trPending: async () => pending.splice(0, pending.length),
    trStore: async (items) => items.length,
  };
  return { db, writes };
}

const log = () => {};
const rows = () => [row('s1', 'apple'), row('s2', 'bridge'), row('s3', 'zzzunknown')];

describe('level job', () => {
  it('without AI it still resolves levels and term frequencies', async () => {
    const { db, writes } = fakeDb(rows());
    const r = await runLevels(db, null, { dryRun: false, log });
    expect(r.ai).toBe('off');
    expect(r.resolved_first.terms).toBe(2); // apple and bridge get their zipf
    expect(writes[0]!.terms).toEqual([
      { id: 't-apple', zipf: 4.6 },
      { id: 't-bridge', zipf: 4.4 },
    ]);
    expect(writes[0]!.senses.map((s) => [s.id, s.cefr])).toEqual([
      ['s1', 'A1'],
      ['s2', 'A2'],
      ['s3', 'C1'], // rarer than the frequency data covers
    ]);
    expect(r.resolved_last).toBeNull();
  });

  it('an AI error still runs the last resolve and reports the error', async () => {
    const { db, writes } = fakeDb(rows());
    const ai: LevelAi = {
      call: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
      stopped: () => null,
      calls: () => 1,
    };
    const r = await runLevels(db, ai, { dryRun: false, log });
    expect(r.ai).toBe('error');
    expect(r.ai_error).toBe('fetch failed');
    expect(r.resolved_last).not.toBeNull();
    expect(writes).toHaveLength(2);
  });

  it('AI guesses and corrections are stored, then resolved again', async () => {
    const pending: TrPendingItem[] = [{ lemma_norm: 'apple', pos: 'noun', source: 'cefrj', cefr: 'A1' }];
    const { db, writes } = fakeDb(rows(), pending);
    let calls = 0;
    const ai: LevelAi = {
      call: async (req) => {
        calls++;
        return req.user.startsWith('WORDS')
          ? { data: { changes: [] }, model: 'm' }
          : { data: { levels: [{ ref: 's1', level: 'B2' }] }, model: 'm' };
      },
      stopped: () => null,
      calls: () => calls,
    };
    const r = await runLevels(db, ai, { dryRun: false, log });
    expect(r.ai).toBe('ran');
    expect(calls).toBe(2);
    expect(r.checked).toBe(1);
    expect(r.resolved_last).not.toBeNull();
    // first resolve, the guess write, the last resolve
    expect(writes.length).toBe(3);
  });

  it('a dry run writes nothing and calls no model', async () => {
    const { db, writes } = fakeDb(rows());
    const ai: LevelAi = { call: vi.fn(), stopped: () => null, calls: () => 0 };
    const r = await runLevels(db, ai, { dryRun: true, log });
    expect(writes).toHaveLength(0);
    expect(ai.call).not.toHaveBeenCalled();
    expect(r.ai).toBe('off');
  });
});

describe('job health', () => {
  const now = new Date('2026-10-24T03:00:00Z');
  it('flags a job without a good run for more than 36 hours', () => {
    expect(
      lateJobs(
        [
          { job: 'levels', status: 'ok', last_run_at: '2026-10-24T02:35:00Z', last_ok_at: '2026-10-24T02:35:00Z' },
          { job: 'images', status: 'failed', last_run_at: '2026-10-24T01:40:00Z', last_ok_at: '2026-10-22T01:40:00Z' },
        ],
        now,
      ),
    ).toEqual([{ job: 'images', hours: 49 }]);
  });

  it('a job that never reported is not late; one that never ended well is', () => {
    expect(lateJobs([], now)).toEqual([]);
    expect(
      lateJobs([{ job: 'levels', status: 'failed', last_run_at: '2026-10-24T02:35:00Z', last_ok_at: null }], now),
    ).toEqual([{ job: 'levels', hours: null }]);
  });

  it('never fails the run when the database has no heartbeat function yet', async () => {
    const c: RpcClient = {
      rpc: async () => ({ data: null, error: { message: 'Could not find the function public.job_heartbeat' } }),
    };
    const seen: string[] = [];
    await heartbeat(c, 'levels', 'ok', {}, (m) => seen.push(m), now);
    expect(seen).toEqual(['heartbeat not stored']);
  });

  it('stores the heartbeat and warns about late jobs', async () => {
    const calls: string[] = [];
    const c: RpcClient = {
      rpc: async (fn) => {
        calls.push(fn);
        return fn === 'job_health'
          ? {
              data: [{ job: 'images', status: 'ok', last_run_at: '2026-10-20T01:40:00Z', last_ok_at: '2026-10-20T01:40:00Z' }],
              error: null,
            }
          : { data: null, error: null };
      },
    };
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    await heartbeat(c, 'levels', 'ok', { senses: 3 }, log, now);
    expect(calls).toEqual(['job_heartbeat', 'job_health']);
    expect(out.mock.calls.flat().join('\n')).toMatch(/::warning::Job 'images' has not finished well for 97 hours/);
    out.mockRestore();
  });
});
