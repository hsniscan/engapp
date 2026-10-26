import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeCard } from '../test/factories';
import {
  estimateCatchupDays,
  type LoadFacts,
  planLoad,
  rampedNewLimit,
  relativeOverdueness,
} from './catchup';
import { applyRating, createScheduler, emptyFsrs, fsrsEqual, pickFsrs } from './fsrs';
import { buildQueue, type QueueContext } from './queue';
import { replayCard } from './recompute';
import { type Card, CardState, type Id, type RatingValue, type ReviewLog } from './types';

const DAY = 86_400_000;
const MIN = 60_000;

function facts(p: Partial<LoadFacts> = {}): LoadFacts {
  return {
    capacity: 100,
    catchupAuto: true,
    backlogToday: 50,
    backlogYesterday: 40,
    reviewsDoneToday: 0,
    onVacationToday: false,
    daysSinceVacation: null,
    ...p,
  };
}

describe('planLoad', () => {
  it('is normal when the backlog fits', () => {
    expect(planLoad(facts())).toEqual({ mode: 'normal', reviewCap: null, newFactor: 1 });
  });

  it('caps reviews and pauses new cards when the backlog exceeds capacity', () => {
    expect(planLoad(facts({ backlogToday: 300 }))).toEqual({ mode: 'catchup', reviewCap: 100, newFactor: 0 });
    expect(planLoad(facts({ backlogToday: 300, reviewsDoneToday: 40 })).reviewCap).toBe(60);
    expect(planLoad(facts({ backlogToday: 300, reviewsDoneToday: 140 })).reviewCap).toBe(0);
  });

  it('does nothing when catch-up is turned off, except right after a vacation', () => {
    expect(planLoad(facts({ backlogToday: 300, catchupAuto: false })).mode).toBe('normal');
    expect(planLoad(facts({ backlogToday: 300, catchupAuto: false, daysSinceVacation: 2 })).mode).toBe('catchup');
  });

  it('ramps new cards 0 → ½ → full after a catch-up and after a vacation', () => {
    expect(planLoad(facts({ backlogYesterday: 300 }))).toEqual({ mode: 'ramp', reviewCap: null, newFactor: 0.5 });
    expect(planLoad(facts({ onVacationToday: true })).newFactor).toBe(0);
    expect(planLoad(facts({ daysSinceVacation: 1 })).newFactor).toBe(0);
    expect(planLoad(facts({ daysSinceVacation: 2 })).newFactor).toBe(0.5);
    expect(planLoad(facts({ daysSinceVacation: 3 })).newFactor).toBe(1);
  });

  it('halves the limit rounding up', () => {
    expect([0, 1, 7, 10].map((n) => rampedNewLimit(n, 0.5))).toEqual([0, 1, 4, 5]);
    expect(rampedNewLimit(10, 0)).toBe(0);
    expect(rampedNewLimit(10, 1)).toBe(10);
  });
});

describe('estimateCatchupDays', () => {
  it('counts days until the backlog is gone', () => {
    expect(estimateCatchupDays(80, 100, [10, 10])).toBe(1);
    expect(estimateCatchupDays(300, 100, [20, 20, 20, 20])).toBe(4);
    expect(estimateCatchupDays(300, 10, [20, 20])).toBeNull();
  });
});

describe('capped queue (property)', () => {
  const NOW = Date.UTC(2026, 9, 22, 9);
  const DAY_END = Date.UTC(2026, 9, 23, 1);
  const ctx = (p: Partial<QueueContext> = {}): QueueContext => ({
    now: NOW,
    dayEnd: DAY_END,
    dailyNewLimit: 0,
    newIntroducedToday: 0,
    reviewedTodayCardIds: new Set(),
    reviewedTodayNoteIds: new Set(),
    learnAheadMs: 0,
    ...p,
  });

  it('holds at most the cap, a subset of the uncapped queue, most overdue first, inputs untouched', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ lateDays: fc.integer({ min: -3, max: 60 }), ivl: fc.integer({ min: 0, max: 200 }) }), {
          maxLength: 80,
        }),
        fc.integer({ min: 0, max: 100 }),
        (specs, cap) => {
          const cards = specs.map((s, i) =>
            makeCard({ id: `c${i}`, note_id: `n${i}`, state: CardState.Review, due: NOW - s.lateDays * DAY, scheduled_days: s.ivl }),
          );
          const before = JSON.stringify(cards);
          const full = buildQueue(cards, ctx());
          const capped = buildQueue(cards, ctx({ reviewCap: cap }));
          expect(JSON.stringify(cards)).toBe(before);
          const reviews = capped.items.filter((i) => i.kind === 'review');
          expect(reviews.length).toBe(Math.min(cap, full.counts.review));
          const all = new Set(full.items.map((i) => i.card_id));
          for (const r of reviews) expect(all.has(r.card_id)).toBe(true);
          const od = (id: Id) => relativeOverdueness(cards.find((c) => c.id === id)!, NOW);
          for (let i = 1; i < reviews.length; i++) expect(od(reviews[i - 1]!.card_id)).toBeGreaterThanOrEqual(od(reviews[i]!.card_id));
          // Nothing left out is more overdue than what was taken.
          if (reviews.length) {
            const min = od(reviews.at(-1)!.card_id);
            const taken = new Set(reviews.map((r) => r.card_id));
            for (const c of full.items) if (c.kind === 'review' && !taken.has(c.card_id)) expect(od(c.card_id)).toBeLessThanOrEqual(min);
          }
        },
      ),
    );
  });
});

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('5-day gap with ~300 reviews due (acceptance 1)', () => {
  const scheduler = createScheduler({ request_retention: 0.9, fsrs_params: null });
  const T0 = Date.UTC(2026, 9, 1, 1); // a day start (04:00 Istanbul)
  const CAPACITY = 120; // 20 min at 10 s a card

  function seedDeck(): { cards: Card[]; logs: ReviewLog[]; gapStart: number } {
    const rand = rng(42);
    const cards: Card[] = [];
    const logs: ReviewLog[] = [];
    let seq = 0;
    // Studied up to day 30; the user then stays away for 5 days.
    const gapStart = T0 + 30 * DAY;
    for (let i = 0; i < 1100; i++) {
      const id = `c${String(i).padStart(4, '0')}`;
      const created = T0 + Math.floor(rand() * 25) * DAY;
      let f = emptyFsrs(created);
      let t = created + 9 * 3_600_000;
      while (t < gapStart) {
        const r = rand();
        const rating = (r < 0.1 ? 1 : r < 0.9 ? 3 : 4) as RatingValue;
        f = applyRating(scheduler, { id, ...f }, rating, t);
        logs.push({ id: `l${String(++seq).padStart(7, '0')}`, user_id: null, card_id: id, rating, reviewed_at: t, duration_ms: 8000, device_id: 'd', undo_of: null, shown_sense_id: null, created_at: t, hlc: 'h' });
        t = Math.max(f.due, t + MIN);
      }
      cards.push(makeCard({ id, note_id: `n${i}`, created_at: created, ...f }));
    }
    for (let i = 0; i < 200; i++) cards.push(makeCard({ id: `new${String(i).padStart(4, '0')}`, note_id: `nn${i}`, created_at: T0 + i }));
    return { cards, logs, gapStart };
  }

  it('shows at most capacity reviews a day, clears the backlog within 7 days, ramps new cards, and writes nothing itself', () => {
    const { cards: start, logs, gapStart } = seedDeck();
    const back = gapStart + 5 * DAY; // first day back (day start)
    const isReview = (c: Card) => c.state === CardState.Review && c.deleted_at === null && !c.suspended;
    const backlogCards = new Set(start.filter((c) => isReview(c) && c.due < back + DAY).map((c) => c.id));
    expect(backlogCards.size).toBeGreaterThanOrEqual(280);

    const cards = new Map(start.map((c) => [c.id, { ...c }]));
    const rand = rng(7);
    const backlogAt = (dayStart: number) => [...cards.values()].filter((c) => isReview(c) && c.due < dayStart + DAY).length;
    let backlogYesterday: number | null = null;
    const perDay: { reviews: number; fresh: number; mode: string }[] = [];
    let clearedOn: number | null = null;

    for (let d = 0; d < 10; d++) {
      const dayStart = back + d * DAY;
      const dayEnd = dayStart + DAY;
      const backlogToday = backlogAt(dayStart);
      let reviewsDone = 0;
      let fresh = 0;
      const reviewedCards = new Set<Id>();
      const reviewedNotes = new Set<Id>();
      let now = dayStart + 8 * 3_600_000;
      let plan = planLoad({ capacity: CAPACITY, catchupAuto: true, backlogToday, backlogYesterday, reviewsDoneToday: 0, onVacationToday: false, daysSinceVacation: null });
      const mode = plan.mode;
      for (let guard = 0; guard < 2000; guard++) {
        plan = planLoad({ capacity: CAPACITY, catchupAuto: true, backlogToday, backlogYesterday, reviewsDoneToday: reviewsDone, onVacationToday: false, daysSinceVacation: null });
        const q = buildQueue(cards.values(), {
          now,
          dayEnd,
          dailyNewLimit: rampedNewLimit(10, plan.newFactor),
          newIntroducedToday: fresh,
          reviewedTodayCardIds: reviewedCards,
          reviewedTodayNoteIds: reviewedNotes,
          reviewCap: plan.reviewCap,
          learnAheadMs: 20 * MIN,
        });
        const item = q.items[0];
        if (!item) break;
        const card = cards.get(item.card_id)!;
        if (card.state === CardState.Review) reviewsDone++;
        if (card.state === CardState.New) fresh++;
        const rating = (card.state === CardState.Review && rand() < 0.1 ? 1 : 3) as RatingValue;
        now = Math.max(now, card.due);
        const next = applyRating(scheduler, card, rating, now);
        logs.push({ id: `x${d}-${guard}`, user_id: null, card_id: card.id, rating, reviewed_at: now, duration_ms: 8000, device_id: 'd', undo_of: null, shown_sense_id: null, created_at: now, hlc: 'h' });
        cards.set(card.id, { ...card, ...next });
        reviewedCards.add(card.id);
        reviewedNotes.add(card.note_id);
        now += 10_000;
      }
      perDay.push({ reviews: reviewsDone, fresh, mode });
      backlogYesterday = backlogToday;
      const left = [...backlogCards].filter((id) => {
        const c = cards.get(id)!;
        return c.last_review === null || c.last_review < back;
      });
      if (clearedOn === null && left.length === 0) clearedOn = d + 1;
    }

    for (const day of perDay) expect(day.reviews).toBeLessThanOrEqual(CAPACITY);
    expect(perDay[0]!.mode).toBe('catchup');
    expect(clearedOn).not.toBeNull();
    expect(clearedOn!).toBeLessThanOrEqual(7);
    // New cards: none while catching up, half on the day after, then the full limit.
    const firstNormal = perDay.findIndex((p) => p.mode !== 'catchup');
    for (const p of perDay.slice(0, firstNormal)) expect(p.fresh).toBe(0);
    expect(perDay[firstNormal]).toMatchObject({ mode: 'ramp', fresh: 5 });
    expect(perDay[firstNormal + 1]).toMatchObject({ mode: 'normal', fresh: 10 });

    // Recompute from the logs gives the same cards: catch-up only chose what to show.
    // Logs grouped once: replaying each card against every log was the slow part under load.
    const byCard = new Map<Id, typeof logs>();
    for (const l of logs) {
      const list = byCard.get(l.card_id);
      if (list) list.push(l);
      else byCard.set(l.card_id, [l]);
    }
    for (const c of cards.values()) {
      const replayed = replayCard(scheduler, c, byCard.get(c.id) ?? []).fsrs;
      expect(fsrsEqual(replayed, pickFsrs(c)), c.id).toBe(true);
    }
    // A pure simulation of ten days: CPU bound, so it gets room on a busy machine.
  }, 60_000);
});
