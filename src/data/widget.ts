// What the Android widget and the answerable reminder read from the local database
// (docs/decisions/0048-widget-notification-answers.md). The rules are pure (domain/widget.ts,
// domain/notificationAnswer.ts); this file only gathers their input from Dexie.
import { dayEndMs, dayKeyOf } from '../domain/day';
import { primaryRecognition } from '../domain/leech';
import { pickReminderCards, type ReminderCardCandidate } from '../domain/notificationAnswer';
import { cardStage } from '../domain/stages';
import type { Card, Id, Millis, Sense } from '../domain/types';
import {
  buildWidgetState,
  meaningOf,
  WORD_OF_DAY_STAGES,
  type WidgetDay,
  type WidgetState,
  type WordCandidate,
} from '../domain/widget';
import { db } from './db';
import { getStudyQueue } from './queries';
import { dayConfig, getSettings } from './settings';

interface WordRow {
  card: Card;
  term: string;
  senses: Sense[];
}

/** Each live note's primary recognition card with its term and live senses. */
async function recognitionWords(): Promise<WordRow[]> {
  const cards = await db.cards.where('card_type').equals('recognition').toArray();
  const byNote = new Map<Id, Card[]>();
  for (const c of cards) {
    const list = byNote.get(c.note_id);
    if (list) list.push(c);
    else byNote.set(c.note_id, [c]);
  }
  const noteIds = [...byNote.keys()];
  const [notes, senses] = await Promise.all([
    db.notes.bulkGet(noteIds),
    db.senses.where('note_id').anyOf(noteIds).toArray(),
  ]);
  const sensesByNote = new Map<Id, Sense[]>();
  for (const s of senses) {
    if (s.deleted_at !== null) continue;
    const list = sensesByNote.get(s.note_id);
    if (list) list.push(s);
    else sensesByNote.set(s.note_id, [s]);
  }
  const out: WordRow[] = [];
  for (const note of notes) {
    if (!note || note.deleted_at !== null) continue;
    const card = primaryRecognition(byNote.get(note.id) ?? []);
    if (!card || card.deleted_at !== null || card.suspended) continue;
    out.push({ card, term: note.term, senses: sensesByNote.get(note.id) ?? [] });
  }
  return out;
}

async function wordDay(at: Millis): Promise<Omit<WidgetDay, 'word'>> {
  const q = await getStudyQueue({ studyMode: 'word', learnAheadMs: 0 }, at);
  return {
    day: q.day,
    due: q.counts.learning + q.counts.review,
    new_count: q.counts.new,
    day_end: q.dayEnd,
  };
}

/**
 * The widget's state now. Tomorrow's count is the queue as it will look when tomorrow starts
 * (cards due by its end), so a phone whose app stays closed overnight still shows a fair number.
 */
export async function getWidgetState(
  previous: WidgetState | null,
  now: Millis = Date.now(),
): Promise<WidgetState> {
  const settings = await getSettings(now);
  const cfg = dayConfig(settings);
  const todayKey = dayKeyOf(now, cfg);
  const today = await wordDay(now);
  // The first instant of tomorrow: dayEnd belongs to the next day.
  const tomorrow = await wordDay(dayEndMs(todayKey, cfg));
  const candidates: WordCandidate[] = (await recognitionWords())
    .map((w) => ({
      note_id: w.card.note_id,
      term: w.term,
      stage: cardStage(w.card),
      senses: w.senses,
    }))
    .filter((c) => WORD_OF_DAY_STAGES.includes(c.stage) || c.note_id === previous?.word?.note_id);
  return buildWidgetState({ today, tomorrow, candidates, previous, now });
}

/**
 * One due recognition card for each planned reminder time (or null): what the notification asks.
 */
export async function getReminderCards(
  ats: readonly Millis[],
): Promise<(ReminderCardCandidate | null)[]> {
  if (ats.length === 0) return [];
  const words = await recognitionWords();
  const candidates: ReminderCardCandidate[] = words
    .filter((w) => w.card.unlocked)
    .map((w) => ({
      card_id: w.card.id,
      due: w.card.due,
      state: w.card.state,
      term: w.term,
      meaning: meaningOf(w.senses),
    }));
  return pickReminderCards(candidates, ats);
}
