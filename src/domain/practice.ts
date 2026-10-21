// Practice rounds ("Pratik turu"): unscored drills that never touch FSRS. Selection picks
// studied cards from a source; the round shows each card once and brings a missed card back
// once at the end. Results are stored only as practice_logs (data/practice.ts), never as
// review_logs or card changes. Pure: no Dexie, no React.
import { type Card, CardState, type Id, type Millis, type PracticeResult } from './types';

export type { PracticeResult };

export const PRACTICE_SOURCES = ['hard', 'recent', 'tag'] as const;
export type PracticeSource = (typeof PRACTICE_SOURCES)[number];
export const PRACTICE_SIZES = [10, 20] as const;
export type PracticeSize = (typeof PRACTICE_SIZES)[number];

const DAY = 86_400_000;
/** "Zorlandıklarım": a miss (Again or a practice "Bilemedim") within this window counts. */
export const HARD_WINDOW_MS = 14 * DAY;
/** "Son 7 günde öğrendiklerim": the card's first answer is within this window. */
export const RECENT_WINDOW_MS = 7 * DAY;
export const HARD_MIN_LAPSES = 2;
export const HARD_MIN_DIFFICULTY = 7;

export type PracticeCard = Pick<
  Card,
  | 'id'
  | 'note_id'
  | 'state'
  | 'suspended'
  | 'deleted_at'
  | 'unlocked'
  | 'difficulty'
  | 'lapses'
  | 'reps'
>;

/** What the selector needs to know about one candidate card, gathered by the data layer. */
export interface PracticeCandidate {
  card: PracticeCard;
  /** Time of the card's first answer that still counts (not undone); null when none. */
  firstReviewAt: Millis | null;
  /** Latest Again rating that still counts. */
  lastAgainAt: Millis | null;
  /** Latest "Bilemedim" in a practice round. */
  lastPracticeMissAt: Millis | null;
  /** The note's tags. */
  tags: readonly string[];
}

export interface PracticeFilter {
  source: PracticeSource;
  /** Required for source 'tag'. */
  tag?: string | null;
}

/** Studied (has at least one answer), live, unsuspended and unlocked. */
export function isPracticable(c: PracticeCard): boolean {
  return (
    c.deleted_at === null && !c.suspended && c.unlocked && c.state !== CardState.New && c.reps > 0
  );
}

export function isHard(x: PracticeCandidate, now: Millis): boolean {
  const since = now - HARD_WINDOW_MS;
  return (
    x.card.lapses >= HARD_MIN_LAPSES ||
    x.card.difficulty >= HARD_MIN_DIFFICULTY ||
    (x.lastAgainAt !== null && x.lastAgainAt >= since) ||
    (x.lastPracticeMissAt !== null && x.lastPracticeMissAt >= since)
  );
}

export function isRecent(x: PracticeCandidate, now: Millis): boolean {
  return x.firstReviewAt !== null && x.firstReviewAt >= now - RECENT_WINDOW_MS;
}

export function matchesFilter(x: PracticeCandidate, f: PracticeFilter, now: Millis): boolean {
  if (!isPracticable(x.card)) return false;
  switch (f.source) {
    case 'hard':
      return isHard(x, now);
    case 'recent':
      return isRecent(x, now);
    case 'tag':
      return !!f.tag && x.tags.includes(f.tag);
  }
}

/** How hard a card is, for ordering "Zorlandıklarım": recent misses first, then FSRS difficulty. */
function hardness(x: PracticeCandidate, now: Millis): number {
  const since = now - HARD_WINDOW_MS;
  const recentMiss =
    (x.lastAgainAt !== null && x.lastAgainAt >= since) ||
    (x.lastPracticeMissAt !== null && x.lastPracticeMissAt >= since);
  return (recentMiss ? 100 : 0) + x.card.lapses * 2 + x.card.difficulty;
}

/** 32-bit FNV-1a hash of a string (seed for the shuffle). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded PRNG: the same seed always gives the same order. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rand = rng(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The cards of one round, in play order: at most `size` cards, one per note (the hardest
 * card of the note for 'hard', otherwise a random one). 'hard' is ordered by how hard the
 * card is; the other sources are shuffled with `seed` (the round's session id).
 */
export function selectPracticeCards(
  candidates: Iterable<PracticeCandidate>,
  filter: PracticeFilter,
  opts: { now: Millis; size: number; seed: string },
): Id[] {
  const matching = [...candidates].filter((x) => matchesFilter(x, filter, opts.now));
  const byId = (a: PracticeCandidate, b: PracticeCandidate) =>
    a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0;
  const ordered =
    filter.source === 'hard'
      ? matching.sort((a, b) => hardness(b, opts.now) - hardness(a, opts.now) || byId(a, b))
      : seededShuffle(matching.sort(byId), opts.seed);
  const notes = new Set<Id>();
  const out: Id[] = [];
  for (const x of ordered) {
    if (out.length >= opts.size) break;
    if (notes.has(x.card.note_id)) continue;
    notes.add(x.card.note_id);
    out.push(x.card.id);
  }
  return out;
}

/** Cards available per source (one per note), for the counts on "Biraz daha çalış". */
export function countPracticeSources(
  candidates: Iterable<PracticeCandidate>,
  now: Millis,
): { hard: number; recent: number; tags: Map<string, number> } {
  const hard = new Set<Id>();
  const recent = new Set<Id>();
  const tags = new Map<string, Set<Id>>();
  for (const x of candidates) {
    if (!isPracticable(x.card)) continue;
    if (isHard(x, now)) hard.add(x.card.note_id);
    if (isRecent(x, now)) recent.add(x.card.note_id);
    for (const t of x.tags) {
      let set = tags.get(t);
      if (!set) tags.set(t, (set = new Set()));
      set.add(x.card.note_id);
    }
  }
  return {
    hard: hard.size,
    recent: recent.size,
    tags: new Map([...tags].map(([t, s]) => [t, s.size])),
  };
}

// ------------------------------------------------------------------ round

export interface RoundAnswer {
  card_id: Id;
  result: PracticeResult;
  /** True on the second showing of a missed card. */
  repeat: boolean;
}

export interface PracticeRound {
  /** Cards still to show, the current one first. */
  queue: { card_id: Id; repeat: boolean }[];
  answers: RoundAnswer[];
  /** Cards in the round, in their first order. */
  cards: Id[];
}

export function startRound(cardIds: readonly Id[]): PracticeRound {
  return {
    queue: cardIds.map((card_id) => ({ card_id, repeat: false })),
    answers: [],
    cards: [...cardIds],
  };
}

export function currentCard(r: PracticeRound): { card_id: Id; repeat: boolean } | null {
  return r.queue[0] ?? null;
}

/** Answer the current card. A first "Bilemedim" brings the card back once at the end. */
export function answerRound(r: PracticeRound, result: PracticeResult): PracticeRound {
  const cur = r.queue[0];
  if (!cur) return r;
  const queue = r.queue.slice(1);
  if (result === 'unknown' && !cur.repeat) queue.push({ card_id: cur.card_id, repeat: true });
  return {
    ...r,
    queue,
    answers: [...r.answers, { card_id: cur.card_id, result, repeat: cur.repeat }],
  };
}

export function isRoundDone(r: PracticeRound): boolean {
  return r.queue.length === 0;
}

export interface RoundSummary {
  /** Distinct cards shown. */
  cards: number;
  /** Cards known the first time they were shown. */
  knownFirstTry: number;
  /** Missed cards, hardest first (missed twice before missed once), at most `limit`. */
  hardest: Id[];
}

export function summarizeRound(r: PracticeRound, limit = 3): RoundSummary {
  const misses = new Map<Id, number>();
  let knownFirstTry = 0;
  const shown = new Set<Id>();
  for (const a of r.answers) {
    shown.add(a.card_id);
    if (a.result === 'unknown') misses.set(a.card_id, (misses.get(a.card_id) ?? 0) + 1);
    else if (!a.repeat) knownFirstTry++;
  }
  const order = new Map(r.cards.map((id, i) => [id, i]));
  const hardest = [...misses]
    .sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .slice(0, limit)
    .map(([id]) => id);
  return { cards: shown.size, knownFirstTry, hardest };
}
