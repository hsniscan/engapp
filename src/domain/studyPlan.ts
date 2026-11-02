// Today's study across the modes (v0.5.1, ADR 0055): one "remaining today" count and one time
// estimate for Bugün, the Çalış picker, the mixed session and "Biraz daha çalış", and the mode to
// study next. Pure.
//
// The estimate counts answers, not cards: a new card takes its learning steps on the first day
// (1 min → 10 min → graduate: about 2.5 answers with the usual Again/Good mix), a card in a
// learning step about 1.5 more, a due review one.
import { STUDY_MODES, type StudyMode } from './studyMode';

/** Answers a first-time card takes on its first day (learning steps included). */
export const ANSWERS_PER_NEW = 2.5;
/** Answers a card already in a (re)learning step still takes today. */
export const ANSWERS_PER_LEARNING = 1.5;

export interface ModeLeft {
  /** Reviews due today (Review state). */
  review: number;
  /** (Re)learning steps due today. */
  learning: number;
  /** First-time cards the mode's limit still allows today. */
  fresh: number;
}

/** Cards left in a mode today. */
export const cardsLeft = (m: ModeLeft): number => m.review + m.learning + m.fresh;

/** Answers the cards left will take, learning steps included. */
export function answersLeft(m: ModeLeft): number {
  return m.review + m.learning * ANSWERS_PER_LEARNING + m.fresh * ANSWERS_PER_NEW;
}

/** Minutes for `answers` answers at `secPerAnswer` (rounded up; 0 for none, else at least 1). */
export function minutesFor(answers: number, secPerAnswer: number): number {
  if (!(answers > 0)) return 0;
  return Math.max(1, Math.ceil((answers * secPerAnswer) / 60));
}

export interface TodayPlan {
  /** Cards left over every mode shown. */
  left: number;
  /** Minutes those cards take. */
  minutes: number;
  /** First mode (in STUDY_MODES order) with cards left, null when all are done. */
  next: StudyMode | null;
  /** Modes with cards left, in order. */
  waiting: StudyMode[];
}

/**
 * The day over the given modes (absent modes, such as Dikte without sentences on this device,
 * do not count). `order` defaults to the modes' own order: Kelime, Üretim, Boşluk, Dikte.
 */
export function planToday(
  modes: Partial<Record<StudyMode, ModeLeft>>,
  secPerAnswer: number,
  order: readonly StudyMode[] = STUDY_MODES,
): TodayPlan {
  let answers = 0;
  let left = 0;
  const waiting: StudyMode[] = [];
  for (const m of order) {
    const c = modes[m];
    if (!c) continue;
    answers += answersLeft(c);
    left += cardsLeft(c);
    if (cardsLeft(c) > 0) waiting.push(m);
  }
  return { left, minutes: minutesFor(answers, secPerAnswer), next: waiting[0] ?? null, waiting };
}

export type ModeNumbers = Partial<Record<StudyMode, number>>;

const zeros = (): Record<StudyMode, number> => ({ word: 0, production: 0, cloze: 0, dictation: 0 });
const nonNeg = (n: number | undefined | null): number => (typeof n === 'number' && n > 0 ? Math.floor(n) : 0);

/**
 * Fair split of `budget` units over the modes (water-filling): every mode with demand left gets
 * the next unit in turn, by weight, until the budget or the demand runs out, so a mode that
 * needs little leaves its share to the others. Ties go to the earlier mode (STUDY_MODES order).
 * Deterministic and integer.
 */
export function fairShares(
  budget: number,
  demand: ModeNumbers,
  weights: ModeNumbers = {},
  order: readonly StudyMode[] = STUDY_MODES,
): Record<StudyMode, number> {
  const out = zeros();
  const need = Object.fromEntries(order.map((m) => [m, nonNeg(demand[m])])) as Record<StudyMode, number>;
  let left = Math.min(nonNeg(budget), order.reduce((n, m) => n + need[m], 0));
  while (left > 0) {
    let pick: StudyMode | null = null;
    let best = Infinity;
    for (const m of order) {
      if (out[m] >= need[m]) continue;
      const w = weights[m] && weights[m]! > 0 ? weights[m]! : 1;
      const level = out[m] / w;
      if (level < best) {
        best = level;
        pick = m;
      }
    }
    if (!pick) break;
    out[pick]++;
    left--;
  }
  return out;
}

/** Lower the later modes' numbers until their sum fits `total` (earlier modes keep theirs). */
function fitTotal(shares: Record<StudyMode, number>, total: number, order: readonly StudyMode[]): Record<StudyMode, number> {
  let over = order.reduce((n, m) => n + shares[m], 0) - Math.max(0, total);
  for (const m of [...order].reverse()) {
    if (over <= 0) break;
    const cut = Math.min(over, shares[m]);
    shares[m] -= cut;
    over -= cut;
  }
  return shares;
}

/**
 * Kelime çalışma introduces words; the other modes' first-time cards come from words already
 * at Pekişiyor. Kelime's weight in the shared new-card budget (v0.5.2, ADR 0062).
 */
export const NEW_BUDGET_WEIGHTS: ModeNumbers = { word: 2, production: 1, cloze: 1, dictation: 1 };

export interface NewBudgetInput {
  /** "Günlük yeni kart": first-time cards a day over every mode together (after the ramp). */
  total: number;
  /** First-time cards each mode introduced today. */
  introduced: ModeNumbers;
  /** First-time cards each mode could still introduce today (studiable, not buried). */
  available: ModeNumbers;
  /** Optional per-mode limits ("Üretim/Boşluk/Dikte günlük yeni kart"); absent/null = none. */
  caps?: Partial<Record<StudyMode, number | null>>;
  /** Today's extra allowance per mode ("+5 yeni kart"), on top of the total and the caps. */
  extra?: ModeNumbers;
}

/**
 * New cards each mode may still introduce today (v0.5.2, ADR 0062). One budget for the day,
 * `total`, shared fairly by the modes that have first-time cards (fairShares, Kelime weighted
 * 2), each at most its own limit. The split is made over the whole day (introduced + still
 * available), so a mode studied first cannot take the others' share; the modes together never
 * pass `total`. Today's extra allowance of a mode comes on top.
 */
export function shareNewBudget(input: NewBudgetInput, order: readonly StudyMode[] = STUDY_MODES): Record<StudyMode, number> {
  const capOf = (m: StudyMode) => {
    const c = input.caps?.[m];
    return typeof c === 'number' && c >= 0 ? Math.floor(c) : Infinity;
  };
  const demand: ModeNumbers = {};
  for (const m of order) demand[m] = Math.min(capOf(m), nonNeg(input.introduced[m]) + nonNeg(input.available[m]));
  const quota = fairShares(input.total, demand, NEW_BUDGET_WEIGHTS, order);
  // Cards a mode introduced beyond its share came from its extra allowance first.
  const usedExtra = zeros();
  for (const m of order)
    usedExtra[m] = Math.min(nonNeg(input.extra?.[m]), Math.max(0, nonNeg(input.introduced[m]) - quota[m]));
  const introducedAll = order.reduce((n, m) => n + nonNeg(input.introduced[m]), 0);
  const usedTotal = introducedAll - order.reduce((n, m) => n + usedExtra[m], 0);
  const allowed = zeros();
  for (const m of order) allowed[m] = Math.min(nonNeg(input.available[m]), Math.max(0, quota[m] - nonNeg(input.introduced[m])));
  fitTotal(allowed, Math.max(0, nonNeg(input.total) - usedTotal), order);
  for (const m of order) {
    const extraLeft = nonNeg(input.extra?.[m]) - usedExtra[m];
    if (extraLeft > 0) allowed[m] = Math.min(nonNeg(input.available[m]), allowed[m] + extraLeft);
  }
  return allowed;
}

/**
 * Catch-up shared over the modes (v0.5.2, ADR 0062): the day's review cap is one budget, split
 * fairly over the modes with due reviews (fairShares over reviews done today + still due), so
 * Üretim and Boşluk get their share instead of waiting days for Kelime's backlog to end.
 * `remaining` = what is left of the cap today; `done` = reviews each mode answered today;
 * `due` = Review-state cards still due today per mode. null cap = no cap (every mode null).
 */
export function shareReviewBudget(
  remaining: number | null,
  done: ModeNumbers,
  due: ModeNumbers,
  order: readonly StudyMode[] = STUDY_MODES,
): Record<StudyMode, number> | null {
  if (remaining === null) return null;
  const doneAll = order.reduce((n, m) => n + nonNeg(done[m]), 0);
  const demand: ModeNumbers = {};
  for (const m of order) demand[m] = nonNeg(done[m]) + nonNeg(due[m]);
  const quota = fairShares(nonNeg(remaining) + doneAll, demand, {}, order);
  const out = zeros();
  for (const m of order) out[m] = Math.min(nonNeg(due[m]), Math.max(0, quota[m] - nonNeg(done[m])));
  // A mode that answered more than its share earlier today still leaves the others theirs.
  return fitTotal(out, nonNeg(remaining), order);
}
