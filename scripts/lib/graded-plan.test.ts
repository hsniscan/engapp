// @vitest-environment node
// The graded library's planner (decisions 0047, 0073): the library plan is 360 texts (A1–C1 ×
// 10 core topics, 8/8/8/7/5 per topic), every slot differs within its cell, failed slots are
// replaced up to a limit.
import { describe, expect, it } from 'vitest';
import {
  CORE_TOPIC_KEYS,
  GRADED_LENGTHS,
  GRADED_LEVELS,
  GRADED_TOPIC_KEYS,
} from '../../supabase/functions/_shared/graded-contract.ts';
import {
  A1_ANGLES,
  A1_GENRES,
  FIRST_PLAN,
  GENRES,
  LIBRARY_PER_LEVEL,
  planItem,
  planMissing,
  TOPIC_ANGLES,
  TOPIC_HINTS,
  type ExistingSlot,
} from './graded-plan.ts';

describe('graded planner', () => {
  it('plans 360 texts: A1–C1 × 10 topics, most for beginners', () => {
    const plan = planMissing(FIRST_PLAN, []);
    expect(plan).toHaveLength(360);
    expect(new Set(plan.map((p) => p.plan_key)).size).toBe(360);
    expect(GRADED_LEVELS).toEqual(['A1', 'A2', 'B1', 'B2', 'C1']);
    expect(new Set(plan.map((p) => p.level))).toEqual(new Set(GRADED_LEVELS));
    expect(new Set(plan.map((p) => p.topic))).toEqual(new Set(CORE_TOPIC_KEYS));
    expect(CORE_TOPIC_KEYS).toHaveLength(10);
    expect(LIBRARY_PER_LEVEL).toEqual({ A1: 8, A2: 8, B1: 8, B2: 7, C1: 5 });
    for (const level of GRADED_LEVELS)
      for (const topic of CORE_TOPIC_KEYS)
        expect(plan.filter((p) => p.level === level && p.topic === topic)).toHaveLength(LIBRARY_PER_LEVEL[level]);
  });

  it('asks the same number on every level when perCell is given alone', () => {
    const plan = planMissing({ ...FIRST_PLAN, perCell: 9, perLevel: undefined }, []);
    expect(plan).toHaveLength(5 * 10 * 9);
  });

  it('gives every slot of a cell its own angle and mixes the kinds of text', () => {
    const cell = planMissing(FIRST_PLAN, []).filter((p) => p.level === 'B1' && p.topic === 'travel');
    expect(new Set(cell.map((p) => p.angle)).size).toBe(8);
    expect(new Set(cell.map((p) => p.genre)).size).toBeGreaterThanOrEqual(6);
  });

  it('gives the A1 shelf its own everyday angles and short kinds of text', () => {
    const cell = planMissing(FIRST_PLAN, []).filter((p) => p.level === 'A1' && p.topic === 'science');
    expect(cell).toHaveLength(8);
    expect(new Set(cell.map((p) => p.angle)).size).toBe(8);
    for (const p of cell) {
      expect(A1_ANGLES.science).toContain(p.angle);
      expect(A1_GENRES as readonly string[]).toContain(p.genre);
    }
    for (const t of CORE_TOPIC_KEYS) expect(A1_ANGLES[t]!.length).toBeGreaterThanOrEqual(9);
  });

  it('asks for the level’s length (60–600 words over the levels)', () => {
    const plan = planMissing(FIRST_PLAN, []);
    for (const p of plan) expect(p.words).toEqual(GRADED_LENGTHS[p.level]);
    expect(Math.min(...plan.map((p) => p.words.min))).toBe(60);
    expect(Math.max(...plan.map((p) => p.words.max))).toBe(600);
    expect(GRADED_LENGTHS.A1).toEqual({ min: 60, max: 120 });
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
    expect(again[0]).toMatchObject({ level: existing[0].level, topic: existing[0].topic, slot: 8 });
    // A new round of angles is marked so the model writes another text.
    expect(again[0]!.level).toBe('A1');
    // Past the ninth angle a new round is marked so the model writes another text.
    expect(planItem('B1', 'travel', 9).angle).toMatch(/version 2/);
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
    expect(plan).toHaveLength(360 + 5 * extra * 2);
  });

  it('is stable', () => {
    expect(planItem('C1', 'history', 4)).toEqual(planItem('C1', 'history', 4));
    expect(GENRES).toContain(planItem('C1', 'history', 4).genre);
  });
});
