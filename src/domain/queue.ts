// Session queue. Order: due (re)learning steps → due reviews (oldest due first) → new
// cards, with 1 new card after every 5 reviews. Pure: the data layer passes in cards and
// today's facts, and rebuilds the queue after every answer, which is how learning cards
// that become due during the session re-enter.
//
// Modes ("Biraz daha çalış", docs/decisions/0010-extra-study.md):
//   normal  today's work; the new-card limit is the daily limit plus today's extra allowance.
//   ahead   "Yarının kartlarını şimdi tekrar et": reviews due tomorrow (before `aheadEnd`),
//           no new cards. Today's own reviews stay in the normal queue, under the catch-up cap
//           (v0.5.2: 'ahead' brought the whole capped backlog). Cards answered today and cards
//           still waiting for the ramp's next-day test (ramp step 0) are left out: an early
//           answer there would skip the "ertesi gün" proof (ADR 0041, 0062). Answers are ordinary FSRS reviews (ts-fsrs uses the real elapsed
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
// Interference guard (v0.5 İP10, docs/decisions/0052): with `newOrder` set, both orders (its
// `order` field) introduce at most one card a day from one confusable pair, one Turkish
// meaning or one synonym set; the cards held back come back as `postponed`, which the data
// layer carries to the front of a later day.
//
// Study modes (redesign, plan/ogrenme-modeli.md §4): with `cardTypes` set, the queue holds only
// those card types ("Kelime çalışma" = recognition, "Üretim" = production + image, "Boşluk
// doldurma" = cloze). `newIntroducedToday` is then that mode's own first-time counter, and
// burying changes: a first-time production / cloze / picture card whose recognition sibling
// was answered today waits until tomorrow, and due reviews follow the sibling rule below.
// Without `cardTypes` the queue is the old mixed one.
//
// One card per word per day, hardest first (v0.5.3 B1, docs/decisions/0071): when several
// cards of one note are due, only the hardest format is shown that day (dictation >
// production / picture > cloze > recognition); the easier due Review siblings move to
// tomorrow at queue time, their FSRS state untouched (`siblingHolds`). An easier sibling
// whose harder one was answered Again today is released the same day (relearning aid).
// Every study mode and the mixed session apply it, from the same card set.
import { relativeOverdueness } from './catchup';
import { type NewOrderInput, type NewReason, selectNewCards } from './newOrder';
import { type Card, CardState, type CardType, type Id, type Millis } from './types';

export type QueueCard = Pick<
  Card,
  'id' | 'note_id' | 'card_type' | 'state' | 'due' | 'suspended' | 'deleted_at' | 'unlocked' | 'created_at'
> &
  Partial<Pick<Card, 'scheduled_days' | 'ramp_step' | 'last_review' | 'rest_until'>>;

export const NEW_EVERY_N_REVIEWS = 5;

/**
 * How hard a format is to retrieve (B1): dictation > production / picture > cloze >
 * recognition. The hardest due sibling of a note is the one shown today.
 */
export const FORMAT_RANK: Record<CardType, number> = {
  recognition: 0,
  cloze: 1,
  production: 2,
  image: 2,
  dictation: 3,
};

/** `a` is harder than `b` (rank, then id, so the rule is the same on every device). */
function harder(a: Pick<QueueCard, 'id' | 'card_type'>, b: Pick<QueueCard, 'id' | 'card_type'>): boolean {
  const d = FORMAT_RANK[a.card_type] - FORMAT_RANK[b.card_type];
  return d > 0 || (d === 0 && a.id < b.id);
}

/**
 * Due Review cards held back today because a harder sibling of the same note is shown today
 * (v0.5.3 B1, ADR 0071). Pure and deterministic. A Review card `c` (due today, not answered
 * today) is held when a harder sibling `s`:
 *   - was answered today without an Again (the answer would prime `c`), or
 *   - is itself due today and not answered yet, and `c` fell due today (so `c` moves at most
 *     one day: a card already carried over is not held again by a sibling still waiting).
 * A harder sibling answered Again today never holds `c`: seeing the easier format after a
 * miss is a relearning aid. Learning steps and new cards are never held here (new cards have
 * isBuriedInMode). The card's FSRS state is not changed; it is simply not shown today.
 */
export function siblingHolds(
  cards: Iterable<QueueCard>,
  ctx: Pick<QueueContext, 'now' | 'dayEnd' | 'dayStart' | 'reviewedTodayCardIds' | 'againTodayCardIds'>,
): Set<Id> {
  const byNote = new Map<Id, QueueCard[]>();
  for (const c of cards) {
    if (!isStudiable(c, ctx.now) || c.state === CardState.New) continue;
    const answered = ctx.reviewedTodayCardIds.has(c.id);
    if (!answered && c.due >= ctx.dayEnd) continue;
    const list = byNote.get(c.note_id);
    if (list) list.push(c);
    else byNote.set(c.note_id, [c]);
  }
  const held = new Set<Id>();
  const again = ctx.againTodayCardIds;
  const start = ctx.dayStart ?? -Infinity;
  for (const list of byNote.values()) {
    if (list.length < 2) continue;
    for (const c of list) {
      if (c.state !== CardState.Review || ctx.reviewedTodayCardIds.has(c.id)) continue;
      for (const s of list) {
        if (s === c || !harder(s, c)) continue;
        if (ctx.reviewedTodayCardIds.has(s.id)) {
          if (again?.has(s.id)) continue;
          held.add(c.id);
          break;
        }
        if (s.due < ctx.dayEnd && c.due >= start) {
          held.add(c.id);
          break;
        }
      }
    }
  }
  return held;
}
/**
 * Learn-ahead (ADR 0055): when nothing else is left, a learning card due within this window is
 * shown early. 2 minutes covers the 1-minute step (Again on a new card) but honours the 6 and
 * 10 minute steps: those cards wait, and the session ends with "Sıradaki kart 9 dk sonra".
 * It was 20 minutes, which brought a "10 dk" card back seconds later in a short session.
 */
export const DEFAULT_LEARN_AHEAD_MS = 2 * 60_000;

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
   * instead of making the user wait. Default DEFAULT_LEARN_AHEAD_MS (2 minutes).
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
  /** Inclusive start of the current local day (sibling rule: "first due today"). */
  dayStart?: Millis;
  /** Cards answered Again today (non-undone): their easier siblings are released (B1). */
  againTodayCardIds?: ReadonlySet<Id>;
  /**
   * Due siblings held back today (B1), when the caller computed them once over every card
   * type (data/queries.ts). Absent: computed here from `cards`.
   */
  heldCardIds?: ReadonlySet<Id> | null;
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
  /** Learning steps due later today (after the learn-ahead window): today's work, not yet. */
  learningLater: Id[];
  /** Smart order only: why each new card in the queue came today. */
  newReasons?: Map<Id, NewReason>;
  /** With `newOrder`: new cards the interference guard held back today (to carry). */
  postponed?: Id[];
}

/**
 * Card can be studied at all (ignores due date and burying). With `now`, a card resting after
 * its sixth lapse (rest_until, ADR 0071) is not studiable until the rest ends.
 */
export function isStudiable(c: QueueCard, now?: Millis): boolean {
  if (now !== undefined && c.rest_until != null && now < c.rest_until) return false;
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
  const learningLater: Id[] = [];
  const learningDue: QueueCard[] = [];
  const learningSoon: QueueCard[] = [];
  const reviews: QueueCard[] = [];
  const fresh: QueueCard[] = [];
  let nextLearningDue: Millis | null = null;

  const types = ctx.cardTypes ? new Set<CardType>(ctx.cardTypes) : null;
  const all = Array.isArray(cards) ? (cards as QueueCard[]) : [...cards];
  // B1: one card per note per day, the hardest format first (not in 'ahead' mode, which keeps
  // the old note-level burying of the mixed queue).
  const held = ahead ? null : (ctx.heldCardIds ?? siblingHolds(all, ctx));
  const buried = (c: QueueCard) =>
    (types ? isBuriedInMode(c, ctx) : isBuried(c, ctx)) || !!held?.has(c.id);
  for (const c of all) {
    if (types && !types.has(c.card_type)) continue;
    if (!isStudiable(c, ctx.now) || buried(c)) continue;
    if (isLearning(c)) {
      if (c.due <= ctx.now) learningDue.push(c);
      else if (c.due <= ctx.now + learnAhead) learningSoon.push(c);
      else if (c.due < ctx.dayEnd) {
        learningLater.push(c.id);
        if (nextLearningDue === null || c.due < nextLearningDue) nextLearningDue = c.due;
      }
    } else if (c.state === CardState.Review) {
      if (ahead) {
        if (c.due >= ctx.dayEnd && c.due < reviewEnd && aheadAllowed(c, ctx)) reviews.push(c);
      } else if (c.due < reviewEnd) reviews.push(c);
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
  let postponed: Id[] | undefined;
  if (ctx.newOrder && !ahead) {
    const blocked = (c: QueueCard) => notesInQueue.has(c.note_id) && !ctx.reviewedTodayCardIds.has(c.id);
    const sel = selectNewCards(fresh, newAllowed, blocked, ctx.newOrder);
    nw = sel.cards;
    if (ctx.newOrder.order !== 'added') newReasons = sel.reasons;
    postponed = sel.postponed;
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
    learningLater,
    ...(newReasons ? { newReasons } : {}),
    ...(postponed ? { postponed } : {}),
  };
}

/** A card at ramp step 0 answered this recently is still waiting for its next-day test. */
const NEXT_DAY_TEST_MS = 2 * 86_400_000;

/**
 * "Yarının kartları" may take this card now: not answered today, and not waiting for the
 * ramp's next-day test (ramp step 0, last answered within two days: learnt minutes ago or
 * yesterday). An early answer would skip the "ertesi gün" proof (ADR 0041, 0062).
 */
export function aheadAllowed(c: QueueCard, ctx: Pick<QueueContext, 'reviewedTodayCardIds' | 'now'>): boolean {
  if (ctx.reviewedTodayCardIds.has(c.id)) return false;
  const fresh = (c.ramp_step ?? 0) === 0 && c.last_review != null && ctx.now - c.last_review < NEXT_DAY_TEST_MS;
  return !fresh;
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
  ctx: Pick<QueueContext, 'dayEnd' | 'reviewedTodayCardIds' | 'reviewedTodayNoteIds'> & { now?: Millis },
): boolean {
  for (const c of cards) {
    if (!isStudiable(c, ctx.now) || c.state === CardState.New || isBuried(c, ctx)) continue;
    if (c.due < ctx.dayEnd) return false;
  }
  return true;
}
