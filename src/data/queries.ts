// Read-side API for screens. Safe to wrap in dexie-react-hooks' useLiveQuery.
import { addDays, type DayKey, dayEndMs, dayKeyOf } from '../domain/day';
import { bandFor, type CardSentence, pickRotation, rotationSentences, selectedContexts } from '../domain/examples';
import { pickRotating, sentenceKey } from '../domain/textSentences';
import { previewIntervals, type IntervalPreview } from '../domain/fsrs';
import { normalizeTerm } from '../domain/normalize';
import { buildQueue, isBuriedInMode, isStudiable, type QueueCounts, type QueueItem, type QueueMode } from '../domain/queue';
import { STUDY_MODE_CARD_TYPES, STUDY_MODES, studyModeOf, type StudyMode } from '../domain/studyMode';
import { shareNewBudget, shareReviewBudget } from '../domain/studyPlan';
import { type Cloze, firstLetterHint, lastShownSenseId, makeCloze, nextRecognitionSense } from '../domain/recognition';
import { buildHeatmap, computeStreakSummary, type HeatmapCell, type StreakSummary } from '../domain/streak';
import { type Card, CardState, type CardType, type Id, type LexiconSense, type Millis, type Note, type RatingValue, type Sense, type Settings } from '../domain/types';
import { db } from './db';
import { getDeckNoteIds } from './decks';
import { getWordStages } from './wordStages';
import { exampleTables, senseExamplesFor } from './examples';
import { cardImageOf, type CardImage } from './images';
import { imageCardsWithoutPicture } from './imageCards';
import { dictationSentencesFor, hiddenDictationCards } from './dictation';
import { dueStudiedCards, loadTodayFacts, newCards, type TodayFacts } from './history';
import { aheadDaysFor, getLoadToday, type LoadToday } from './load';
import { extraNewKey, getMeta } from './meta';
import { newOrderInput, newOrderTables } from './newOrder';
import type { NewOrderInput } from '../domain/newOrder';
import { readCarry } from './smart';
import { streakFrozenDay } from './streakFreeze';
import { cachedTextSentences, loadTextSentences, readLastShown, textSentenceTables, writeLastShown } from './textSentences';
import { dayConfig, getSettings, schedulerFor } from './settings';
import { scanWhere } from './scan';

export interface StudyQueue {
  items: (QueueItem & { card: Card })[];
  counts: QueueCounts;
  nextLearningDue: Millis | null;
  /** Learning steps due later today (after the learn-ahead window): ids, today's work. */
  learningLater: Id[];
  /** Non-undone answers given today, and how many of them introduced a new card. */
  doneToday: number;
  newToday: number;
  /** Today's extra new-card allowance of this queue's mode on this device ("+5 yeni kart"). */
  extraNewToday: number;
  day: DayKey;
  /** Exclusive end of today; in 'ahead' mode, items with `card.due >= dayEnd` are tomorrow's. */
  dayEnd: Millis;
  /** v0.3 İP3: today's catch-up / vacation plan (null in 'ahead' mode). */
  load: LoadToday | null;
  /** v0.5 İP10: new cards the interference guard held back (rememberPostponed carries them). */
  postponed: Id[];
  /** v0.5.2: first-time cards of this mode still waiting beyond today's allowance. */
  newWaiting: number;
  /** v0.5.2: cards of this queue's types answered today (non-undone). */
  answeredToday: Id[];
  /** v0.5.2: reviews due today that catch-up moved to later days (not in this queue). */
  deferred: number;
}

/**
 * Today's extra new-card allowance per study mode (meta `extra_new:<day>`, this device only).
 * Before v0.5.2 the value was one number, Kelime's.
 */
export async function getExtraNewToday(day: DayKey): Promise<Record<StudyMode, number>> {
  const v = await getMeta<unknown>(extraNewKey(day));
  const out: Record<StudyMode, number> = { word: 0, production: 0, cloze: 0, dictation: 0 };
  const ok = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  if (typeof v === 'number') out.word = ok(v);
  else if (v && typeof v === 'object') for (const m of STUDY_MODES) out[m] = ok((v as Record<string, unknown>)[m]);
  return out;
}

export interface StudyQueueOptions {
  session?: { reviews: number; new: number };
  learnAheadMs?: number;
  /** 'ahead': tomorrow's reviews now ("Yarının kartlarını şimdi tekrar et"). Default 'normal'. */
  mode?: QueueMode;
  /**
   * Study mode (redesign): only this mode's card types, with its share of the day's new-card
   * budget and burying (domain/queue.ts). Absent = the old mixed queue of every card type.
   */
  studyMode?: StudyMode;
  /**
   * Only the notes of this smart deck (Desteler → "Çalış"): its due and new cards, under the
   * same daily limits. An unknown or deleted deck leaves the queue empty.
   */
  deckId?: Id;
}

/** What every mode's queue of one moment shares: read once (v0.5.2, review Y3 / B13). */
interface QueueBase {
  now: Millis;
  settings: Settings;
  facts: TodayFacts;
  ahead: boolean;
  aheadEnd: Millis;
  load: LoadToday | null;
  /** Studiable-or-not cards of the queue (deck and device filters applied). */
  cards: Card[];
  byId: Map<Id, Card>;
  extra: Record<StudyMode, number>;
  carry: Id[];
  /** Per-mode new-card allowance and review cap (normal mode). */
  newAllowed: Record<StudyMode, number>;
  newAvailable: Record<StudyMode, number>;
  dueReviews: Record<StudyMode, number>;
  reviewCaps: Record<StudyMode, number> | null;
  /** Smart new-card order input over every mode's first-time cards (null: none / 'ahead'). */
  newOrder: NewOrderInput | null;
}

const queueTables = () => [...new Set([db.cards, db.review_logs, db.settings, db.meta, ...newOrderTables()])];

async function readQueueBase(
  opts: Pick<StudyQueueOptions, 'mode' | 'deckId'>,
  deckNotes: Set<Id> | null,
  hidden: Set<Id>,
  now: Millis,
): Promise<QueueBase> {
  const settings = await getSettings(now);
  const cfg = dayConfig(settings);
  const facts = await loadTodayFacts(cfg, now);
  const ahead = opts.mode === 'ahead';
  // Before a vacation, "Yarının kartları" reaches over the vacation (up to 7 days).
  const aheadEnd = dayEndMs(addDays(facts.bounds.key, ahead ? aheadDaysFor(settings, facts.bounds.key) : 1), cfg);
  // Catch-up and the new-card ramp (domain/catchup.ts) shape the normal queue only.
  const load = ahead ? null : await getLoadToday(settings, now);
  const [studied, fresh, extra, carry] = await Promise.all([
    dueStudiedCards(ahead ? aheadEnd : facts.bounds.end),
    ahead ? Promise.resolve([]) : newCards(),
    getExtraNewToday(facts.bounds.key),
    // v0.5 İP10: cards the interference guard postponed earlier (read with the rest).
    ahead ? Promise.resolve([]) : readCarry(),
  ]);
  const keep = (c: Card) => (!deckNotes || deckNotes.has(c.note_id)) && !hidden.has(c.id);
  const cards = [...studied, ...fresh].filter(keep);
  const byId = new Map(cards.map((c) => [c.id, c]));

  // The day's new-card budget, shared by the modes (domain/studyPlan.ts shareNewBudget).
  const newAvailable: Record<StudyMode, number> = { word: 0, production: 0, cloze: 0, dictation: 0 };
  const dueReviews: Record<StudyMode, number> = { word: 0, production: 0, cloze: 0, dictation: 0 };
  const recognitionToday = { recognitionReviewedTodayNoteIds: facts.recognitionNoteIds };
  for (const c of cards) {
    if (!isStudiable(c)) continue;
    const m = studyModeOf(c.card_type);
    if (c.state === CardState.New) {
      if (!isBuriedInMode(c, recognitionToday)) newAvailable[m]++;
    } else if (c.state === CardState.Review && c.due < facts.bounds.end) dueReviews[m]++;
  }
  const introduced: Record<StudyMode, number> = { word: 0, production: 0, cloze: 0, dictation: 0 };
  for (const t of Object.keys(facts.introducedByType) as CardType[]) introduced[studyModeOf(t)] += facts.introducedByType[t];
  const limits = settings.study_options?.mode_new_limits ?? null;
  const newAllowed = ahead
    ? { word: 0, production: 0, cloze: 0, dictation: 0 }
    : shareNewBudget({
        total: load ? load.newLimitToday : settings.daily_new_limit,
        introduced,
        available: newAvailable,
        caps: { production: limits?.production ?? null, cloze: limits?.cloze ?? null, dictation: limits?.dictation ?? null },
        extra,
      });

  // Catch-up: one review budget for the day, shared fairly by the modes (ADR 0062).
  let reviewCaps: Record<StudyMode, number> | null = null;
  if (load && load.plan.reviewCap !== null) {
    const doneReviews: Record<StudyMode, number> = { word: 0, production: 0, cloze: 0, dictation: 0 };
    for (const id of facts.reviewedCardIds) {
      if (facts.introducedCardIds.has(id)) continue;
      const type = facts.typeOf.get(id);
      if (type) doneReviews[studyModeOf(type)]++;
    }
    reviewCaps = shareReviewBudget(load.plan.reviewCap, doneReviews, dueReviews);
  }
  // "Yeni kelime sırası": smart unless the user chose insertion order. Both orders get the
  // interference guard and the cards it postponed earlier (v0.5 İP10, decision 0052). Read once
  // for every mode's first-time cards, so building the modes' queues awaits nothing more.
  const freshShown = ahead ? [] : cards.filter((c) => c.state === CardState.New);
  const newOrder =
    freshShown.length > 0
      ? await newOrderInput(freshShown, facts, settings, {
          order: settings.new_card_order === 'added' ? 'added' : 'smart',
          carry,
        })
      : null;
  return { now, settings, facts, ahead, aheadEnd, load, cards, byId, extra, carry, newAllowed, newAvailable, dueReviews, reviewCaps, newOrder };
}

/** One queue from the shared read (synchronous: nothing awaited, so no Dexie zone is lost). */
function queueFromBase(base: QueueBase, opts: StudyQueueOptions): StudyQueue {
  const { now, settings, facts, load } = base;
  const types = opts.studyMode ? STUDY_MODE_CARD_TYPES[opts.studyMode] : null;
  const anyFresh = !types ? !!base.newOrder : base.cards.some((c) => c.state === CardState.New && types.includes(c.card_type));
  const newOrder = anyFresh ? base.newOrder : null;
  const mode = opts.studyMode;
  const extraAll = STUDY_MODES.reduce((n, m) => n + base.extra[m], 0);
  // A mode gets its share of the day's budget; the old mixed queue the whole budget.
  const newLimit = mode
    ? { dailyNewLimit: base.newAllowed[mode], extraNewToday: 0, newIntroducedToday: 0 }
    : {
        dailyNewLimit: load ? load.newLimitToday : settings.daily_new_limit,
        extraNewToday: extraAll,
        newIntroducedToday: facts.newIntroducedToday,
      };
  const reviewCap = base.reviewCaps ? (mode ? base.reviewCaps[mode] : (load?.plan.reviewCap ?? null)) : null;
  const q = buildQueue(base.cards, {
    now,
    dayEnd: facts.bounds.end,
    mode: opts.mode ?? 'normal',
    aheadEnd: base.aheadEnd,
    ...newLimit,
    reviewCap,
    newOrder,
    ...(types ? { cardTypes: types, recognitionReviewedTodayNoteIds: facts.recognitionNoteIds } : {}),
    reviewedTodayCardIds: facts.reviewedCardIds,
    reviewedTodayNoteIds: facts.reviewedNoteIds,
    ...(opts.session ? { session: opts.session } : {}),
    ...(opts.learnAheadMs !== undefined ? { learnAheadMs: opts.learnAheadMs } : {}),
  });
  const introduced = types ? types.reduce((n, t) => n + facts.introducedByType[t], 0) : facts.newIntroducedToday;
  const available = mode ? base.newAvailable[mode] : STUDY_MODES.reduce((n, m) => n + base.newAvailable[m], 0);
  return {
    items: q.items.map((i) => ({ ...i, card: base.byId.get(i.card_id)! })),
    counts: q.counts,
    nextLearningDue: q.nextLearningDue,
    learningLater: q.learningLater,
    doneToday: facts.answers.length,
    newToday: introduced,
    extraNewToday: mode ? base.extra[mode] : extraAll,
    day: facts.bounds.key,
    dayEnd: facts.bounds.end,
    load,
    postponed: q.postponed ?? [],
    newWaiting: Math.max(0, available - q.counts.new),
    answeredToday: [...facts.reviewedCardIds].filter((id) => {
      const t = facts.typeOf.get(id);
      return !!t && (!types || types.includes(t));
    }),
    deferred:
      base.reviewCaps === null
        ? 0
        : Math.max(0, (mode ? base.dueReviews[mode] : STUDY_MODES.reduce((n, m) => n + base.dueReviews[m], 0)) - q.counts.review),
  };
}

/**
 * The current session queue. Rebuild it after every answer (learning cards re-enter when
 * due). Pass the session's own answer counts to keep the "1 new after 5 reviews" rhythm.
 * New cards: the mode's share of the day's budget (shareNewBudget) plus today's extra
 * allowance (addExtraNew); cards introduced today count against it from the logs, so other
 * devices never double count.
 */
export async function getStudyQueue(opts: StudyQueueOptions = {}, now: Millis = Date.now()): Promise<StudyQueue> {
  // The deck's notes are read first (other tables); a deck that matches nothing studies nothing.
  const deckNotes = opts.deckId ? ((await getDeckNoteIds(opts.deckId, now)) ?? new Set<Id>()) : null;
  // Cards this device cannot show: pictures not here (v0.4 İP8), dictation without a sentence
  // (v0.5 İP9). Read before the transaction: awaiting the nested picture lookup inside it lost
  // Dexie's transaction zone when several queues were built at once (PrematureCommitError).
  // Inline on purpose: one more async wrapper here lost the live query's zone, and Bugün
  // stopped updating after answers.
  const hidden = await imageCardsWithoutPicture(await db.cards.where('card_type').equals('image').toArray());
  if (!opts.studyMode || opts.studyMode === 'dictation') for (const id of await hiddenDictationCards()) hidden.add(id);
  return db.transaction('r', queueTables(), async () =>
    queueFromBase(await readQueueBase(opts, deckNotes, hidden, now), opts),
  );
}

/**
 * Every study mode's queue of one moment from one read (v0.5.2): Bugün, the Çalış picker and
 * the mixed session used to build each mode's queue from scratch, reading the cards, today's
 * logs and the load plan four times (review Y3).
 */
export async function getStudyQueues(
  opts: Omit<StudyQueueOptions, 'studyMode' | 'mode'> = {},
  now: Millis = Date.now(),
): Promise<Record<StudyMode, StudyQueue>> {
  const deckNotes = opts.deckId ? ((await getDeckNoteIds(opts.deckId, now)) ?? new Set<Id>()) : null;
  // As in getStudyQueue (inline on purpose).
  const hidden = await imageCardsWithoutPicture(await db.cards.where('card_type').equals('image').toArray());
  for (const id of await hiddenDictationCards()) hidden.add(id);
  return db.transaction('r', queueTables(), async () => {
    const base = await readQueueBase(opts, deckNotes, hidden, now);
    const out = {} as Record<StudyMode, StudyQueue>;
    for (const studyMode of STUDY_MODES) out[studyMode] = queueFromBase(base, { ...opts, studyMode });
    return out;
  });
}

/**
 * "Karışık çalış" (ADR 0055): the four study modes' own queues in one session, so the mixed
 * session holds exactly the cards the modes show (their shares of the new-card budget, the
 * shared catch-up budget, Dikte when this device can read its sentences). Due learning steps
 * first, then the modes' cards taken in turn, the later learning steps last.
 */
export async function getMixedStudyQueue(
  opts: Omit<StudyQueueOptions, 'studyMode' | 'mode'> = {},
  now: Millis = Date.now(),
): Promise<StudyQueue> {
  const byMode = await getStudyQueues(opts, now);
  const queues = STUDY_MODES.map((m) => byMode[m]);
  const first = queues[0]!;
  const dueNow: StudyQueue['items'] = [];
  const later: StudyQueue['items'] = [];
  const lanes = queues.map((q) =>
    q.items.filter((i) => {
      if (i.kind !== 'learning') return true;
      (i.card.due <= now ? dueNow : later).push(i);
      return false;
    }),
  );
  const middle: StudyQueue['items'] = [];
  for (let k = 0; lanes.some((l) => k < l.length); k++) for (const l of lanes) if (k < l.length) middle.push(l[k]!);
  dueNow.sort((a, b) => a.card.due - b.card.due);
  later.sort((a, b) => a.card.due - b.card.due);
  const items = [...dueNow, ...middle, ...later];
  const sum = (f: (c: QueueCounts) => number) => queues.reduce((n, q) => n + f(q.counts), 0);
  const nexts = queues.map((q) => q.nextLearningDue).filter((v): v is Millis => v !== null);
  return {
    ...first,
    items,
    counts: {
      learning: sum((c) => c.learning),
      review: sum((c) => c.review),
      new: sum((c) => c.new),
      total: items.length,
      new_allowed: sum((c) => c.new_allowed),
    },
    nextLearningDue: nexts.length ? Math.min(...nexts) : null,
    learningLater: queues.flatMap((q) => q.learningLater),
    newToday: queues.reduce((n, q) => n + q.newToday, 0),
    extraNewToday: queues.reduce((n, q) => n + q.extraNewToday, 0),
    postponed: [...new Set(queues.flatMap((q) => q.postponed))],
    newWaiting: queues.reduce((n, q) => n + q.newWaiting, 0),
    answeredToday: queues.flatMap((q) => q.answeredToday),
    deferred: queues.reduce((n, q) => n + q.deferred, 0),
  };
}

export interface CardView {
  card: Card;
  note: Note;
  /** Live senses in display order (the back of a recognition card lists them all). */
  senses: Sense[];
  /** Recognition: the sense whose sentence to show this time (pass its id to answerCard). Production/cloze/image: the card's sense. */
  sense: Sense | null;
  /** Cloze card: the blanked sentence. */
  cloze: Cloze | null;
  /** Production card: "b___". */
  hint: string | null;
  /**
   * The sentence shown this time (front of recognition and cloze cards, back of all): the
   * source sentence and the example sentences take turns, one more step after every answer.
   */
  sentence: CardSentence | null;
  /** Interval labels for the four buttons. */
  previews: Record<RatingValue, IntervalPreview>;
  /** Cached lexicon rows of the senses (their levels), by lexicon_sense_id. */
  lexicon: Map<Id, LexiconSense>;
  /**
   * v0.4 İP3: the picture of `sense` (or of the only sense), null when there is none. For a
   * picture card (İP8) it is the card's question: the chosen or an approved picture only.
   */
  image: CardImage | null;
  /** v0.4 İP3: settings.show_image_front. */
  imageOnFront: boolean;
}

/** Cached lexicon rows of these senses, by id (missing rows are left out). */
async function lexiconOf(senses: Sense[]): Promise<Map<Id, LexiconSense>> {
  const ids = [...new Set(senses.map((s) => s.lexicon_sense_id).filter((x): x is Id => !!x))];
  const rows = ids.length ? await db.lexicon_cache.bulkGet(ids) : [];
  return new Map(rows.filter((r): r is LexiconSense => !!r).map((r) => [r.id, r]));
}

/** Everything a review screen needs to render one card. */
export async function getCardView(cardId: Id, now: Millis = Date.now()): Promise<CardView | null> {
  let shown: { reps: number; key: string; changed: boolean } | null = null;
  const view = await db.transaction('r', [...new Set([db.cards, db.notes, db.senses, db.review_logs, db.settings, db.lexicon_cache, db.images, ...exampleTables(), ...textSentenceTables()])], async () => {
    const card = await db.cards.get(cardId);
    if (!card) return null;
    const note = await db.notes.get(card.note_id);
    if (!note) return null;
    const senses = (await db.senses.where('note_id').equals(note.id).toArray())
      .filter((s) => s.deleted_at === null)
      .sort((a, b) => a.sense_no - b.sense_no);
    const settings = await getSettings(now);
    let sense: Sense | null = null;
    let cloze: Cloze | null = null;
    let hint: string | null = null;
    if (card.card_type === 'recognition' && card.sense_id) {
      // A per-sense recognition card (a split leech, data/leech.ts) always asks its own sense.
      sense = senses.find((s) => s.id === card.sense_id) ?? null;
    } else if (card.card_type === 'recognition') {
      const logs = await db.review_logs.where('card_id').equals(card.id).toArray();
      sense = nextRecognitionSense(senses, lastShownSenseId(logs));
    } else {
      sense = senses.find((s) => s.id === card.sense_id) ?? null;
      if (card.card_type === 'production') hint = firstLetterHint(note.term);
    }
    let sentence: CardSentence | null = null;
    if (sense && card.card_type === 'dictation') {
      // Dikte (v0.5 İP9): only shared sentences, which have pre-generated audio; a new one
      // after every answer, like the other cards.
      const list = sense.lexicon_sense_id ? await dictationSentencesFor(sense.lexicon_sense_id, settings) : [];
      sentence = pickRotation(list, card.reps);
      if (sentence?.span) cloze = makeCloze(sentence.text, sentence.span);
    } else if (sense) {
      const selected = selectedContexts(settings);
      const examples = sense.lexicon_sense_id
        ? await senseExamplesFor(sense.lexicon_sense_id, bandFor(settings), selected)
        : null;
      const needSpan = card.card_type === 'cloze';
      // v0.5 İP10: sentences from the user's own texts come right after the card's own one.
      // Only for a word with one meaning: a found sentence cannot tell two meanings apart.
      const own =
        senses.length === 1 && (note.term_type === 'word' || note.term_type === 'phrase')
          ? (cachedTextSentences(note.term, sense.pos, sense.source_sentence) ??
            (await loadTextSentences(note.term, sense.pos, sense.source_sentence)))
          : [];
      const last = await readLastShown(card.id);
      const picked = pickRotating(rotationSentences(sense, examples, selected, needSpan, own), card.reps, last, (x) => sentenceKey(x.text));
      if (picked) {
        const key = sentenceKey(picked.text);
        shown = { reps: card.reps, key, changed: last?.reps !== card.reps || last.key !== key };
      }
      sentence = picked && { ...picked, trOnTap: picked.exampleId !== null && settings.example_tr_visible !== true };
      // A cloze card keeps its own sentence when the source sentence has no usable span
      // (as before) and no example sentence can stand in.
      if (needSpan && sentence?.span) cloze = makeCloze(sentence.text, sentence.span);
    }
    return {
      card,
      note,
      senses,
      sense,
      cloze,
      hint,
      sentence,
      previews: previewIntervals(schedulerFor(settings), card, now),
      lexicon: await lexiconOf(senses),
      image:
        card.card_type === 'image'
          ? await cardImageOf(sense, true)
          : await cardImageOf(sense ?? (senses.length === 1 ? senses[0]! : null)),
      imageOnFront: settings.show_image_front === true,
    };
  });
  // Outside the read transaction: remember what this showing uses (device-local meta).
  const remember = shown as { reps: number; key: string; changed: boolean } | null;
  if (view && remember?.changed) await writeLastShown(view.card.id, { reps: remember.reps, key: remember.key }).catch(() => {});
  return view;
}

export interface HomeSummary {
  queue: QueueCounts;
  /** "Bugün: 34 / 60 kart": done today / (done today + still to do). */
  doneToday: number;
  plannedToday: number;
  streak: StreakSummary;
}

export async function getStreakSummary(now: Millis = Date.now()): Promise<StreakSummary> {
  const settings = await getSettings(now);
  const cfg = dayConfig(settings);
  // "Öğrendiğin kelime" (ADR 0041): words, not cards; only Öğrenildi and Kalıcı count.
  const [activity, learned] = await Promise.all([
    db.daily_activity.toArray(),
    getWordStages(now).then((s) => s.learnedTotal),
  ]);
  return computeStreakSummary(activity, {
    today: dayKeyOf(now, cfg),
    // Vacation days (v0.3 İP3) and days a streak protection covered (v0.5 İP10) neither break
    // nor extend the streak.
    isFrozenDay: streakFrozenDay(settings),
    accountStartDay: dayKeyOf(settings.created_at, cfg),
    learnedCards: learned,
  });
}

export async function getHeatmap(now: Millis = Date.now(), weeks = 26): Promise<HeatmapCell[][]> {
  const settings = await getSettings(now);
  return buildHeatmap(await db.daily_activity.toArray(), dayKeyOf(now, dayConfig(settings)), weeks);
}

export async function getHomeSummary(now: Millis = Date.now()): Promise<HomeSummary> {
  const [q, streak] = await Promise.all([getStudyQueue({ learnAheadMs: 0 }, now), getStreakSummary(now)]);
  return { queue: q.counts, doneToday: q.doneToday, plannedToday: q.doneToday + q.counts.total, streak };
}

// ------------------------------------------------------------------ notes

export interface NoteDetail {
  note: Note;
  senses: Sense[];
  cards: Card[];
  /** Cached lexicon rows of the senses (their levels), by lexicon_sense_id. */
  lexicon: Map<Id, LexiconSense>;
}

export async function getNoteDetail(noteId: Id): Promise<NoteDetail | null> {
  return db.transaction('r', [db.notes, db.senses, db.cards, db.lexicon_cache], async () => {
    const note = await db.notes.get(noteId);
    if (!note) return null;
    const senses = (await db.senses.where('note_id').equals(noteId).toArray())
      .filter((s) => s.deleted_at === null)
      .sort((a, b) => a.sense_no - b.sense_no);
    const cards = (await db.cards.where('note_id').equals(noteId).toArray()).filter((c) => c.deleted_at === null);
    return { note, senses, cards, lexicon: await lexiconOf(senses) };
  });
}

/** The live note for a term (any spelling that normalizes the same), with its live senses. */
export async function findNoteByTerm(term: string): Promise<{ note: Note; senses: Sense[] } | null> {
  const norm = normalizeTerm(term);
  if (!norm) return null;
  const note = (await db.notes.where('term_norm').equals(norm).toArray()).find((n) => n.deleted_at === null);
  if (!note) return null;
  const senses = (await db.senses.where('note_id').equals(note.id).toArray()).filter((s) => s.deleted_at === null);
  return { note, senses };
}

/** Live notes, newest first; optional case/whitespace-insensitive substring filter on the term. */
export async function listNotes(query = ''): Promise<Note[]> {
  const q = normalizeTerm(query);
  const notes = await scanWhere(db.notes, (n) => n.deleted_at === null && (!q || n.term_norm.includes(q)));
  return notes.sort((a, b) => b.created_at - a.created_at);
}

export function listSources() {
  return db.sources.orderBy('created_at').reverse().filter((s) => s.deleted_at === null).toArray();
}

/** Outbox rows waiting to be pushed ("12 değişiklik bekliyor"). */
export function pendingChangesCount(): Promise<number> {
  return db.outbox.count();
}
