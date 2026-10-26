// "Kelimelerimle metin oluştur" (v0.5.1, decision 0056). Pure: which of the user's words the
// picker suggests, the search over the rest, and the request built from a pick. The text itself
// comes from the daily story's pipeline (ai-story with source 'picked', data/pickedStory.ts).
//
// Privacy: the request carries the picked words' dictionary forms, the level, the difficulty,
// the interests, the form and the length, nothing else (buildPickedRequest; the snapshot test).
import {
  MAX_STORY_TARGETS,
  MIN_PICKED_TARGETS,
  type StoryGenre,
  type StoryLength,
  type StoryRequest,
} from '../../supabase/functions/_shared/story-contract';
import { normalizeTerm } from './normalize';
import { HARD_MIN_DIFFICULTY, HARD_MIN_LAPSES } from './practice';
import { storyLemmaOf } from './story';
import type { ReadingDifficulty } from './texts';
import {
  CardState,
  type Card,
  type CefrLevel,
  type Id,
  type Millis,
  type Note,
  type Sense,
} from './types';
import { isCountedWord } from './wordStages';

export { MIN_PICKED_TARGETS as MIN_PICKS, MAX_STORY_TARGETS as MAX_PICKS };
export type { StoryGenre, StoryLength };

/** Suggestions per list. */
export const PICK_LIST_SIZE = 8;

/** One of the user's words the picker can offer. */
export interface PickWord {
  note_id: Id;
  /** As the user wrote it. */
  term: string;
  /** The dictionary form sent to the server (term_norm). */
  lemma: string;
  /** The first meaning on the card (the user's override wins); null without one. */
  meaning: string | null;
}

export interface PickSuggestions {
  /** Tekrar zamanı gelenler: studied words due by the end of the day, most overdue first. */
  due: PickWord[];
  /** Zorlandıkların: lapses or a high difficulty, the hardest first. */
  hard: PickWord[];
  /** Son eklediklerin: newest notes first. */
  recent: PickWord[];
}

type NoteLike = Pick<Note, 'id' | 'term' | 'term_norm' | 'term_type' | 'deleted_at' | 'created_at'>;
type SenseLike = Pick<
  Sense,
  'note_id' | 'sense_no' | 'meaning_tr' | 'meaning_tr_override' | 'deleted_at'
>;
type CardLike = Pick<
  Card,
  | 'note_id'
  | 'deleted_at'
  | 'suspended'
  | 'state'
  | 'due'
  | 'lapses'
  | 'difficulty'
  | 'reps'
  | 'card_type'
>;

/** Every word the picker may offer: a counted word with a live card and a usable lemma. */
export function pickableWords(
  notes: readonly NoteLike[],
  cards: readonly CardLike[],
  senses: readonly SenseLike[],
): (PickWord & { created_at: Millis; cards: CardLike[] })[] {
  const byNote = new Map<Id, CardLike[]>();
  for (const c of cards) {
    if (c.deleted_at !== null) continue;
    const list = byNote.get(c.note_id);
    if (list) list.push(c);
    else byNote.set(c.note_id, [c]);
  }
  const meaning = new Map<Id, { no: number; text: string }>();
  for (const s of senses) {
    if (s.deleted_at !== null) continue;
    const text = (s.meaning_tr_override ?? s.meaning_tr).trim();
    if (!text) continue;
    const prev = meaning.get(s.note_id);
    if (!prev || s.sense_no < prev.no) meaning.set(s.note_id, { no: s.sense_no, text });
  }
  const seen = new Set<string>();
  const out: (PickWord & { created_at: Millis; cards: CardLike[] })[] = [];
  for (const n of notes) {
    if (!isCountedWord(n)) continue;
    const live = byNote.get(n.id);
    if (!live?.length) continue;
    const lemma = storyLemmaOf(n.term_norm);
    if (!lemma || seen.has(lemma)) continue;
    seen.add(lemma);
    out.push({
      note_id: n.id,
      term: n.term,
      lemma,
      meaning: meaning.get(n.id)?.text ?? null,
      created_at: n.created_at,
      cards: live,
    });
  }
  return out;
}

const plain = ({ note_id, term, lemma, meaning }: PickWord): PickWord => ({
  note_id,
  term,
  lemma,
  meaning,
});

const studied = (c: CardLike) => !c.suspended && c.state !== CardState.New && c.reps > 0;

/** The picker's three lists (each at most `size`, a word may be in more than one). */
export function pickSuggestions(
  notes: readonly NoteLike[],
  cards: readonly CardLike[],
  senses: readonly SenseLike[],
  dayEnd: Millis,
  size = PICK_LIST_SIZE,
): PickSuggestions {
  const words = pickableWords(notes, cards, senses);
  const due = words
    .map((w) => {
      const next = w.cards.filter(studied).reduce((m, c) => Math.min(m, c.due), Infinity);
      return { w, next };
    })
    .filter((x) => x.next <= dayEnd)
    .sort((a, b) => a.next - b.next || a.w.lemma.localeCompare(b.w.lemma))
    .slice(0, size)
    .map((x) => plain(x.w));
  const hard = words
    .map((w) => {
      const live = w.cards.filter(studied);
      const lapses = live.reduce((m, c) => Math.max(m, c.lapses), 0);
      const difficulty = live.reduce((m, c) => Math.max(m, c.difficulty), 0);
      return { w, lapses, difficulty };
    })
    .filter((x) => x.lapses >= HARD_MIN_LAPSES || x.difficulty >= HARD_MIN_DIFFICULTY)
    .sort(
      (a, b) =>
        b.lapses - a.lapses || b.difficulty - a.difficulty || a.w.lemma.localeCompare(b.w.lemma),
    )
    .slice(0, size)
    .map((x) => plain(x.w));
  const recent = [...words]
    .sort((a, b) => b.created_at - a.created_at || a.lemma.localeCompare(b.lemma))
    .slice(0, size)
    .map(plain);
  return { due, hard, recent };
}

/** Search over the user's words: the term or the meaning, starts-with first. */
export function searchPickable(words: readonly PickWord[], query: string, limit = 20): PickWord[] {
  const q = normalizeTerm(query);
  const qTr = query.trim().toLocaleLowerCase('tr');
  if (!q && !qTr) return [];
  const scored: { w: PickWord; rank: number }[] = [];
  for (const w of words) {
    const term = w.lemma;
    const meaning = (w.meaning ?? '').toLocaleLowerCase('tr');
    const rank = term.startsWith(q)
      ? 0
      : term.includes(q)
        ? 1
        : qTr && meaning.includes(qTr)
          ? 2
          : -1;
    if (rank >= 0) scored.push({ w, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.w.lemma.localeCompare(b.w.lemma))
    .slice(0, limit)
    .map((x) => plain(x.w));
}

export interface PickOptions {
  genre: StoryGenre;
  length: StoryLength;
  difficulty: ReadingDifficulty;
}

/** The ai-story request of a pick: these fields and nothing else leave the device. */
export function buildPickedRequest(
  picks: readonly Pick<PickWord, 'lemma'>[],
  opts: PickOptions,
  level: CefrLevel,
  interests: readonly string[],
): StoryRequest {
  return {
    source: 'picked',
    genre: opts.genre,
    length: opts.length,
    level,
    difficulty: opts.difficulty,
    interests: [...interests] as StoryRequest['interests'],
    target_lemmas: picks.map((p) => p.lemma),
  };
}

/** A pick the screen may send: 3–8 distinct words. */
export function validPick(count: number): boolean {
  return count >= MIN_PICKED_TARGETS && count <= MAX_STORY_TARGETS;
}
