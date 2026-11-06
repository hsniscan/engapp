// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { autoTag, isAutomatic, skipReason, type GateInput, type RunInfo } from './ci-gate.ts';

const NOW = new Date('2026-11-06T09:50:00Z');
const run = (over: Partial<RunInfo>): RunInfo => ({
  id: 100,
  display_title: `Database backup ${autoTag('daily')}`,
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-11-06T02:45:05Z',
  ...over,
});
const input = (over: Partial<GateInput>): GateInput => ({
  slot: 'daily',
  windowMinutes: 1200,
  event: 'schedule',
  trigger: '',
  runId: 200,
  now: NOW,
  runs: [],
  ...over,
});

describe('ci-gate', () => {
  it('treats the schedule and pg_cron dispatches as automatic, other runs as manual', () => {
    expect(isAutomatic('schedule', '')).toBe(true);
    expect(isAutomatic('workflow_dispatch', 'cron')).toBe(true);
    expect(isAutomatic('workflow_dispatch', '')).toBe(false);
    expect(isAutomatic('push', 'cron')).toBe(false);
  });

  it('skips the late GitHub schedule when the pg_cron run already finished well', () => {
    expect(skipReason(input({ runs: [run({})] }))).toMatch(/finished well/);
  });

  it('runs when the earlier run failed, so the backstop retries', () => {
    expect(skipReason(input({ runs: [run({ conclusion: 'failure' })] }))).toBeNull();
    expect(skipReason(input({ runs: [run({ conclusion: 'cancelled' })] }))).toBeNull();
  });

  it('counts a failed run as done for the health check (any)', () => {
    expect(skipReason(input({ anyConclusion: true, runs: [run({ conclusion: 'failure' })] }))).toMatch(/failed/);
    expect(skipReason(input({ anyConclusion: true, runs: [run({ conclusion: 'cancelled' })] }))).toBeNull();
  });

  it('skips the pg_cron run when an earlier automatic run is still going', () => {
    const r = run({ id: 150, status: 'in_progress', conclusion: null });
    expect(skipReason(input({ event: 'workflow_dispatch', trigger: 'cron', runs: [r] }))).toMatch(/still running/);
    // A later run that is still queued does not stop this one.
    expect(skipReason(input({ runs: [run({ id: 250, status: 'queued', conclusion: null })] }))).toBeNull();
  });

  it('ignores manual runs, other slots, itself and runs outside the window', () => {
    const runs = [
      run({ display_title: 'Database backup' }), // manual
      run({ display_title: `Picture jobs ${autoTag('collect')}` }),
      run({ id: 200 }),
      run({ created_at: '2026-11-05T12:00:00Z' }),
    ];
    expect(skipReason(input({ runs }))).toBeNull();
  });

  it('never skips a manual run', () => {
    expect(skipReason(input({ event: 'workflow_dispatch', trigger: '', runs: [run({})] }))).toBeNull();
  });
});
