import { describe, expect, it } from 'vitest';
import { makeLog } from '../test/factories';
import { capacityCards, capacityMinutes, FALLBACK_SEC_PER_CARD, minutesForCards, secondsPerCard } from './capacity';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 22, 12);

const logs = (n: number, ms: number, at = NOW - DAY) =>
  Array.from({ length: n }, (_, i) => makeLog({ id: `l${ms}-${at}-${i}`, card_id: 'c', reviewed_at: at - i, duration_ms: ms }));

describe('capacity', () => {
  it('defaults to 20 minutes and clamps the setting', () => {
    expect(capacityMinutes({})).toBe(20);
    expect(capacityMinutes({ daily_capacity_min: null })).toBe(20);
    expect(capacityMinutes({ daily_capacity_min: 1 })).toBe(5);
    expect(capacityMinutes({ daily_capacity_min: 999 })).toBe(180);
    expect(capacityMinutes({ daily_capacity_min: 30 })).toBe(30);
  });

  it('uses the median answer time of the last 30 days', () => {
    const l = [...logs(30, 6000), ...logs(10, 30_000)];
    expect(secondsPerCard(l, NOW)).toBe(6);
    // 20 min / 6 s = 200 cards.
    expect(capacityCards({ daily_capacity_min: 20 }, l, NOW)).toBe(200);
    // Older answers do not count.
    const old = logs(50, 20_000, NOW - 40 * DAY);
    expect(secondsPerCard([...l, ...old], NOW)).toBe(6);
  });

  it('falls back to 10 s a card without enough history, and ignores undone answers', () => {
    expect(secondsPerCard([], NOW)).toBe(FALLBACK_SEC_PER_CARD);
    expect(capacityCards({}, [], NOW)).toBe(120);
    const l = logs(25, 4000);
    const undo = l
      .slice(0, 10)
      .map((x, i) => makeLog({ id: `u${i}`, card_id: 'c', reviewed_at: NOW - 1000, undo_of: x.id }));
    expect(secondsPerCard([...l, ...undo], NOW)).toBe(FALLBACK_SEC_PER_CARD);
    expect(secondsPerCard(l)).toBe(4); // `now` defaults to the newest log
  });

  it('converts cards back to minutes', () => {
    expect(minutesForCards(120, 10)).toBe(20);
    expect(minutesForCards(1, 10)).toBe(1);
  });
});
