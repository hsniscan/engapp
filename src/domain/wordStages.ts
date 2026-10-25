// Word-level stage counts for Bugün, İlerleme and the weekly report (ADR 0041). Pure.
//
// A word is a live note of term type word / phrase / pattern (affix roots and "karıştırılanlar"
// contrast notes are left out). Its stage is the stage of its primary recognition card; it is
// "Aktif" when one of its live production cards is learned or mastered. Suspended cards keep
// their stage and count. Cloze and picture cards never count, nor do "Biliyorum" known_terms.
import { primaryRecognition } from './leech';
import { cardStage, isLearnedStage, type WordStage } from './stages';
import { type Card, type Id, type KnownTerm, type Millis, type Note, recognitionOnly } from './types';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface WordStageCounts {
  new: number;
  learning: number;
  consolidating: number;
  learned: number;
  mastered: number;
  /** learned + mastered. */
  learnedTotal: number;
  /** Words whose recognition card first reached Öğrenildi in the last 7 days. */
  weekDelta: number;
  /** Words with a production card at Öğrenildi or Kalıcı. */
  active: number;
  /** Live "Biliyorum" known_terms; never part of learnedTotal. */
  alreadyKnown: number;
}

/** Notes that count as words in the learned count. */
export function isCountedWord(note: Pick<Note, 'term_type' | 'deleted_at'>): boolean {
  return note.deleted_at === null && !recognitionOnly(note.term_type);
}

export interface WordStageInfo {
  stage: WordStage;
  learnedAt: Millis | null;
  active: boolean;
}

/** Stage, learned_at and Aktif badge of each counted note that has a live recognition card. */
export function wordStagesByNote(
  notes: Iterable<Pick<Note, 'id' | 'term_type' | 'deleted_at'>>,
  cards: Iterable<Card>,
): Map<Id, WordStageInfo> {
  const byNote = new Map<Id, Card[]>();
  for (const c of cards) {
    if (c.deleted_at !== null) continue;
    const list = byNote.get(c.note_id);
    if (list) list.push(c);
    else byNote.set(c.note_id, [c]);
  }
  const out = new Map<Id, WordStageInfo>();
  for (const note of notes) {
    if (!isCountedWord(note)) continue;
    const list = byNote.get(note.id);
    if (!list) continue;
    const rec = primaryRecognition(list);
    if (!rec) continue;
    const active = list.some((c) => c.card_type === 'production' && isLearnedStage(cardStage(c)));
    out.set(note.id, { stage: cardStage(rec), learnedAt: rec.learned_at ?? null, active });
  }
  return out;
}

export function countWordStages(
  notes: Iterable<Pick<Note, 'id' | 'term_type' | 'deleted_at'>>,
  cards: Iterable<Card>,
  knownTerms: Iterable<Pick<KnownTerm, 'deleted_at'>>,
  now: Millis,
): WordStageCounts {
  const counts: WordStageCounts = {
    new: 0,
    learning: 0,
    consolidating: 0,
    learned: 0,
    mastered: 0,
    learnedTotal: 0,
    weekDelta: 0,
    active: 0,
    alreadyKnown: 0,
  };
  for (const info of wordStagesByNote(notes, cards).values()) {
    counts[info.stage]++;
    if (info.learnedAt !== null && info.learnedAt > now - WEEK_MS && info.learnedAt <= now) counts.weekDelta++;
    if (info.active) counts.active++;
  }
  counts.learnedTotal = counts.learned + counts.mastered;
  for (const k of knownTerms) if (k.deleted_at === null) counts.alreadyKnown++;
  return counts;
}

/** Stage distribution of the cards of one type (İlerleme: one bar per study mode). */
export function cardStageDistribution(cards: Iterable<Card>, types: readonly Card['card_type'][]): Record<WordStage, number> {
  const out: Record<WordStage, number> = { new: 0, learning: 0, consolidating: 0, learned: 0, mastered: 0 };
  for (const c of cards) {
    if (c.deleted_at !== null || !types.includes(c.card_type)) continue;
    if (c.card_type !== 'recognition' && !c.unlocked) continue;
    out[cardStage(c)]++;
  }
  return out;
}
