// The learning model (docs/decisions/0041-learning-model.md, ogrenme-modeli.md): the ramp in
// applyRating, the ramp counter, stages and the button labels. The tables in section 3.5 and
// 5.1 of the spec come from a simulation with ts-fsrs and FSRS-6 default weights, fuzz off,
// every answer given exactly when due; these tests reproduce every row.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyRating,
  createScheduler,
  emptyFsrs,
  formatNextInterval,
  nextRampStep,
  previewIntervals,
  provenLevel,
  rampCap,
  RATINGS,
} from './fsrs';
import { GRAD_CAP, RAMP_CAPS, RAMP_EPOCH } from './fsrsConfig';
import { replayCard } from './recompute';
import { becameLearned, cardStage, stageChangeLabel, stageProgress, type WordStage } from './stages';
import { makeLog } from '../test/factories';
import { CardState, type CardStateValue, type FsrsFields, Rating, type RatingValue } from './types';

const MIN = 60_000;
const DAY = 86_400_000;
/** After RAMP_EPOCH: the ramp applies. Same time of day as the spec's simulation. */
const T0 = Date.UTC(2027, 0, 5, 9);
const exact = createScheduler({ request_retention: 0.9, fsrs_params: null }, { fuzz: false });
const fuzzy = createScheduler({ request_retention: 0.9, fsrs_params: null });

const { Again: A, Hard: H, Good: G, Easy: E } = Rating;

interface Row {
  /** Interval to the next review, as the spec writes it: "10m", "3d". */
  ivl: string;
  /** Stability after the answer, one decimal. */
  s: number;
  stage: WordStage;
}

const fmt = (ms: number) => (ms < DAY ? `${Math.round(ms / MIN)}m` : `${Math.round(ms / DAY)}d`);

/** Answer `ratings` one after another, each exactly when the card is due. */
function run(ratings: RatingValue[], scheduler = exact, start = T0, id = 'card-1') {
  let f: FsrsFields = emptyFsrs(start);
  let t = start;
  const rows: Row[] = [];
  const states: { at: number; card: FsrsFields }[] = [];
  for (const r of ratings) {
    states.push({ at: t, card: f });
    f = applyRating(scheduler, { id, ...f }, r, t);
    rows.push({ ivl: fmt(f.due - t), s: Math.round(f.stability * 10) / 10, stage: cardStage(f) });
    t = f.due;
  }
  return { rows, card: f, at: t, states };
}

const rows = (spec: [string, number, WordStage][]): Row[] => spec.map(([ivl, s, stage]) => ({ ivl, s, stage }));

describe('the simulation tables (spec 3.5, fuzz off)', () => {
  it('Good ×8: 10m, 1d, 3d, 7d, 14d, 30d, then FSRS is free (175d, 531d)', () => {
    expect(run([G, G, G, G, G, G, G, G]).rows).toEqual(
      rows([
        ['10m', 2.3, 'learning'],
        ['1d', 2.3, 'learning'],
        ['3d', 7.3, 'consolidating'],
        ['7d', 19.8, 'consolidating'],
        ['14d', 45.2, 'learned'],
        ['30d', 90.2, 'learned'],
        ['175d', 175.3, 'mastered'],
        ['531d', 531.2, 'mastered'],
      ]),
    );
  });

  it('Easy ×4: 3d, 7d, 14d, 30d — Easy widens the gap but still needs three separate days', () => {
    expect(run([E, E, E, E]).rows).toEqual(
      rows([
        ['3d', 8.3, 'learning'],
        ['7d', 34.6, 'consolidating'],
        ['14d', 86.3, 'consolidating'],
        ['30d', 176.7, 'learned'],
      ]),
    );
  });

  it('Good, Again, Good ×4: the ramp changes almost nothing after a first-day slip', () => {
    expect(run([G, A, G, G, G, G]).rows).toEqual(
      rows([
        ['10m', 2.3, 'learning'],
        ['1m', 0.8, 'learning'],
        ['10m', 0.8, 'learning'],
        ['1d', 0.9, 'learning'],
        ['3d', 2.8, 'consolidating'],
        ['7d', 7.7, 'consolidating'],
      ]),
    );
  });

  it('Hard, Good ×4', () => {
    expect(run([H, G, G, G, G]).rows).toEqual(
      rows([
        ['6m', 1.3, 'learning'],
        ['10m', 1.3, 'learning'],
        ['1d', 1.4, 'learning'],
        ['3d', 4.7, 'consolidating'],
        ['7d', 12.9, 'consolidating'],
      ]),
    );
  });

  it('a lapse in review: Good ×4, Again, Good ×4 is learned again at the last answer', () => {
    expect(run([G, G, G, G, A, G, G, G, G]).rows).toEqual(
      rows([
        ['10m', 2.3, 'learning'],
        ['1d', 2.3, 'learning'],
        ['3d', 7.3, 'consolidating'],
        ['7d', 19.8, 'consolidating'],
        ['10m', 1.9, 'learning'],
        ['1d', 1.9, 'learning'],
        ['3d', 3.9, 'consolidating'],
        ['7d', 8.9, 'consolidating'],
        ['14d', 19.1, 'learned'],
      ]),
    );
  });

  it('answers before RAMP_EPOCH keep today\'s intervals (2d, 11d, 46d, 163d, 498d)', () => {
    const before = run([G, G, G, G, G, G], exact, RAMP_EPOCH - 400 * DAY).rows;
    expect(before.map((r) => r.ivl)).toEqual(['10m', '2d', '11d', '46d', '163d', '498d']);
    expect(before.map((r) => r.s)).toEqual([2.3, 2.3, 11, 46.3, 163, 497.9]);
  });
});

describe('button previews (spec 5.1)', () => {
  /** Labels and arrow lines of the four buttons after answering `ratings` on time. */
  function buttons(ratings: RatingValue[]): string[] {
    const { card, at } = run(ratings);
    const p = previewIntervals(exact, { id: 'card-1', ...card }, at);
    const now = cardStage(card);
    return RATINGS.map((r) => {
      const arrow = stageChangeLabel(now, p[r].stageAfter);
      return arrow ? `${p[r].label} ${arrow}` : p[r].label;
    });
  }

  it.each<[string, RatingValue[], string[]]>([
    ['new word', [], ['1 dk', '6 dk', '10 dk', '3 gün']],
    ['after the 1 m step', [G], ['1 dk', '6 dk', 'yarın', '3 gün']],
    ['Öğreniyor (next-day test)', [G, G], ['10 dk', '2 gün ↑ Pekişiyor', '3 gün ↑ Pekişiyor', '1 hafta ↑ Pekişiyor']],
    ['Pekişiyor 1/3', [G, G, G], ['10 dk ↓ yeniden öğren', '4 gün', '1 hafta', '2 hafta']],
    ['Pekişiyor 2/3', [G, G, G, G], ['10 dk ↓ yeniden öğren', '1 hafta ↑ Öğrenildi', '2 hafta ↑ Öğrenildi', '1 ay ↑ Öğrenildi']],
    ['Öğrenildi, last ramp step', [G, G, G, G, G], ['10 dk ↓ yeniden öğren', '15 gün', '1 ay', '2 ay']],
    ['Öğrenildi, free', [G, G, G, G, G, G], ['10 dk ↓ yeniden öğren', '5 ay ↑ Kalıcı', '6 ay ↑ Kalıcı', '8 ay ↑ Kalıcı']],
  ])('%s', (_label, seq, expected) => {
    expect(buttons(seq)).toEqual(expected);
  });

  it('the Hard arrow at Pekişiyor 2/3 comes from the computed stability (35 days here)', () => {
    const { card, at } = run([G, G, G, G]);
    const hard = applyRating(exact, { id: 'card-1', ...card }, H, at);
    expect(hard.stability).toBeGreaterThan(14);
    expect(Math.round(hard.stability)).toBe(35);
  });

  it('previews agree with the answer path, fuzz included', () => {
    const { card, at } = run([G, G, G, G], fuzzy);
    const p = previewIntervals(fuzzy, { id: 'card-1', ...card }, at);
    for (const r of RATINGS) expect(p[r].due).toBe(applyRating(fuzzy, { id: 'card-1', ...card }, r, at).due);
  });
});

describe('the ramp', () => {
  it('caps leaving (re)learning at 1 day (Hard, Good) and 3 days (Easy)', () => {
    expect(rampCap(CardState.Learning, H, 0, 0)).toEqual({ days: GRAD_CAP.Hard, fromTable: false, min: 0 });
    expect(rampCap(CardState.Relearning, G, 3, 0)).toEqual({ days: 1, fromTable: false, min: 0 });
    expect(rampCap(CardState.New, E, 0, 0)).toEqual({ days: 3, fromTable: false, min: 0 });
    expect(rampCap(CardState.Review, A, 0, 5)).toBeNull();
  });

  it('caps reviews by ramp_step from the table, and lets FSRS free from step 4', () => {
    for (let step = 0; step < 4; step++) {
      expect(rampCap(CardState.Review, H, step, 0)?.days).toBe(RAMP_CAPS.Hard[step]);
      expect(rampCap(CardState.Review, G, step, 0)?.days).toBe(RAMP_CAPS.Good[step]);
      expect(rampCap(CardState.Review, E, step, 0)?.days).toBe(RAMP_CAPS.Easy[step]);
    }
    expect(rampCap(CardState.Review, G, 4, 0)).toBeNull();
    expect(rampCap(CardState.Review, H, 9, 0)).toBeNull();
  });

  it('proven-gap floor: a card answered Good 20 days late is not scheduled below 20 days', () => {
    const { card, at } = run([G, G, G]); // Review, ramp_step 1, due in 7 days
    expect(card.ramp_step).toBe(1);
    const late = at + 20 * DAY;
    const gap = (late - card.last_review!) / DAY;
    const good = applyRating(exact, { id: 'card-1', ...card }, G, late);
    expect(good.scheduled_days).toBeGreaterThanOrEqual(Math.floor(gap));
    expect(good.due - late).toBeGreaterThanOrEqual(Math.floor(gap) * DAY);
    const easy = applyRating(exact, { id: 'card-1', ...card }, E, late);
    expect(easy.scheduled_days).toBeGreaterThanOrEqual(Math.floor(gap));
    // The gap proves level 3 (≥ 14 days): the counter jumps there.
    expect(good.ramp_step).toBe(3);
    // Hard gets no floor: it keeps its table cap.
    expect(applyRating(exact, { id: 'card-1', ...card }, H, late).scheduled_days).toBeLessThanOrEqual(RAMP_CAPS.Hard[1]);
  });

  it('a lapse resets the counter to 0, or to 1 from Öğrenildi (ramp_step ≥ 3)', () => {
    expect(nextRampStep(CardState.Review, A, 2, 7, 7)).toBe(0);
    expect(nextRampStep(CardState.Review, A, 3, 14, 14)).toBe(1);
    expect(nextRampStep(CardState.Review, A, 7, 300, 300)).toBe(1);
    const { card, at } = run([G, G, G, G, G, G]); // ramp_step 4
    const lapse = applyRating(exact, { id: 'card-1', ...card }, A, at);
    expect(lapse.ramp_step).toBe(1);
    expect(lapse.state).toBe(CardState.Relearning);
    expect(cardStage(lapse)).toBe('learning');
    // Relearned: Pekişiyor 1/3 again, back to Öğrenildi after two more good reviews.
    const back = applyRating(exact, { id: 'card-1', ...lapse }, G, lapse.due);
    expect(back.due - lapse.due).toBe(DAY);
    expect(cardStage(back)).toBe('consolidating');
    expect(stageProgress(back)).toEqual({ step: 1, of: 3 });
  });

  it('learning steps never move the counter', () => {
    expect(nextRampStep(CardState.New, G, 0, 0, 0)).toBe(0);
    expect(nextRampStep(CardState.Learning, E, 0, 0, 0)).toBe(0);
    expect(nextRampStep(CardState.Relearning, G, 1, 0.01, 0)).toBe(1);
  });

  it('an answer on a later calendar day counts even under 12 h (ADR 0055)', () => {
    // Istanbul (UTC+3), day starts at 04:00. Good 22:00, Good 22:11, next day Good 09:11.
    const day = createScheduler(
      { request_retention: 0.9, fsrs_params: null, timezone: 'Europe/Istanbul', day_start_hour: 4 },
      { fuzz: false },
    );
    const at22 = Date.UTC(2027, 0, 5, 19, 0); // 22:00 local
    let f: FsrsFields = emptyFsrs(at22);
    f = applyRating(day, { id: 'c', ...f }, G, at22);
    f = applyRating(day, { id: 'c', ...f }, G, at22 + 11 * MIN);
    expect(f.state).toBe(CardState.Review);
    expect(f.ramp_step).toBe(0);
    const morning = at22 + 11 * MIN + 11 * 60 * MIN; // 09:11 local next day
    const next = applyRating(day, { id: 'c', ...f }, G, morning);
    expect(next.ramp_step).toBe(1);
    expect(cardStage(next)).toBe('consolidating');
    // Without a calendar (old hour rule) the same answer would not count.
    expect(applyRating(exact, { id: 'c', ...f }, G, morning).ramp_step).toBe(0);
    // 03:30 the next night is still the same day (day starts at 04:00): no count.
    const night = at22 + 5.5 * 60 * MIN; // 03:30 local
    const g1 = applyRating(day, { id: 'c', ...f }, G, at22 + 11 * MIN);
    expect(applyRating(day, { id: 'c', ...g1 }, G, night).ramp_step).toBe(0);
  });

  it('a later day before the due day ("Yarının kartlarını şimdi") stays early', () => {
    const day = createScheduler(
      { request_retention: 0.9, fsrs_params: null, timezone: 'UTC', day_start_hour: 4 },
      { fuzz: false },
    );
    const { card, at } = run([G, G, G], day); // ramp 1, due 3 days after the last review
    // One day after the last review, two days before due: still early.
    expect(applyRating(day, { id: 'card-1', ...card }, G, at - 2 * DAY).ramp_step).toBe(1);
    expect(nextRampStep(CardState.Review, G, 1, 0.4, 1, true)).toBe(2);
  });

  it('an early review ("Yarının kartlarını şimdi çalış") does not count', () => {
    // Under 12 hours.
    expect(nextRampStep(CardState.Review, G, 1, 0.4, 0)).toBe(1);
    // Under half the planned interval.
    expect(nextRampStep(CardState.Review, G, 1, 3, 7)).toBe(1);
    expect(nextRampStep(CardState.Review, G, 1, 3.5, 7)).toBe(2);
    const { card, at } = run([G, G, G]); // ramp_step 1, due 3 days after the last review
    expect(card.scheduled_days).toBe(3);
    const ahead = applyRating(exact, { id: 'card-1', ...card }, G, at - 2 * DAY); // 1 day after it
    expect(ahead.ramp_step).toBe(1);
    // Answered the day it was due, it counts.
    expect(applyRating(exact, { id: 'card-1', ...card }, G, at).ramp_step).toBe(2);
  });

  it('a long gap proves itself: 3+ d → 1, 7+ → 2, 14+ → 3, 30+ → 4', () => {
    expect([0, 2.9, 3, 6.9, 7, 13.9, 14, 29.9, 30, 400].map(provenLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(nextRampStep(CardState.Review, G, 0, 46, 46)).toBe(4);
    expect(nextRampStep(CardState.Review, H, 0, 9, 3)).toBe(2);
  });

  it('learned_at is set the first time the card is Öğrenildi and never cleared', () => {
    const { states, card } = run([G, G, G, G, G, A, G]);
    const learnedAt = states[4]!.at; // the fifth answer made it Öğrenildi
    expect(card.learned_at).toBe(learnedAt);
    expect(cardStage(card)).toBe('consolidating');
    // Only that answer counts for the session summary.
    const flags = states.map((s, i) => becameLearned(s.card, states[i + 1]?.card ?? card));
    expect(flags).toEqual([false, false, false, false, true, false, false]);
  });

  it('downward fuzz only on table caps of 14 days and more, at most 10 %, the same on every device', () => {
    const caps: number[] = [];
    for (let i = 0; i < 200; i++) {
      const { card, at } = run([G, G, G, G], fuzzy, T0, `fz-${i}`); // ramp_step 2: Good cap 14
      const next = applyRating(fuzzy, { id: `fz-${i}`, ...card }, G, at);
      expect(next).toEqual(applyRating(fuzzy, { id: `fz-${i}`, ...card }, G, at));
      caps.push(next.scheduled_days);
    }
    expect(Math.min(...caps)).toBeGreaterThanOrEqual(13);
    expect(Math.max(...caps)).toBeLessThanOrEqual(14);
    expect(new Set(caps).size).toBe(2);
    // Short caps are never fuzzed.
    for (let i = 0; i < 50; i++) {
      const { card, at } = run([G, G], fuzzy, T0, `short-${i}`);
      expect(applyRating(fuzzy, { id: `short-${i}`, ...card }, G, at).scheduled_days).toBe(3);
    }
  });
});

describe('Hard < Good < Easy stays strict', () => {
  it('across 10 000 random review states after the epoch', () => {
    const state = fc.record({
      stability: fc.double({ min: 0.1, max: 400, noNaN: true }),
      difficulty: fc.double({ min: 1, max: 10, noNaN: true }),
      ramp: fc.integer({ min: 0, max: 7 }),
      scheduled: fc.integer({ min: 1, max: 120 }),
      gap: fc.double({ min: 0.01, max: 200, noNaN: true }),
      card: fc.integer({ min: 0, max: 1e6 }),
    });
    fc.assert(
      fc.property(state, (x) => {
        const at = T0 + 1000 * DAY;
        const card = {
          id: `p-${x.card}`,
          ...emptyFsrs(T0),
          state: CardState.Review as CardStateValue,
          stability: x.stability,
          difficulty: x.difficulty,
          reps: 5,
          scheduled_days: x.scheduled,
          last_review: at - Math.round(x.gap * DAY),
          due: at - Math.round(x.gap * DAY) + x.scheduled * DAY,
          ramp_step: x.ramp,
        };
        const [h, g, e] = [H, G, E].map((r) => applyRating(fuzzy, card, r, at).due);
        return h! < g! && g! < e!;
      }),
      { numRuns: 10_000 },
    );
  });
});

describe('replay', () => {
  it('pre-epoch logs give byte-identical FSRS fields to the uncapped scheduler', () => {
    const start = RAMP_EPOCH - 600 * DAY;
    fc.assert(
      fc.property(fc.array(fc.constantFrom<RatingValue>(A, H, G, E, G, G), { minLength: 1, maxLength: 25 }), fc.integer({ min: 0, max: 1e6 }), (ratings, n) => {
        const id = `r-${n}`;
        const logs = [];
        let f = emptyFsrs(start);
        let t = start;
        let plain = emptyFsrs(start);
        for (const r of ratings) {
          if (t >= RAMP_EPOCH) break;
          logs.push(makeLog({ card_id: id, rating: r, reviewed_at: t }));
          f = applyRating(fuzzy, { id, ...f }, r, t);
          // The ts-fsrs result itself, without the ramp layer.
          const raw = fuzzy.engine.next(
            { card_id: id, ...toTs(plain) } as never,
            new Date(t),
            r as never,
          ).card;
          plain = { ...plain, due: raw.due.getTime(), stability: raw.stability, difficulty: raw.difficulty, elapsed_days: raw.elapsed_days, scheduled_days: raw.scheduled_days, learning_steps: raw.learning_steps, reps: raw.reps, lapses: raw.lapses, state: raw.state as CardStateValue, last_review: raw.last_review!.getTime() };
          t = Math.max(f.due, t + MIN);
        }
        const { fsrs } = replayCard(fuzzy, { id, created_at: start }, logs);
        expect(fsrs).toEqual(f);
        const { ramp_step: _r, learned_at: _l, ...engine } = fsrs;
        const { ramp_step: _r2, learned_at: _l2, ...expected } = plain;
        expect(engine).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });

  it('the ramp counter is tracked before the epoch too, so old cards get honest stages', () => {
    // Today's gaps 2 d, 11 d, 46 d, 163 d: the long gaps prove their levels (11 → 2, 46 → 4).
    const { card, states } = run([G, G, G, G, G, G], exact, RAMP_EPOCH - 800 * DAY);
    expect(card.ramp_step).toBe(5);
    expect(cardStage(card)).toBe('mastered');
    // Öğrenildi at the fifth answer (ramp 4, S 46).
    expect(card.learned_at).toBe(states[4]!.at);
  });
});

function toTs(f: FsrsFields) {
  return {
    due: new Date(f.due),
    stability: f.stability,
    difficulty: f.difficulty,
    elapsed_days: f.elapsed_days,
    scheduled_days: f.scheduled_days,
    learning_steps: f.learning_steps,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state,
    ...(f.last_review !== null ? { last_review: new Date(f.last_review) } : {}),
  };
}

describe('stages (spec 2.2)', () => {
  const card = (state: CardStateValue, ramp_step: number, stability: number) => ({ state, ramp_step, stability });

  it.each<[string, ReturnType<typeof card>, WordStage]>([
    ['never answered', card(CardState.New, 0, 0), 'new'],
    ['learning steps', card(CardState.Learning, 0, 2), 'learning'],
    ['relearning', card(CardState.Relearning, 1, 30), 'learning'],
    ['graduated, not yet recalled on another day', card(CardState.Review, 0, 50), 'learning'],
    ['ramp 1', card(CardState.Review, 1, 50), 'consolidating'],
    ['ramp 2 → 3 boundary (2)', card(CardState.Review, 2, 50), 'consolidating'],
    ['ramp 2 → 3 boundary (3)', card(CardState.Review, 3, 50), 'learned'],
    ['S 13.9', card(CardState.Review, 3, 13.9), 'consolidating'],
    ['S 14', card(CardState.Review, 3, 14), 'learned'],
    ['ramp 4, S 200', card(CardState.Review, 4, 200), 'learned'],
    ['ramp 5, S 90', card(CardState.Review, 5, 90), 'mastered'],
    ['ramp 5, S 89', card(CardState.Review, 5, 89), 'learned'],
    ['ramp 5, S 13', card(CardState.Review, 5, 13), 'consolidating'],
  ])('%s', (_label, c, stage) => {
    expect(cardStage(c)).toBe(stage);
  });

  it('progress towards Öğrenildi: Pekişiyor 1/3, 2/3 (and 2/3 while S < 14)', () => {
    expect(stageProgress(card(CardState.Review, 1, 5))).toEqual({ step: 1, of: 3 });
    expect(stageProgress(card(CardState.Review, 2, 5))).toEqual({ step: 2, of: 3 });
    expect(stageProgress(card(CardState.Review, 4, 10))).toEqual({ step: 2, of: 3 });
    expect(stageProgress(card(CardState.Learning, 0, 1))).toEqual({ step: 0, of: 3 });
    expect(stageProgress(card(CardState.Review, 6, 100))).toEqual({ step: 3, of: 3 });
  });

  it('arrow lines only when the stage changes; reaching Öğreniyor gets none', () => {
    expect(stageChangeLabel('new', 'learning')).toBeNull();
    expect(stageChangeLabel('learning', 'consolidating')).toBe('↑ Pekişiyor');
    expect(stageChangeLabel('consolidating', 'learned')).toBe('↑ Öğrenildi');
    expect(stageChangeLabel('learned', 'mastered')).toBe('↑ Kalıcı');
    expect(stageChangeLabel('mastered', 'learning')).toBe('↓ yeniden öğren');
    expect(stageChangeLabel('learned', 'learned')).toBeNull();
  });
});

describe('formatNextInterval (spec 5.1)', () => {
  it.each<[number, string]>([
    [30_000, '1 dk'],
    [MIN, '1 dk'],
    [6 * MIN, '6 dk'],
    [10 * MIN, '10 dk'],
    [3 * 3_600_000, '3 sa'],
    [DAY, 'yarın'],
    [2 * DAY, '2 gün'],
    [3 * DAY, '3 gün'],
    [6 * DAY, '6 gün'],
    [7 * DAY, '1 hafta'],
    [13 * DAY, '13 gün'],
    [14 * DAY, '2 hafta'],
    [15 * DAY, '15 gün'],
    [21 * DAY, '3 hafta'],
    [30 * DAY, '1 ay'],
    [45 * DAY, '1,5 ay'],
    [60 * DAY, '2 ay'],
    [120 * DAY, '4 ay'],
    [141 * DAY, '5 ay'],
    [175 * DAY, '6 ay'],
    [250 * DAY, '8 ay'],
    [365 * DAY, '1 yıl'],
    [531 * DAY, '1,5 yıl'],
    [730 * DAY, '2 yıl'],
  ])('%d ms → %s', (ms, label) => {
    expect(formatNextInterval(ms)).toBe(label);
  });
});
