import { describe, expect, it } from 'vitest';
import { dayMinutesGoal, targetLevel } from '@/domain/goals';
import { settingsSchema } from '@/domain/schemas';
import { greetingKey, homeDate } from './greeting';
import { levelPath, weekDots } from './todayQueries';

describe('home header', () => {
  const at = (iso: string) => Date.parse(iso);
  it('greets by the hour in the user’s time zone', () => {
    expect(greetingKey(at('2026-10-25T06:00:00Z'), 'Europe/Istanbul')).toBe('today.greetMorning');
    expect(greetingKey(at('2026-10-25T10:00:00Z'), 'Europe/Istanbul')).toBe('today.greetDay');
    expect(greetingKey(at('2026-10-25T16:00:00Z'), 'Europe/Istanbul')).toBe('today.greetEvening');
    expect(greetingKey(at('2026-10-25T21:30:00Z'), 'Europe/Istanbul')).toBe('today.greetNight');
  });
  it('writes the date as on the board', () => {
    expect(homeDate(at('2026-10-25T16:00:00Z'), 'Europe/Istanbul')).toBe('Pazar, 25 Ekim');
  });
});

describe('week dots', () => {
  it('runs Monday to Sunday and marks today and the days to come', () => {
    const dots = weekDots('2026-10-22', new Set(['2026-10-19', '2026-10-21']));
    expect(dots.map((d) => d.date)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(dots.map((d) => d.active)).toEqual([true, false, true, false, false, false, false]);
    expect(dots.findIndex((d) => d.today)).toBe(3);
    expect(dots.filter((d) => d.future)).toHaveLength(3);
  });
});

describe('level goal', () => {
  it('aims for the next level unless a target is set', () => {
    expect(targetLevel(null, 'B1')).toBe('B2');
    expect(targetLevel({ target_level: 'C1' }, 'B1')).toBe('C1');
    expect(targetLevel(undefined, 'C2')).toBe('C2');
  });
  it('draws the path from A1 to the farther of level and target', () => {
    expect(levelPath('B1', 'B2')).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(levelPath('C1', 'B2')).toEqual(['A1', 'A2', 'B1', 'B2', 'C1']);
  });
  it('accepts only a valid daily minutes goal', () => {
    expect(dayMinutesGoal({ day_minutes: 15 })).toBe(15);
    expect(dayMinutesGoal({ day_minutes: 0 })).toBeNull();
    expect(dayMinutesGoal({ day_minutes: 12.5 })).toBeNull();
    expect(dayMinutesGoal(null)).toBeNull();
  });
});

describe('settings.goals (synced JSON, no schema bump)', () => {
  const base = settingsSchema.parse;
  it('keeps the redesign goals and drops a malformed one without losing the row', () => {
    const row = {
      id: 'settings',
      user_id: null,
      created_at: 0,
      updated_at: 0,
      deleted_at: null,
      hlc: '0',
      daily_new_limit: 10,
      request_retention: 0.9,
      timezone: 'Europe/Istanbul',
      day_start_hour: 4,
      theme: 'system',
      voice: 'en-US',
      level: 'B1',
      level_source: 'default',
      level_updated_at: null,
      level_locked: false,
      level_change: null,
      fsrs_params: null,
      last_backup_at: null,
    };
    const ok = base({ ...row, goals: { week_minutes: 60, day_minutes: 15, target_level: 'B2' } });
    expect(ok.goals).toMatchObject({ week_minutes: 60, day_minutes: 15, target_level: 'B2' });
    const bad = base({ ...row, goals: { day_minutes: -3, target_level: 'Z9', week_minutes: 60 } });
    expect(bad.goals).toMatchObject({ day_minutes: null, target_level: null, week_minutes: 60 });
  });
});
