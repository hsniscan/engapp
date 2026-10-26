// @vitest-environment node
// The graded library's planner (decision 0047): the first plan is 360 texts (A2–C1 × 10 core
// topics × 9), every slot differs within its cell, failed slots are replaced up to a limit.
import { describe, expect, it } from 'vitest';
import {
  CORE_TOPIC_KEYS,
  GRADED_LENGTHS,
  GRADED_LEVELS,
  GRADED_TOPIC_KEYS,
} from '../../supabase/functions/_shared/graded-contract.ts';
import { FIRST_PLAN, GENRES, planItem, planMissing, TOPIC_ANGLES, TOPIC_HINTS, type ExistingSlot } from './graded-plan.ts';

describe('graded planner', () => {
  it('plans 360 texts first: 4 levels × 10 topics × 9', () => {
    const plan = planMissing(FIRST_PLAN, []);
    expect(plan).toHaveLength(360);
    expect(new Set(plan.map((p) => p.plan_key)).size).toBe(360);
    expect(new Set(plan.map((p) => p.level))).toEqual(new Set(GRADED_LEVELS));
    expect(new Set(plan.map((p) => p.topic))).toEqual(new Set(CORE_TOPIC_KEYS));
    expect(CORE_TOPIC_KEYS).toHaveLength(10);
    for (const level of GRADED_LEVELS)
      for (const topic of CORE_TOPIC_KEYS)
        expect(plan.filter((p) => p.level === level && p.topic === topic)).toHaveLength(9);
  });

  it('gives every slot of a cell its own angle and mixes the kinds of text', () => {
    const cell = planMissing(FIRST_PLAN, []).filter((p) => p.level === 'B1' && p.topic === 'travel');
    expect(new Set(cell.map((p) => p.angle)).size).toBe(9);
    expect(new Set(cell.map((p) => p.genre)).size).toBeGreaterThanOrEqual(6);
  });

  it('asks for the level’s length (150–600 words over the levels)', () => {
    const plan = planMissing(FIRST_PLAN, []);
    for (const p of plan) expect(p.words).toEqual(GRADED_LENGTHS[p.level]);
    expect(Math.min(...plan.map((p) => p.words.min))).toBe(150);
    expect(Math.max(...plan.map((p) => p.words.max))).toBe(600);
  });

  it('has a hint and angles for every topic, nine for the core ones', () => {
    for (const t of GRADED_TOPIC_KEYS) {
      expect(TOPIC_HINTS[t].length).toBeGreaterThan(10);
      expect(TOPIC_ANGLES[t].length).toBeGreaterThanOrEqual(CORE_TOPIC_KEYS.includes(t) ? 9 : 3);
    }
    // News is timeless and fictional: the hint says so.
    expect(TOPIC_HINTS.news).toMatch(/fictional/);
    expect(TOPIC_HINTS.news).toMatch(/never real/);
  });

  it('plans nothing twice and replaces a failed slot by the next free one', () => {
    const first = planMissing(FIRST_PLAN, []);
    const existing: ExistingSlot[] = first.map((p) => ({ ...p, state: 'done' }));
    expect(planMissing(FIRST_PLAN, existing)).toEqual([]);
    existing[0] = { ...existing[0]!, state: 'failed' };
    const again = planMissing(FIRST_PLAN, existing);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ level: existing[0].level, topic: existing[0].topic, slot: 9 });
    // A new round of angles is marked so the model writes another text.
    expect(again[0]!.angle).toMatch(/version 2/);
  });

  it('stops replacing failed slots at twice the target', () => {
    const failed: ExistingSlot[] = Array.from({ length: 18 }, (_, slot) => ({
      plan_key: `A2|science|${slot}`,
      level: 'A2',
      topic: 'science',
      slot,
      state: 'failed',
    }));
    expect(planMissing(FIRST_PLAN, failed).filter((p) => p.topic === 'science' && p.level === 'A2')).toEqual([]);
  });

  it('adds the other profile topics when asked', () => {
    const plan = planMissing({ ...FIRST_PLAN, extendedPerCell: 2 }, []);
    const extra = GRADED_TOPIC_KEYS.length - CORE_TOPIC_KEYS.length;
    expect(plan).toHaveLength(360 + 4 * extra * 2);
  });

  it('is stable', () => {
    expect(planItem('C1', 'history', 4)).toEqual(planItem('C1', 'history', 4));
    expect(GENRES).toContain(planItem('C1', 'history', 4).genre);
  });
});
