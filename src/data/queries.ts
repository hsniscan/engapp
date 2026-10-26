// Read-side API for screens. Safe to wrap in dexie-react-hooks' useLiveQuery.
import { addDays, type DayKey, dayEndMs, dayKeyOf } from '../domain/day';
import { bandFor, type CardSentence, pickRotation, rotationSentences, selectedContexts } from '../domain/examples';
import { previewIntervals, type IntervalPreview } from '../domain/fsrs';
import { normalizeTerm } from '../domain/normalize';
import { buildQueue, type QueueCounts, type QueueItem, type QueueMode } from '../domain/queue';
import { STUDY_MODE_CARD_TYPES, type StudyMode } from '../domain/studyMode';
import { type Cloze, firstLetterHint, lastShownSenseId, makeCloze, nextRecognitionSense } from '../domain/recognition';
import { buildHeatmap, computeStreakSummary, type HeatmapCell, type StreakSummary } from '../domain/streak';
import { isVacationDay } from '../domain/vacation';
import { type Card, type Id, type LexiconSense, type Millis, type Note, type RatingValue, type Sense } from '../domain/types';
import { db } from './db';
import { getDeckNoteIds } from './decks';
import { getWordStages } from './wordStages';
import { exampleTables, senseExamplesFor } from './examples';
import { cardImageOf, type CardImage } from './images';
import { imageCardsWithoutPicture } from './imageCards';
import { dueStudiedCards, loadTodayFacts, newCards } from './history';
import { aheadDaysFor, getLoadToday, type LoadToday } from './load';
import { extraNewKey, getMeta } from './meta';
import { newOrderInput, newOrderTables } from './newOrder';
import { dayConfig, getSettings, schedulerFor } from './settings';

export interface StudyQueue {
  items: (QueueItem & { card: Card })[];
  counts: QueueCounts;
  nextLearningDue: Millis | null;
  /** Non-undone answers given today, and how many of them introduced a new card. */
  doneToday: number;
  newToday: number;
  /** Today's extra new-card allowance on this device ("+5 yeni kart"). */
  extraNewToday: number;
  day: DayKey;
  /** Exclusive end of today; in 'ahead' mode, items with `card.due >= dayEnd` are tomorrow's. */
  dayEnd: Millis;
  /** v0.3 İP3: today's catch-up / vacation plan (null in 'ahead' mode). */
  load: LoadToday | null;
}

/** Today's extra new-card allowance (meta `extra_new:<day>`, this device only). */
export async function getExtraNewToday(day: DayKey): Promise<number> {
  const v = await getMeta<number>(extraNewKey(day));
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export interface StudyQueueOptions {
  session?: { reviews: number; new: number };
  learnAheadMs?: number;
  /** 'ahead': tomorrow's reviews now ("Yarının kartlarını şimdi tekrar et"). Default 'normal'. */
  mode?: QueueMode;
  /**
   * Study mode (redesign): only this mode's card types, with its own first-time counter and
   * burying (domain/queue.ts). Absent = the old mixed queue of every card type.
   */
  studyMode?: StudyMode;
  /**
   * Only the notes of this smart deck (Desteler → "Çalış"): its due and new cards, under the
   * same daily limits. An unknown or deleted deck leaves the queue empty.
   */
  deckId?: Id;
}

/**
 * The current session queue. Rebuild it after every answer (learning cards re-enter when
 * due). Pass the session's own answer counts to keep the "1 new after 5 reviews" rhythm.
 * The new-card limit is the daily limit plus today's extra allowance (addExtraNew); cards
 * introduced today count against it from the logs, so other devices never double count.
 */
export async function getStudyQueue(opts: StudyQueueOptions = {}, now: Millis = Date.now()): Promise<StudyQueue> {
  const tables = [db.cards, db.review_logs, db.settings, db.meta, ...newOrderTables()];
  // The deck's notes are read first (other tables); a deck that matches nothing studies nothing.
  const deckNotes = opts.deckId ? ((await getDeckNoteIds(opts.deckId, now)) ?? new Set<Id>()) : null;
  // v0.4 İP8: picture cards whose picture is not on this device are left out of this session.
  // Read before the transaction: awaiting the nested picture lookup inside it lost Dexie's
  // transaction zone when several queues were built at once (the home screen builds five), so
  // the transaction committed early (PrematureCommitError, seen offline with picture cards).
  const noPicture = await imageCardsWithoutPicture(await db.cards.where('card_type').equals('image').toArray());
  return db.transaction('r', [...new Set(tables)], async () => {
    const settings = await getSettings(now);
    const cfg = dayConfig(settings);
    const facts = await loadTodayFacts(cfg, now);
    const ahead = opts.mode === 'ahead';
    // Before a vacation, "Yarının kartları" reaches over the vacation (up to 7 days).
    const aheadEnd = dayEndMs(addDays(facts.bounds.key, ahead ? aheadDaysFor(settings, facts.bounds.key) : 1), cfg);
    // Catch-up and the new-card ramp (domain/catchup.ts) shape the normal queue only.
    const load = ahead ? null : await getLoadToday(settings, now);
    const [studied, fresh, extraNewToday] = await Promise.all([
      dueStudiedCards(ahead ? aheadEnd : facts.bounds.end),
      ahead ? Promise.resolve([]) : newCards(),
      getExtraNewToday(facts.bounds.key),
    ]);
    const inDeck = (c: Card) => !deckNotes || deckNotes.has(c.note_id);
    const all = deckNotes ? [...studied, ...fresh].filter(inDeck) : [...studied, ...fresh];
    const cards = noPicture.size ? all.filter((c) => !noPicture.has(c.id)) : all;
    const types = opts.studyMode ? STUDY_MODE_CARD_TYPES[opts.studyMode] : null;
    const freshShown = fresh.filter((c) => inDeck(c) && !noPicture.has(c.id) && (!types || types.includes(c.card_type)));
    // "Yeni kelime sırası": smart unless the user chose insertion order.
    const smart = !ahead && settings.new_card_order !== 'added' && freshShown.length > 0;
    const newOrder = smart ? await newOrderInput(freshShown, facts, settings) : null;
    // Each mode counts its own first-time cards against the same daily limit; "+5 yeni kart"
    // is extra Kelime çalışma.
    const introduced = types ? types.reduce((n, t) => n + facts.introducedByType[t], 0) : facts.newIntroducedToday;
    const extra = !types || opts.studyMode === 'word' ? extraNewToday : 0;
    const q = buildQueue(cards, {
      now,
      dayEnd: facts.bounds.end,
      mode: opts.mode ?? 'normal',
      aheadEnd,
      dailyNewLimit: load ? load.newLimitToday : settings.daily_new_limit,
      reviewCap: load?.plan.reviewCap ?? null,
      newOrder,
      extraNewToday: extra,
      newIntroducedToday: introduced,
      ...(types ? { cardTypes: types, recognitionReviewedTodayNoteIds: facts.recognitionNoteIds } : {}),
      reviewedTodayCardIds: facts.reviewedCardIds,
      reviewedTodayNoteIds: facts.reviewedNoteIds,
      ...(opts.session ? { session: opts.session } : {}),
      ...(opts.learnAheadMs !== undefined ? { learnAheadMs: opts.learnAheadMs } : {}),
    });
    const byId = new Map(cards.map((c) => [c.id, c]));
    return {
      items: q.items.map((i) => ({ ...i, card: byId.get(i.card_id)! })),
      counts: q.counts,
      nextLearningDue: q.nextLearningDue,
      doneToday: facts.answers.length,
      newToday: introduced,
      extraNewToday,
      day: facts.bounds.key,
      dayEnd: facts.bounds.end,
      load,
    };
  });
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
  return db.transaction('r', [db.cards, db.notes, db.senses, db.review_logs, db.settings, db.lexicon_cache, db.images, ...exampleTables()], async () => {
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
    if (sense) {
      const selected = selectedContexts(settings);
      const examples = sense.lexicon_sense_id
        ? await senseExamplesFor(sense.lexicon_sense_id, bandFor(settings), selected)
        : null;
      const needSpan = card.card_type === 'cloze';
      const picked = pickRotation(rotationSentences(sense, examples, selected, needSpan), card.reps);
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
    // Vacation days without reviews neither break nor extend the streak (v0.3 İP3).
    isFrozenDay: (day) => isVacationDay(settings, day),
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
  const notes = await db.notes.filter((n) => n.deleted_at === null && (!q || n.term_norm.includes(q))).toArray();
  return notes.sort((a, b) => b.created_at - a.created_at);
}

export function listSources() {
  return db.sources.orderBy('created_at').reverse().filter((s) => s.deleted_at === null).toArray();
}

/** Outbox rows waiting to be pushed ("12 değişiklik bekliyor"). */
export function pendingChangesCount(): Promise<number> {
  return db.outbox.count();
}
