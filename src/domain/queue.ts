// Session queue. Order: due (re)learning steps → due reviews (oldest due first) → new
// cards, with 1 new card after every 5 reviews. Pure: the data layer passes in cards and
// today's facts, and rebuilds the queue after every answer, which is how learning cards
// that become due during the session re-enter.
import { type Card, CardState, type Id, type Millis } from './types';

export type QueueCard = Pick<
  Card,
  'id' | 'note_id' | 'card_type' | 'state' | 'due' | 'suspended' | 'deleted_at' | 'unlocked' | 'created_at'
>;

export const NEW_EVERY_N_REVIEWS = 5;
export const DEFAULT_LEARN_AHEAD_MS = 20 * 60_000;

export interface QueueContext {
  now: Millis;
  /** Exclusive end of the current local day; reviews due before it are due today. */
  dayEnd: Millis;
  dailyNewLimit: number;
  /** Cards whose first (non-undone) answer falls on the current local day. */
  newIntroducedToday: number;
  /** Cards answered today (non-undone logs) and their notes, for sibling burying. */
  reviewedTodayCardIds: ReadonlySet<Id>;
  reviewedTodayNoteIds: ReadonlySet<Id>;
  /** Answers already given in this session, to keep the 5:1 rhythm across rebuilds. */
  session?: { reviews: number; new: number };
  /**
   * When nothing else is left, learning cards due within this window are shown early
   * instead of making the user wait. Default 20 minutes.
   */
  learnAheadMs?: number;
}

export type QueueKind = 'learning' | 'review' | 'new';

export interface QueueItem {
  card_id: Id;
  note_id: Id;
  kind: QueueKind;
}

export interface QueueCounts {
  learning: number;
  review: number;
  new: number;
  total: number;
  /** New cards the daily limit still allows (before burying). */
  new_allowed: number;
}

export interface QueueResult {
  items: QueueItem[];
  counts: QueueCounts;
  /** Earliest later-today learning step not in the queue (for "1 kart 25 dk sonra"). */
  nextLearningDue: Millis | null;
}

/** Card can be studied at all (ignores due date and burying). */
export function isStudiable(c: QueueCard): boolean {
  return c.deleted_at === null && !c.suspended && c.unlocked;
}

function isLearning(c: QueueCard): boolean {
  return c.state === CardState.Learning || c.state === CardState.Relearning;
}

/** A sibling of this card was answered today and this card was not: hidden until tomorrow. */
export function isBuried(c: QueueCard, ctx: Pick<QueueContext, 'reviewedTodayCardIds' | 'reviewedTodayNoteIds'>): boolean {
  return ctx.reviewedTodayNoteIds.has(c.note_id) && !ctx.reviewedTodayCardIds.has(c.id);
}

const byDue = (a: QueueCard, b: QueueCard): number => a.due - b.due || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byCreated = (a: QueueCard, b: QueueCard): number =>
  a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildQueue(cards: Iterable<QueueCard>, ctx: QueueContext): QueueResult {
  const learnAhead = ctx.learnAheadMs ?? DEFAULT_LEARN_AHEAD_MS;
  const learningDue: QueueCard[] = [];
  const learningSoon: QueueCard[] = [];
  const reviews: QueueCard[] = [];
  const fresh: QueueCard[] = [];
  let nextLearningDue: Millis | null = null;

  for (const c of cards) {
    if (!isStudiable(c) || isBuried(c, ctx)) continue;
    if (isLearning(c)) {
      if (c.due <= ctx.now) learningDue.push(c);
      else if (c.due <= ctx.now + learnAhead) learningSoon.push(c);
      else if (c.due < ctx.dayEnd && (nextLearningDue === null || c.due < nextLearningDue)) nextLearningDue = c.due;
    } else if (c.state === CardState.Review) {
      if (c.due < ctx.dayEnd) reviews.push(c);
    } else if (c.state === CardState.New) {
      fresh.push(c);
    }
  }
  learningDue.sort(byDue);
  learningSoon.sort(byDue);
  reviews.sort(byDue);
  fresh.sort(byCreated);

  // One card per note per day. Cards already answered today (learning steps) always pass.
  const notesInQueue = new Set<Id>();
  const take = (list: QueueCard[], limit = Infinity): QueueCard[] => {
    const out: QueueCard[] = [];
    for (const c of list) {
      if (out.length >= limit) break;
      if (notesInQueue.has(c.note_id) && !ctx.reviewedTodayCardIds.has(c.id)) continue;
      notesInQueue.add(c.note_id);
      out.push(c);
    }
    return out;
  };
  const newAllowed = Math.max(0, ctx.dailyNewLimit - ctx.newIntroducedToday);
  const learnNow = take(learningDue);
  const rev = take(reviews);
  const nw = take(fresh, newAllowed);
  const soon = take(learningSoon);

  const items: QueueItem[] = learnNow.map((c) => item(c, 'learning'));
  const session = ctx.session ?? { reviews: 0, new: 0 };
  let gap = Math.max(0, (session.new + 1) * NEW_EVERY_N_REVIEWS - session.reviews);
  let r = 0;
  let n = 0;
  while (r < rev.length || n < nw.length) {
    if (n < nw.length && (gap <= 0 || r >= rev.length)) {
      items.push(item(nw[n++]!, 'new'));
      gap = NEW_EVERY_N_REVIEWS;
    } else {
      items.push(item(rev[r++]!, 'review'));
      gap--;
    }
  }
  for (const c of soon) items.push(item(c, 'learning'));

  return {
    items,
    counts: {
      learning: learnNow.length + soon.length,
      review: rev.length,
      new: nw.length,
      total: items.length,
      new_allowed: newAllowed,
    },
    nextLearningDue,
  };
}

function item(c: QueueCard, kind: QueueKind): QueueItem {
  return { card_id: c.id, note_id: c.note_id, kind };
}

/**
 * True when no studied card is left due before the end of the day (new cards do not
 * count; buried siblings are excused). Shares the rules of buildQueue.
 */
export function isDayComplete(
  cards: Iterable<QueueCard>,
  ctx: Pick<QueueContext, 'dayEnd' | 'reviewedTodayCardIds' | 'reviewedTodayNoteIds'>,
): boolean {
  for (const c of cards) {
    if (!isStudiable(c) || c.state === CardState.New || isBuried(c, ctx)) continue;
    if (c.due < ctx.dayEnd) return false;
  }
  return true;
}
