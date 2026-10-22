// Progress tracking ("Gelişim", v0.3 İP5): retention by category, the recognition–production
// gap and the 12-week series. Pure: no Dexie, no React. The weekly report (İP7) calls the same
// functions, so the rule below is the one fixed rule behind "en zayıf kategori".
//
// The rule (docs/decisions/0023-progress-retention.md):
//   - Only answers that still count (undo rows and the answers they cancel are dropped).
//     Practice rounds write practice_logs, never review_logs, so they never count.
//   - Per card and local day only the first answer counts, and only when the card was in
//     state Review right before it ("Tekrarda": a real memory test, not a learning step).
//   - Retention = share of those answers that were not "Tekrar" (Again).
//   - A rate is shown only with at least MIN_ANSWERS answers; the Wilson 95 % interval goes
//     with it.
// The card's state before each answer comes from replaying the learning-step state machine of
// ts-fsrs (nextStudyState). It depends on the ratings only, never on stability or dates, so it
// matches a full FSRS replay (tested) at a fraction of the cost.
import { addDays, type DayConfig, type DayKey, tzOffsetMs, weekdayMon0 } from './day';
import { FSRS_CONFIG } from './fsrs';
import { compareLogs, effectiveLogs } from './recompute';
import {
  type CardStateValue,
  CardState,
  type CardType,
  type CefrLevel,
  type Id,
  type Millis,
  type NoteTermType,
  Rating,
  type RatingValue,
  type ReviewLog,
} from './types';

/** A category's rate is shown (and can be the weakest) only with this many answers. */
export const MIN_ANSWERS = 20;
/** A note's own recognition/production rates need this many answers on each side. */
export const MIN_NOTE_SIDE_ANSWERS = 3;
/** Notes in the "biggest gaps" practice list (a practice round holds at most 20 cards). */
export const GAP_LIST_SIZE = 20;
/** The category view looks at this many days back from today. */
export const PROGRESS_WINDOW_DAYS = 90;
/** Weeks in the series. */
export const SERIES_WEEKS = 12;
/** Key of the group of cards without a value (no topic, no source, no level, no pos). */
export const NONE_KEY = 'none';

const DAY_MS = 86_400_000;

// ------------------------------------------------------------------ state machine

export interface StudyState {
  state: CardStateValue;
  /** Index of the current (re)learning step. */
  step: number;
}

export const NEW_STUDY_STATE: StudyState = { state: CardState.New, step: 0 };

/**
 * The state after one answer, as ts-fsrs's BasicScheduler (short-term on) moves it with our
 * learning steps (FSRS_CONFIG): Easy always graduates; Good moves one step on and graduates
 * after the last; Hard stays; Again goes back to the first step. A Review card goes to
 * Relearning on Again (when there are relearning steps) and stays in Review otherwise.
 * Every step is shorter than a day, so no step graduates by length.
 */
export function nextStudyState(
  cur: StudyState,
  rating: RatingValue,
  learningSteps: number = FSRS_CONFIG.learning_steps.length,
  relearningSteps: number = FSRS_CONFIG.relearning_steps.length,
): StudyState {
  const review: StudyState = { state: CardState.Review, step: 0 };
  if (cur.state === CardState.Review) {
    if (rating !== Rating.Again || relearningSteps === 0) return review;
    return { state: CardState.Relearning, step: 0 };
  }
  const steps = cur.state === CardState.Relearning ? relearningSteps : learningSteps;
  const to = cur.state === CardState.Relearning ? CardState.Relearning : CardState.Learning;
  if (steps === 0 || cur.step >= steps) return review;
  switch (rating) {
    case Rating.Again:
      return { state: to, step: 0 };
    case Rating.Hard:
      return { state: to, step: cur.step };
    case Rating.Good:
      return cur.step + 1 < steps ? { state: to, step: cur.step + 1 } : review;
    default:
      return review;
  }
}

// ------------------------------------------------------------------ answers

/** One counted answer: the first answer of a local day to a card in state Review. */
export interface RetentionEvent {
  card_id: Id;
  at: Millis;
  day: DayKey;
  passed: boolean;
}

/** When a card first reached Review ("öğrenildi"). */
export interface ReachedReview {
  at: Millis;
  day: DayKey;
}

export interface RetentionData {
  events: RetentionEvent[];
  reachedReview: Map<Id, ReachedReview>;
}

/**
 * dayKeyOf for many instants. The zone offset is looked up once per UTC day (and per quarter
 * hour on a day whose offset changes: offsets and DST switches fall on quarter hours), then
 * the local day is plain arithmetic. Same result as dayKeyOf (tested), ~100× faster.
 */
export function makeDayOf(cfg: DayConfig): (ms: Millis) => DayKey {
  const startMs = cfg.day_start_hour * 3_600_000;
  const offsetByDay = new Map<number, number | null>();
  const offsetByQuarter = new Map<number, number>();
  const keys = new Map<number, DayKey>();
  const offsetAt = (ms: Millis): number => {
    const d = Math.floor(ms / DAY_MS);
    let o = offsetByDay.get(d);
    if (o === undefined) {
      const a = tzOffsetMs(d * DAY_MS, cfg.timezone);
      const b = tzOffsetMs(d * DAY_MS + DAY_MS - 1000, cfg.timezone);
      o = a === b ? a : null;
      offsetByDay.set(d, o);
    }
    if (o !== null) return o;
    const q = Math.floor(ms / 900_000);
    let qo = offsetByQuarter.get(q);
    if (qo === undefined) {
      qo = tzOffsetMs(q * 900_000, cfg.timezone);
      offsetByQuarter.set(q, qo);
    }
    return qo;
  };
  return (ms) => {
    const n = Math.floor((ms + offsetAt(ms) - startMs) / DAY_MS);
    let key = keys.get(n);
    if (key === undefined) {
      key = new Date(n * DAY_MS).toISOString().slice(0, 10);
      keys.set(n, key);
    }
    return key;
  };
}

/** effectiveLogs, without its copying and sorting when no row is an undo and the order is right. */
function countedLogs(logs: readonly ReviewLog[]): readonly ReviewLog[] {
  for (let i = 0; i < logs.length; i++) {
    if (logs[i]!.undo_of !== null || (i > 0 && compareLogs(logs[i - 1]!, logs[i]!) >= 0))
      return effectiveLogs(logs);
  }
  return logs;
}

/** Counted answers and the first Review time of one card (logs of that card, any order). */
export function scanCard(
  logs: readonly ReviewLog[],
  dayOf: (ms: Millis) => DayKey,
): { events: RetentionEvent[]; reachedReview: ReachedReview | null } {
  const events: RetentionEvent[] = [];
  let reached: ReachedReview | null = null;
  let cur = NEW_STUDY_STATE;
  let lastDay: DayKey | null = null;
  for (const log of countedLogs(logs)) {
    const day = dayOf(log.reviewed_at);
    if (day !== lastDay && cur.state === CardState.Review) {
      events.push({
        card_id: log.card_id,
        at: log.reviewed_at,
        day,
        passed: log.rating !== Rating.Again,
      });
    }
    lastDay = day;
    cur = nextStudyState(cur, log.rating);
    if (!reached && cur.state === CardState.Review) reached = { at: log.reviewed_at, day };
  }
  return { events, reachedReview: reached };
}

/** Counted answers of every card. `logsByCard`: all logs (undo rows included) per card. */
export function collectRetention(
  logsByCard: Iterable<readonly ReviewLog[]>,
  dayOf: (ms: Millis) => DayKey,
): RetentionData {
  const events: RetentionEvent[] = [];
  const reachedReview = new Map<Id, ReachedReview>();
  for (const logs of logsByCard) {
    if (logs.length === 0) continue;
    const r = scanCard(logs, dayOf);
    for (const e of r.events) events.push(e);
    if (r.reachedReview) reachedReview.set(logs[0]!.card_id, r.reachedReview);
  }
  return { events, reachedReview };
}

// ------------------------------------------------------------------ rates

export interface Interval {
  low: number;
  high: number;
}

/** Wilson score interval (95 % by default) of `passed` successes in `n` trials. */
export function wilson(passed: number, n: number, z = 1.96): Interval | null {
  if (n <= 0) return null;
  const p = passed / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface RetentionStat {
  /** Counted answers. */
  n: number;
  /** Of those, answers other than Again. */
  passed: number;
  /** passed / n; null without answers. Show it only when `enough`. */
  rate: number | null;
  /** n ≥ MIN_ANSWERS. */
  enough: boolean;
  /** Wilson 95 % interval; null without answers. */
  ci: Interval | null;
}

export function retentionStat(passed: number, n: number, min = MIN_ANSWERS): RetentionStat {
  return { n, passed, rate: n > 0 ? passed / n : null, enough: n >= min, ci: wilson(passed, n) };
}

// ------------------------------------------------------------------ groups

export const RETENTION_DIMENSIONS = [
  'term_type',
  'level',
  'topic',
  'source',
  'pos',
  'card_type',
] as const;
export type RetentionDimension = (typeof RETENTION_DIMENSIONS)[number];

/** What the grouping needs to know about one live card (gathered by the data layer). */
export interface RetentionCardFacts {
  note_id: Id;
  card_type: CardType;
  term_type: NoteTermType;
  /** The note's level as the app shows it; null = unknown. */
  level: CefrLevel | null;
  /** Topic keys of the texts the card's sense(s) came from. */
  topics: readonly string[];
  /** Source ids of the card's sense(s). */
  sources: readonly Id[];
  /** Parts of speech of the card's sense(s), lower case. */
  pos: readonly string[];
  /** The card's own sense (production, cloze, picture cards); absent or null for recognition. */
  sense_id?: Id | null;
}

export interface GroupRetention extends RetentionStat {
  dimension: RetentionDimension;
  /** Group key: a term type, a level, a topic key, a source id, a pos, a card type or NONE_KEY. */
  key: string;
}

export interface WindowOptions {
  /** Count answers at or after this instant. */
  from?: Millis;
  /** Count answers before this instant. */
  to?: Millis;
}

const NATURAL_ORDER: Partial<Record<RetentionDimension, readonly string[]>> = {
  term_type: ['word', 'phrase', 'pattern', 'affix', 'contrast'],
  level: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
  card_type: ['recognition', 'production', 'cloze', 'image'],
};

/** The groups one card belongs to (several for topics, sources and pos; NONE_KEY when none). */
export function groupKeys(facts: RetentionCardFacts, dimension: RetentionDimension): string[] {
  let keys: readonly string[];
  switch (dimension) {
    case 'term_type':
      return [facts.term_type];
    case 'card_type':
      return [facts.card_type];
    case 'level':
      return [facts.level ?? NONE_KEY];
    case 'topic':
      keys = facts.topics;
      break;
    case 'source':
      keys = facts.sources;
      break;
    case 'pos':
      keys = facts.pos;
      break;
  }
  if (keys.length === 0) return [NONE_KEY];
  return keys.length === 1 ? [keys[0]!] : [...new Set(keys)];
}

function inWindow(e: RetentionEvent, w: WindowOptions): boolean {
  return (w.from === undefined || e.at >= w.from) && (w.to === undefined || e.at < w.to);
}

/** Display order: natural order for term type, level and card type; else most answers first. */
function compareForDisplay(dimension: RetentionDimension) {
  const order = NATURAL_ORDER[dimension];
  return (a: GroupRetention, b: GroupRetention): number => {
    if ((a.key === NONE_KEY) !== (b.key === NONE_KEY)) return a.key === NONE_KEY ? 1 : -1;
    if (order) {
      const d = order.indexOf(a.key) - order.indexOf(b.key);
      if (d !== 0) return d;
    }
    return b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  };
}

/**
 * Retention per group of one dimension. An answer counts once in every group its card belongs
 * to (a card from two texts counts for both). Answers of cards without facts (deleted) are
 * left out. Groups without answers are not returned.
 */
export function retentionByGroup(
  data: Pick<RetentionData, 'events'>,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
  dimension: RetentionDimension,
  window: WindowOptions = {},
): GroupRetention[] {
  return groupTallies(tallyCards(data, facts, window), facts, dimension);
}

interface Tally {
  n: number;
  passed: number;
}

/** Counted answers per live card within the window. */
function tallyCards(
  data: Pick<RetentionData, 'events'>,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
  window: WindowOptions,
): Map<Id, Tally> {
  const out = new Map<Id, Tally>();
  for (const e of data.events) {
    if (!inWindow(e, window)) continue;
    let c = out.get(e.card_id);
    if (!c) {
      if (!facts.has(e.card_id)) continue;
      out.set(e.card_id, (c = { n: 0, passed: 0 }));
    }
    c.n++;
    if (e.passed) c.passed++;
  }
  return out;
}

function groupTallies(
  tallies: ReadonlyMap<Id, Tally>,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
  dimension: RetentionDimension,
): GroupRetention[] {
  const counts = new Map<string, Tally>();
  for (const [cardId, t] of tallies) {
    for (const key of groupKeys(facts.get(cardId)!, dimension)) {
      let c = counts.get(key);
      if (!c) counts.set(key, (c = { n: 0, passed: 0 }));
      c.n += t.n;
      c.passed += t.passed;
    }
  }
  return [...counts]
    .map(([key, c]) => ({ dimension, key, ...retentionStat(c.passed, c.n) }))
    .sort(compareForDisplay(dimension));
}

/** Every dimension at once, in RETENTION_DIMENSIONS order. */
export function retentionByAllGroups(
  data: Pick<RetentionData, 'events'>,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
  window: WindowOptions = {},
  dimensions: readonly RetentionDimension[] = RETENTION_DIMENSIONS,
): Record<RetentionDimension, GroupRetention[]> {
  const out = {} as Record<RetentionDimension, GroupRetention[]>;
  for (const d of RETENTION_DIMENSIONS) out[d] = [];
  const tallies = tallyCards(data, facts, window);
  for (const d of dimensions) out[d] = groupTallies(tallies, facts, d);
  return out;
}

/** Retention over every counted answer of live cards. */
export function overallRetention(
  data: Pick<RetentionData, 'events'>,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
  window: WindowOptions = {},
): RetentionStat {
  let n = 0;
  let passed = 0;
  for (const e of data.events) {
    if (!inWindow(e, window) || !facts.has(e.card_id)) continue;
    n++;
    if (e.passed) passed++;
  }
  return retentionStat(passed, n);
}

/** a.rate − b.rate as an exact sign (cross-multiplied counts, no float ties). */
function compareRates(a: RetentionStat, b: RetentionStat): number {
  return a.passed * b.n - b.passed * a.n;
}

function rankGroups(groups: Iterable<GroupRetention>, dir: 1 | -1): GroupRetention | null {
  const eligible = [...groups].filter((g) => g.enough && g.key !== NONE_KEY);
  eligible.sort(
    (a, b) =>
      dir * compareRates(a, b) ||
      b.n - a.n ||
      RETENTION_DIMENSIONS.indexOf(a.dimension) - RETENTION_DIMENSIONS.indexOf(b.dimension) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  return eligible[0] ?? null;
}

/**
 * The weakest group: the lowest retention among groups with enough answers (n ≥ MIN_ANSWERS),
 * leaving out the "none" groups (no topic, no level…: nothing to act on). Ties: more answers
 * first (better evidence), then dimension order (RETENTION_DIMENSIONS), then key. Null when no
 * group has enough answers. Pass groups of one dimension or of several.
 */
export function weakestGroup(groups: Iterable<GroupRetention>): GroupRetention | null {
  return rankGroups(groups, 1);
}

/** The strongest group, by the same rule as weakestGroup (highest retention). */
export function strongestGroup(groups: Iterable<GroupRetention>): GroupRetention | null {
  return rankGroups(groups, -1);
}

// ------------------------------------------------------------------ recognition vs production

export interface NoteGap {
  note_id: Id;
  recognition: RetentionStat;
  production: RetentionStat;
  /** recognition.rate − production.rate. */
  gap: number;
}

export interface RecognitionProductionGap {
  /** "İngilizceden Türkçeye": recognition cards. */
  recognition: RetentionStat;
  /** "Türkçeden İngilizceye": production cards. */
  production: RetentionStat;
  /** recognition − production when both have enough answers; else null. */
  gap: number | null;
  /**
   * Notes that are remembered better from English than into English, largest gap first
   * (ties: more production answers, then note id). Each side needs MIN_NOTE_SIDE_ANSWERS.
   */
  notes: NoteGap[];
}

/** Recognition vs production retention, overall and per note (cloze cards are left out). */
export function recognitionProductionGap(
  data: Pick<RetentionData, 'events'>,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
  window: WindowOptions = {},
): RecognitionProductionGap {
  const total = { recognition: { n: 0, p: 0 }, production: { n: 0, p: 0 } };
  const perNote = new Map<Id, typeof total>();
  for (const [cardId, t] of tallyCards(data, facts, window)) {
    const f = facts.get(cardId)!;
    if (f.card_type !== 'recognition' && f.card_type !== 'production') continue;
    let note = perNote.get(f.note_id);
    if (!note)
      perNote.set(f.note_id, (note = { recognition: { n: 0, p: 0 }, production: { n: 0, p: 0 } }));
    for (const c of [total[f.card_type], note[f.card_type]]) {
      c.n += t.n;
      c.p += t.passed;
    }
  }
  const recognition = retentionStat(total.recognition.p, total.recognition.n);
  const production = retentionStat(total.production.p, total.production.n);
  const notes: NoteGap[] = [];
  for (const [note_id, c] of perNote) {
    if (c.recognition.n < MIN_NOTE_SIDE_ANSWERS || c.production.n < MIN_NOTE_SIDE_ANSWERS) continue;
    const r = retentionStat(c.recognition.p, c.recognition.n, MIN_NOTE_SIDE_ANSWERS);
    const p = retentionStat(c.production.p, c.production.n, MIN_NOTE_SIDE_ANSWERS);
    if (compareRates(r, p) <= 0) continue;
    notes.push({ note_id, recognition: r, production: p, gap: r.rate! - p.rate! });
  }
  notes.sort(
    (a, b) =>
      compareGaps(b, a) ||
      b.production.n - a.production.n ||
      (a.note_id < b.note_id ? -1 : a.note_id > b.note_id ? 1 : 0),
  );
  const gap = recognition.enough && production.enough ? recognition.rate! - production.rate! : null;
  return { recognition, production, gap, notes };
}

/** a.gap − b.gap as an exact sign. */
function compareGaps(a: NoteGap, b: NoteGap): number {
  // gap = rp/rn − pp/pn = (rp·pn − pp·rn) / (rn·pn)
  const num = (g: NoteGap) =>
    g.recognition.passed * g.production.n - g.production.passed * g.recognition.n;
  const den = (g: NoteGap) => g.recognition.n * g.production.n;
  return num(a) * den(b) - num(b) * den(a);
}

/** Note ids for the "biggest gaps" practice round. */
export function biggestGapNoteIds(gap: RecognitionProductionGap, limit = GAP_LIST_SIZE): Id[] {
  return gap.notes.slice(0, limit).map((n) => n.note_id);
}

// ------------------------------------------------------------------ with vs. without picture cards

export interface PictureRecall {
  /** Live picture cards (v0.4 İP8). */
  pictureCards: number;
  /** "Türkçeden İngilizceye" answers of senses that have a picture card. */
  withPicture: RetentionStat;
  /** The same answers of senses without one. */
  withoutPicture: RetentionStat;
  /** The picture cards' own answers. */
  pictureAnswers: RetentionStat;
  /** withPicture − withoutPicture when both have enough answers (MIN_ANSWERS); else null. */
  diff: number | null;
}

/**
 * Does a picture card help? Recall of the English word (production cards: the Turkish meaning
 * shown, the word asked) for senses that have a live picture card against senses that do not,
 * by the same counting rule as everything else here. Production cards are the fair comparison:
 * both groups have one, and they ask the same thing the picture card asks. An observation, not
 * an experiment: senses with pictures are the concrete ones.
 */
export function pictureRecallComparison(
  data: Pick<RetentionData, 'events'>,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
  window: WindowOptions = {},
): PictureRecall {
  const withCard = new Set<Id>();
  let pictureCards = 0;
  for (const f of facts.values()) {
    if (f.card_type !== 'image') continue;
    pictureCards++;
    if (f.sense_id) withCard.add(f.sense_id);
  }
  const t = { with: { n: 0, p: 0 }, without: { n: 0, p: 0 }, image: { n: 0, p: 0 } };
  for (const [cardId, c] of tallyCards(data, facts, window)) {
    const f = facts.get(cardId)!;
    const slot =
      f.card_type === 'image'
        ? t.image
        : f.card_type === 'production'
          ? f.sense_id && withCard.has(f.sense_id)
            ? t.with
            : t.without
          : null;
    if (!slot) continue;
    slot.n += c.n;
    slot.p += c.passed;
  }
  const withPicture = retentionStat(t.with.p, t.with.n);
  const withoutPicture = retentionStat(t.without.p, t.without.n);
  return {
    pictureCards,
    withPicture,
    withoutPicture,
    pictureAnswers: retentionStat(t.image.p, t.image.n),
    diff: withPicture.enough && withoutPicture.enough ? withPicture.rate! - withoutPicture.rate! : null,
  };
}

// ------------------------------------------------------------------ weekly series

export interface WeekPoint extends RetentionStat {
  /** Monday of the week. */
  week: DayKey;
  /** Notes whose first card reached Review this week. */
  learned: number;
  /** Notes learned up to the end of this week. */
  learnedTotal: number;
}

/** Monday of the week a day belongs to. */
export function weekOf(day: DayKey): DayKey {
  return addDays(day, -weekdayMon0(day));
}

/**
 * The last `weeks` weeks ending with the current one (oldest first): notes learned per week
 * (a note is learned when its first live card first reached Review) and weekly retention.
 */
export function weeklySeries(
  data: RetentionData,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
  today: DayKey,
  weeks = SERIES_WEEKS,
): WeekPoint[] {
  const last = weekOf(today);
  const keys = Array.from({ length: weeks }, (_, i) => addDays(last, -7 * (weeks - 1 - i)));
  const index = new Map(keys.map((k, i) => [k, i]));
  const first = keys[0]!;

  const noteLearned = new Map<Id, DayKey>();
  for (const [cardId, r] of data.reachedReview) {
    const f = facts.get(cardId);
    if (!f) continue;
    const prev = noteLearned.get(f.note_id);
    if (prev === undefined || r.day < prev) noteLearned.set(f.note_id, r.day);
  }
  const learned = new Array<number>(weeks).fill(0);
  let before = 0;
  for (const day of noteLearned.values()) {
    const w = weekOf(day);
    if (w < first) before++;
    else {
      const i = index.get(w);
      if (i !== undefined) learned[i]!++;
    }
  }

  const byDay = new Map<DayKey, Tally>();
  for (const e of data.events) {
    if (e.day < first || !facts.has(e.card_id)) continue;
    let c = byDay.get(e.day);
    if (!c) byDay.set(e.day, (c = { n: 0, passed: 0 }));
    c.n++;
    if (e.passed) c.passed++;
  }
  const n = new Array<number>(weeks).fill(0);
  const passed = new Array<number>(weeks).fill(0);
  for (const [day, c] of byDay) {
    const i = index.get(weekOf(day));
    if (i === undefined) continue;
    n[i]! += c.n;
    passed[i]! += c.passed;
  }

  let total = before;
  return keys.map((week, i) => {
    total += learned[i]!;
    return { week, learned: learned[i]!, learnedTotal: total, ...retentionStat(passed[i]!, n[i]!) };
  });
}

// ------------------------------------------------------------------ everything for the screen

export interface ProgressReport {
  /** Window of the category view (PROGRESS_WINDOW_DAYS up to now). */
  window: Required<WindowOptions>;
  overall: RetentionStat;
  groups: Record<RetentionDimension, GroupRetention[]>;
  weakest: GroupRetention | null;
  strongest: GroupRetention | null;
  gap: RecognitionProductionGap;
  series: WeekPoint[];
}

export function buildProgressReport(
  data: RetentionData,
  facts: ReadonlyMap<Id, RetentionCardFacts>,
  opts: { now: Millis; today: DayKey; windowDays?: number },
): ProgressReport {
  const window = {
    from: opts.now - (opts.windowDays ?? PROGRESS_WINDOW_DAYS) * DAY_MS,
    to: opts.now + 1,
  };
  const groups = retentionByAllGroups(data, facts, window);
  const all = RETENTION_DIMENSIONS.flatMap((d) => groups[d]);
  return {
    window,
    overall: overallRetention(data, facts, window),
    groups,
    weakest: weakestGroup(all),
    strongest: strongestGroup(all),
    gap: recognitionProductionGap(data, facts, window),
    series: weeklySeries(data, facts, opts.today),
  };
}
