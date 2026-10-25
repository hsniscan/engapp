// Session queue. Order: due (re)learning steps → due reviews (oldest due first) → new
// cards, with 1 new card after every 5 reviews. Pure: the data layer passes in cards and
// today's facts, and rebuilds the queue after every answer, which is how learning cards
// that become due during the session re-enter.
//
// Modes ("Biraz daha çalış", docs/decisions/0010-extra-study.md):
//   normal  today's work; the new-card limit is the daily limit plus today's extra allowance.
//   ahead   "Yarının kartlarını şimdi tekrar et": reviews due before the end of tomorrow,
//           no new cards. Answers are ordinary FSRS reviews (ts-fsrs uses the real elapsed
//           time, so an early answer gets a shorter interval than an on-time one).
// Practice rounds never use this queue (domain/practice.ts).
//
// Catch-up (v0.3 İP3, domain/catchup.ts): with `reviewCap` set, at most that many reviews are
// taken, the most overdue relative to their interval first. The cap never changes a card.
//
// New-card order (v0.4, docs/decisions/0039): with `newOrder` set, today's new cards are chosen
// by domain/newOrder.ts (level fit, frequency, the user's own signals, no confusable pair on
// one day, a per-user daily jitter); without it, by insertion order ("Eklenme sırası"). The
// limit, the 1-per-note rule and the 5:1 rhythm are the same either way.
//
// Study modes (redesign, plan/ogrenme-modeli.md §4): with `cardTypes` set, the queue holds only
// those card types ("Kelime çalışma" = recognition, "Üretim" = production + image, "Boşluk
// doldurma" = cloze). `newIntroducedToday` is then that mode's own first-time counter, and
// burying changes: due cards are never buried, and only a first-time production / cloze /
// picture card whose recognition sibling was answered today waits until tomorrow. Without
// `cardTypes` the queue is the old mixed one.
import { relativeOverdueness } from './catchup';
import { type NewOrderInput, type NewReason, selectNewCards } from './newOrder';
import { type Card, CardState, type CardType, type Id, type Millis } from './types';

export type QueueCard = Pick<
  Card,
  'id' | 'note_id' | 'card_type' | 'state' | 'due' | 'suspended' | 'deleted_at' | 'unlocked' | 'created_at'
> &
  Partial<Pick<Card, 'scheduled_days'>>;

export const NEW_EVERY_N_REVIEWS = 5;
export const DEFAULT_LEARN_AHEAD_MS = 20 * 60_000;

export type QueueMode = 'normal' | 'ahead';

export interface QueueContext {
  now: Millis;
  /** Exclusive end of the current local day; reviews due before it are due today. */
  dayEnd: Millis;
  dailyNewLimit: number;
  /** Extra new cards allowed today on top of dailyNewLimit ("+5 yeni kart"). Default 0. */
  extraNewToday?: number;
  /** Default 'normal'. */
  mode?: QueueMode;
  /** 'ahead' mode: exclusive end of tomorrow's local day. Reviews due before it are shown. */
  aheadEnd?: Millis;
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
  /**
   * Catch-up: most reviews (Review-state cards) this queue may hold, ordered by relative
   * overdueness instead of due date. Absent/null = no cap. Ignored in 'ahead' mode.
   */
  reviewCap?: number | null;
  /** Smart new-card order (domain/newOrder.ts); absent/null = insertion order. */
  newOrder?: NewOrderInput | null;
  /** Study mode: only these card types (see the header). Absent = every type, old burying. */
  cardTypes?: readonly CardType[] | null;
  /** Study mode: notes whose recognition card was answered today (non-undone). */
  recognitionReviewedTodayNoteIds?: ReadonlySet<Id>;
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
  /** Smart order only: why each new card in the queue came today. */
  newReasons?: Map<Id, NewReason>;
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

/**
 * Study-mode burying: a first-time production / cloze / picture card waits a day after its
 * recognition sibling was answered (no same-day hint). Due cards are never buried.
 */
export function isBuriedInMode(
  c: QueueCard,
  ctx: Pick<QueueContext, 'recognitionReviewedTodayNoteIds'>,
): boolean {
  return (
    c.state === CardState.New &&
    c.card_type !== 'recognition' &&
    !!ctx.recognitionReviewedTodayNoteIds?.has(c.note_id)
  );
}

const byDue = (a: QueueCard, b: QueueCard): number => a.due - b.due || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byCreated = (a: QueueCard, b: QueueCard): number =>
  a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildQueue(cards: Iterable<QueueCard>, ctx: QueueContext): QueueResult {
  const learnAhead = ctx.learnAheadMs ?? DEFAULT_LEARN_AHEAD_MS;
  const ahead = ctx.mode === 'ahead';
  const reviewEnd = ahead ? Math.max(ctx.dayEnd, ctx.aheadEnd ?? ctx.dayEnd) : ctx.dayEnd;
  const learningDue: QueueCard[] = [];
  const learningSoon: QueueCard[] = [];
  const reviews: QueueCard[] = [];
  const fresh: QueueCard[] = [];
  let nextLearningDue: Millis | null = null;

  const types = ctx.cardTypes ? new Set<CardType>(ctx.cardTypes) : null;
  const buried = (c: QueueCard) => (types ? isBuriedInMode(c, ctx) : isBuried(c, ctx));
  for (const c of cards) {
    if (types && !types.has(c.card_type)) continue;
    if (!isStudiable(c) || buried(c)) continue;
    if (isLearning(c)) {
      if (c.due <= ctx.now) learningDue.push(c);
      else if (c.due <= ctx.now + learnAhead) learningSoon.push(c);
      else if (c.due < ctx.dayEnd && (nextLearningDue === null || c.due < nextLearningDue)) nextLearningDue = c.due;
    } else if (c.state === CardState.Review) {
      if (c.due < reviewEnd) reviews.push(c);
    } else if (c.state === CardState.New) {
      fresh.push(c);
    }
  }
  learningDue.sort(byDue);
  learningSoon.sort(byDue);
  const capped = !ahead && ctx.reviewCap !== undefined && ctx.reviewCap !== null;
  if (capped) {
    const od = new Map(reviews.map((c) => [c.id, relativeOverdueness(c, ctx.now)]));
    reviews.sort((a, b) => od.get(b.id)! - od.get(a.id)! || byDue(a, b));
  } else reviews.sort(byDue);
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
  const newAllowed = ahead ? 0 : newCardsAllowed(ctx);
  const learnNow = take(learningDue);
  const rev = take(reviews, capped ? Math.max(0, ctx.reviewCap!) : Infinity);
  let nw: QueueCard[];
  let newReasons: Map<Id, NewReason> | undefined;
  if (ctx.newOrder && !ahead) {
    const blocked = (c: QueueCard) => notesInQueue.has(c.note_id) && !ctx.reviewedTodayCardIds.has(c.id);
    const sel = selectNewCards(fresh, newAllowed, blocked, ctx.newOrder);
    nw = sel.cards;
    newReasons = sel.reasons;
    for (const c of nw) notesInQueue.add(c.note_id);
  } else nw = take(fresh, newAllowed);
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
    ...(newReasons ? { newReasons } : {}),
  };
}

/** New cards today's limit still allows: daily limit + today's extra allowance − introduced today. */
export function newCardsAllowed(
  ctx: Pick<QueueContext, 'dailyNewLimit' | 'extraNewToday' | 'newIntroducedToday'>,
): number {
  return Math.max(0, ctx.dailyNewLimit + Math.max(0, ctx.extraNewToday ?? 0) - ctx.newIntroducedToday);
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
