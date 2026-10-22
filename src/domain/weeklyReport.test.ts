import { describe, expect, it } from 'vitest';
import { reportRequest } from '../../supabase/functions/_shared/report-contracts';
import { makeLog } from '../test/factories';
import { collectRetention, makeDayOf, type RetentionCardFacts } from './retention';
import { emptyDay } from './streak';
import type { DailyActivity, ReviewLog, WeeklyReportSummary } from './types';
import {
  activityTotals,
  buildWeeklySummary,
  chooseFocus,
  type FocusInput,
  hardNoteIds,
  mondayOf,
  reportWeekFor,
  toReportRequest,
} from './weeklyReport';

const DAY = 86_400_000;
const CFG = { timezone: 'Europe/Istanbul', day_start_hour: 4 };
const WEEK = '2026-10-12';
const FROM = Date.UTC(2026, 9, 12, 1);
const TO = FROM + 7 * DAY;
const noon = (d: number) => Date.UTC(2026, 9, 12 + d, 9);

const day = (date: string, reviews: number, minutes = 0, newCards = 0): DailyActivity => ({
  ...emptyDay(date),
  reviews,
  time_ms: minutes * 60_000,
  new_cards: newCards,
});

describe('report week', () => {
  it('is the last complete Monday–Sunday week', () => {
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
    expect(reportWeekFor('2026-10-19')).toBe('2026-10-12');
    expect(reportWeekFor('2026-10-25')).toBe('2026-10-12');
  });
});

describe('weekly numbers', () => {
  it('counts active days, answers, minutes and new cards of the week only', () => {
    const activity = [
      day('2026-10-11', 50, 30), // Sunday before
      day('2026-10-12', 20, 10, 5),
      day('2026-10-14', 0),
      day('2026-10-15', 31, 14, 2),
      day('2026-10-18', 9, 6),
      day('2026-10-19', 40, 20), // next Monday
    ];
    expect(activityTotals(activity, '2026-10-12', '2026-10-18')).toEqual({
      active_days: 3,
      reviews: 60,
      minutes: 30,
      new_cards: 7,
    });
  });

  it('learned words, streak at the week end and goal progress', () => {
    // note-a learned on Tuesday of the week, note-b the week before (2 Oct), note-c next week.
    const learn = (card: string, d: number): ReviewLog[] => [
      makeLog({ card_id: card, reviewed_at: noon(d), rating: 4 }),
    ];
    const facts = new Map<string, RetentionCardFacts>(
      [
        ['ca', 'note-a'],
        ['ca2', 'note-a'],
        ['cb', 'note-b'],
        ['cc', 'note-c'],
      ].map(([c, n]) => [
        c!,
        {
          note_id: n!,
          card_type: 'recognition',
          term_type: 'word',
          level: null,
          topics: [],
          sources: [],
          pos: [],
        },
      ]),
    );
    const data = collectRetention(
      [learn('ca', 1), learn('ca2', 3), learn('cb', -10), learn('cc', 8)],
      makeDayOf(CFG),
    );
    // Active Thu 8 → Sun 18 except a vacation on Sat 17 without reviews.
    const activity = [
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-18',
    ].map((d) => day(d, 10, 12));
    const s = buildWeeklySummary({
      week: WEEK,
      from: FROM,
      to: TO,
      fallbackFrom: TO - 28 * DAY,
      activity,
      data,
      facts,
      isFrozenDay: (d) => d === '2026-10-17',
      goals: { week_active_days: 6, week_minutes: 90, month_new_terms: 5 },
      load: null,
      newAvailable: 3,
      cards: [],
    });
    expect(s).toMatchObject({
      week: WEEK,
      week_end: '2026-10-18',
      active_days: 6,
      reviews: 60,
      minutes: 72,
      new_learned: 1,
      streak: 10,
      goals: [
        { key: 'week_active_days', target: 6, value: 6 },
        { key: 'week_minutes', target: 90, value: 72 },
        // October up to the 18th: note-a and note-b (2 Oct)
        { key: 'month_new_terms', target: 5, value: 2 },
      ],
      weakest: null,
      groups_days: 28,
    });
  });
});

const focusInput = (p: Partial<FocusInput> = {}): FocusInput => ({
  activeDays: 5,
  frozenDays: 0,
  load: { overDay: null, suggestedLimit: null, currentLimit: 10 },
  weakest: null,
  overall: { n: 100, passed: 90, rate: 0.9, enough: true, ci: null },
  weakestNoteIds: [],
  gap: null,
  gapNoteIds: [],
  hardNoteIds: [],
  newAvailable: 20,
  ...p,
});

describe('focus of the week (fixed priority)', () => {
  const weak = { dimension: 'level' as const, key: 'C1', n: 20, passed: 14 };
  it('1. lower the new-card limit when the forecast exceeds the capacity', () => {
    const f = chooseFocus(
      focusInput({
        load: { overDay: 3, suggestedLimit: 6, currentLimit: 10 },
        activeDays: 0,
        weakest: weak,
        weakestNoteIds: ['a', 'b', 'c'],
      }),
    );
    expect(f).toEqual({ focus: 'lower_new_limit', note_ids: [], value: 6 });
    // no lower limit fits → the next rule
    expect(
      chooseFocus(focusInput({ load: { overDay: 3, suggestedLimit: null, currentLimit: 10 } }))
        .focus,
    ).toBe('keep_going');
  });
  it('2. come back after a quiet week; vacation days excuse it', () => {
    expect(chooseFocus(focusInput({ activeDays: 2 })).focus).toBe('come_back');
    expect(chooseFocus(focusInput({ activeDays: 1, frozenDays: 4 })).focus).toBe('keep_going');
  });
  it('3. practise the weakest category when it is clearly weaker', () => {
    expect(chooseFocus(focusInput({ weakest: weak, weakestNoteIds: ['a', 'b', 'c'] }))).toEqual({
      focus: 'practice_weakest',
      note_ids: ['a', 'b', 'c'],
      value: null,
    });
    // only two missed words: not enough for a round
    expect(chooseFocus(focusInput({ weakest: weak, weakestNoteIds: ['a', 'b'] })).focus).toBe(
      'keep_going',
    );
    // 86 % vs 90 % overall: neither below 80 % nor 5 points under
    expect(
      chooseFocus(
        focusInput({ weakest: { ...weak, passed: 172, n: 200 }, weakestNoteIds: ['a', 'b', 'c'] }),
      ).focus,
    ).toBe('keep_going');
  });
  it('4. the recognition–production gap, 5. mnemonics, 6. add words', () => {
    expect(chooseFocus(focusInput({ gap: 0.12, gapNoteIds: ['x', 'y', 'z'] })).focus).toBe(
      'practice_gap',
    );
    expect(chooseFocus(focusInput({ gap: 0.08, gapNoteIds: ['x', 'y', 'z'] })).focus).toBe(
      'keep_going',
    );
    expect(chooseFocus(focusInput({ hardNoteIds: ['h1', 'h2', 'h3'] }))).toEqual({
      focus: 'mnemonic_hard',
      note_ids: ['h1', 'h2', 'h3'],
      value: null,
    });
    expect(chooseFocus(focusInput({ newAvailable: 0 })).focus).toBe('add_words');
  });
  it('hard words: leeches when there are enough, most lapses first', () => {
    expect(
      hardNoteIds([
        { note_id: 'a', lapses: 6 },
        { note_id: 'b', lapses: 9 },
        { note_id: 'c', lapses: 7 },
        { note_id: 'd', lapses: 5 },
        { note_id: 'a', lapses: 2 },
      ]),
    ).toEqual(['b', 'c', 'a']);
  });
  it('hard words: falls back to lapses ≥ 3 while fewer than 3 words are leeches', () => {
    expect(
      hardNoteIds([
        { note_id: 'a', lapses: 3 },
        { note_id: 'b', lapses: 7 },
        { note_id: 'a', lapses: 5 },
        { note_id: 'c', lapses: 2 },
      ]),
    ).toEqual(['b', 'a']);
  });
});

describe('what ai-report gets', () => {
  const summary: WeeklyReportSummary = {
    v: 1,
    week: WEEK,
    week_end: '2026-10-18',
    active_days: 5,
    reviews: 212,
    minutes: 64,
    new_cards: 30,
    new_learned: 18,
    retention: { n: 120, passed: 102 },
    groups_days: 7,
    strongest: { dimension: 'topic', key: 'travel', n: 40, passed: 38 },
    weakest: {
      dimension: 'source',
      key: '0199f0a0-aaaa-7000-8000-000000000001',
      n: 30,
      passed: 21,
    },
    streak: 12,
    goals: [{ key: 'week_active_days', target: 6, value: 5 }],
    focus: 'practice_weakest',
    focus_note_ids: ['note-secret-1', 'note-secret-2', 'note-secret-3'],
    focus_value: null,
  };

  it('only summary numbers and group names from fixed lists', () => {
    const req = toReportRequest(summary);
    expect(reportRequest.parse(req)).toEqual(req);
    expect(req).toEqual({
      week: WEEK,
      active_days: 5,
      reviews: 212,
      minutes: 64,
      new_learned: 18,
      retention_pct: 85,
      groups_days: 7,
      strongest: { dimension: 'topic', key: 'travel', rate_pct: 95 },
      // a source has the user's own title: its key is never sent
      weakest: { dimension: 'source', key: null, rate_pct: 70 },
      streak_days: 12,
      goals: [{ key: 'week_active_days', target: 6, value: 5 }],
      focus: 'practice_weakest',
    });
    const json = JSON.stringify(req);
    expect(json).not.toContain('note-secret');
    expect(json).not.toContain('0199f0a0');
  });

  it('a retention under 20 answers is not sent; free text never validates', () => {
    expect(
      toReportRequest({ ...summary, retention: { n: 19, passed: 19 } }).retention_pct,
    ).toBeNull();
    const bad = {
      ...toReportRequest(summary),
      weakest: { dimension: 'pos', key: 'reluctant', rate_pct: 50 },
    };
    expect(reportRequest.safeParse(bad).success).toBe(false);
    expect(
      reportRequest.safeParse({ ...toReportRequest(summary), note: 'cope' }).data,
    ).not.toHaveProperty('note');
  });
});
