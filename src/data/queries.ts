// Read-side API for screens. Safe to wrap in dexie-react-hooks' useLiveQuery.
import { type DayKey, dayKeyOf } from '../domain/day';
import { previewIntervals, type IntervalPreview } from '../domain/fsrs';
import { normalizeTerm } from '../domain/normalize';
import { buildQueue, type QueueCounts, type QueueItem } from '../domain/queue';
import { type Cloze, firstLetterHint, lastShownSenseId, makeCloze, nextRecognitionSense } from '../domain/recognition';
import { buildHeatmap, computeStreakSummary, type HeatmapCell, type StreakSummary } from '../domain/streak';
import { type Card, CardState, type Id, type Millis, type Note, type RatingValue, type Sense } from '../domain/types';
import { db } from './db';
import { dueStudiedCards, loadTodayFacts, newCards } from './history';
import { dayConfig, getSettings, schedulerFor } from './settings';

export interface StudyQueue {
  items: (QueueItem & { card: Card })[];
  counts: QueueCounts;
  nextLearningDue: Millis | null;
  /** Non-undone answers given today, and how many of them introduced a new card. */
  doneToday: number;
  newToday: number;
  day: DayKey;
}

/**
 * The current session queue. Rebuild it after every answer (learning cards re-enter when
 * due). Pass the session's own answer counts to keep the "1 new after 5 reviews" rhythm.
 */
export async function getStudyQueue(
  opts: { session?: { reviews: number; new: number }; learnAheadMs?: number } = {},
  now: Millis = Date.now(),
): Promise<StudyQueue> {
  return db.transaction('r', [db.cards, db.review_logs, db.settings], async () => {
    const settings = await getSettings(now);
    const facts = await loadTodayFacts(dayConfig(settings), now);
    const [studied, fresh] = await Promise.all([dueStudiedCards(facts.bounds.end), newCards()]);
    const cards = [...studied, ...fresh];
    const q = buildQueue(cards, {
      now,
      dayEnd: facts.bounds.end,
      dailyNewLimit: settings.daily_new_limit,
      newIntroducedToday: facts.newIntroducedToday,
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
      newToday: facts.newIntroducedToday,
      day: facts.bounds.key,
    };
  });
}

export interface CardView {
  card: Card;
  note: Note;
  /** Live senses in display order (the back of a recognition card lists them all). */
  senses: Sense[];
  /** Recognition: the sense whose sentence to show this time (pass its id to answerCard). Production/cloze: the card's sense. */
  sense: Sense | null;
  /** Cloze card: the blanked sentence. */
  cloze: Cloze | null;
  /** Production card: "b___". */
  hint: string | null;
  /** Interval labels for the four buttons. */
  previews: Record<RatingValue, IntervalPreview>;
}

/** Everything a review screen needs to render one card. */
export async function getCardView(cardId: Id, now: Millis = Date.now()): Promise<CardView | null> {
  return db.transaction('r', [db.cards, db.notes, db.senses, db.review_logs, db.settings], async () => {
    const card = await db.cards.get(cardId);
    if (!card) return null;
    const note = await db.notes.get(card.note_id);
    if (!note) return null;
    const senses = (await db.senses.where('note_id').equals(note.id).toArray())
      .filter((s) => s.deleted_at === null)
      .sort((a, b) => a.sense_no - b.sense_no);
    let sense: Sense | null = null;
    let cloze: Cloze | null = null;
    let hint: string | null = null;
    if (card.card_type === 'recognition') {
      const logs = await db.review_logs.where('card_id').equals(card.id).toArray();
      sense = nextRecognitionSense(senses, lastShownSenseId(logs));
    } else {
      sense = senses.find((s) => s.id === card.sense_id) ?? null;
      if (card.card_type === 'cloze' && sense?.source_sentence && sense.span) {
        cloze = makeCloze(sense.source_sentence, sense.span);
      }
      if (card.card_type === 'production') hint = firstLetterHint(note.term);
    }
    const settings = await getSettings(now);
    return { card, note, senses, sense, cloze, hint, previews: previewIntervals(schedulerFor(settings), card, now) };
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
  const [activity, learned] = await Promise.all([
    db.daily_activity.toArray(),
    db.cards.where('[state+due]').between([CardState.Review, -Infinity], [CardState.Review, Infinity]).filter((c) => c.deleted_at === null).count(),
  ]);
  return computeStreakSummary(activity, {
    today: dayKeyOf(now, cfg),
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
}

export async function getNoteDetail(noteId: Id): Promise<NoteDetail | null> {
  return db.transaction('r', [db.notes, db.senses, db.cards], async () => {
    const note = await db.notes.get(noteId);
    if (!note) return null;
    const senses = (await db.senses.where('note_id').equals(noteId).toArray())
      .filter((s) => s.deleted_at === null)
      .sort((a, b) => a.sense_no - b.sense_no);
    const cards = (await db.cards.where('note_id').equals(noteId).toArray()).filter((c) => c.deleted_at === null);
    return { note, senses, cards };
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
