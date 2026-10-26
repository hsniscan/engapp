// "Bugünün hikâyesi" (v0.5 İP8, decision 0050). Pure: which of the user's words go into the
// day's story, how the story is measured against what the user knows, and what is kept with
// the text for the reader (questions, glosses).
//
// The story is practice: it never writes FSRS fields or review_logs. Its words are counted as
// encounters ('story') when the reader opens it, like any other text.
import {
  MAX_STORY_AVOID,
  MIN_STORY_TARGETS,
  storyLemma,
  type StoryContent,
} from '../../supabase/functions/_shared/story-contract';
import { measureCoverage } from './coverage';
import { primaryRecognition } from './leech';
import { lemmaCounts, type TokenizedText } from './readerTokens';
import { cardStage } from './stages';
import {
  DIFFICULTY_BANDS,
  UNKNOWN_RATE_CAP,
  type CoverageResult,
  type ReadingDifficulty,
} from './texts';
import { CardState, type Card, type Id, type Millis, type Note } from './types';
import type { Knowledge } from './knowledgeModel';
import { isCountedWord } from './wordStages';

export { MIN_STORY_TARGETS };
/** Words asked for per story: enough to meet five, few enough to read naturally. */
export const STORY_TARGET_COUNT = 6;
/** "Newly learned": a word first answered or last studied in the last week. */
export const STORY_RECENT_MS = 7 * 24 * 60 * 60 * 1000;

/** One of the user's words picked for the story. */
export interface StoryCandidate {
  note_id: Id;
  /** term_norm, the dictionary form sent to the server. */
  lemma: string;
  /** Why it was picked: due today, or learned recently. */
  reason: 'due' | 'recent';
}

const SLOT = /\b(sth|sb|someone|something|somebody|one's)\b/;

/** A note term the story can ask for: a word or a short expression, no slots like "sth". */
export function storyLemmaOf(termNorm: string): string | null {
  if (SLOT.test(termNorm)) return null;
  const p = storyLemma.safeParse(termNorm);
  return p.success && p.data === termNorm ? p.data : null;
}

/**
 * The day's target words, best first: words due today (most overdue first), then words being
 * learned that were studied in the last week (most recent first). Only counted words with a
 * live, not suspended recognition card, at most STORY_TARGET_COUNT. Fewer than
 * MIN_STORY_TARGETS means there is no story today.
 */
export function selectStoryTargets(
  notes: readonly Pick<Note, 'id' | 'term_norm' | 'term_type' | 'deleted_at'>[],
  cards: readonly Card[],
  now: Millis,
  dayEnd: Millis,
  count = STORY_TARGET_COUNT,
): StoryCandidate[] {
  const byNote = new Map<Id, Card[]>();
  for (const c of cards) {
    if (c.deleted_at !== null) continue;
    const list = byNote.get(c.note_id);
    if (list) list.push(c);
    else byNote.set(c.note_id, [c]);
  }
  const due: { c: StoryCandidate; key: number }[] = [];
  const recent: { c: StoryCandidate; key: number }[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    if (!isCountedWord(n)) continue;
    const lemma = storyLemmaOf(n.term_norm);
    if (!lemma || seen.has(lemma)) continue;
    const rec = primaryRecognition(byNote.get(n.id) ?? []);
    if (!rec || rec.deleted_at !== null || rec.suspended || rec.state === CardState.New) continue;
    if (rec.due <= dayEnd) {
      seen.add(lemma);
      due.push({ c: { note_id: n.id, lemma, reason: 'due' }, key: rec.due });
      continue;
    }
    const stage = cardStage(rec);
    const last = rec.last_review ?? 0;
    if ((stage === 'learning' || stage === 'consolidating') && last >= now - STORY_RECENT_MS) {
      seen.add(lemma);
      recent.push({ c: { note_id: n.id, lemma, reason: 'recent' }, key: -last });
    }
  }
  const order = (a: { c: StoryCandidate; key: number }, b: { c: StoryCandidate; key: number }) =>
    a.key - b.key || a.c.lemma.localeCompare(b.c.lemma);
  return [...due.sort(order), ...recent.sort(order)].slice(0, count).map((x) => x.c);
}

// ---------------------------------------------------------------------------
// Coverage of a generated story
// ---------------------------------------------------------------------------

/**
 * How much of the story the user knows, without the target words: they are the lesson (marked
 * and glossed), so they never push a story over the user's difficulty.
 */
export function storyCoverage(
  text: TokenizedText,
  k: Knowledge,
  targets: readonly string[],
): CoverageResult {
  const skip = new Set(targets.flatMap((t) => [t, ...t.split(' ')]));
  const counts = lemmaCounts(text.tokens, (n) => k.lemmatize(n));
  for (const lemma of [...counts.keys()]) if (skip.has(lemma)) counts.delete(lemma);
  return measureCoverage(counts, k.pKnown);
}

/** The highest unknown share a story may have for this difficulty (never over the 10 % cap). */
export function storyLimit(difficulty: ReadingDifficulty): number {
  return Math.min(DIFFICULTY_BANDS[difficulty].max, UNKNOWN_RATE_CAP);
}

/** Over the limit: the words to avoid in the one regeneration, hardest first. */
export function storyAvoidList(c: CoverageResult): string[] {
  return c.unknownLemmas.filter((l) => storyLemma.safeParse(l).success).slice(0, MAX_STORY_AVOID);
}

// ---------------------------------------------------------------------------
// What the reader keeps with a story (texts.story)
// ---------------------------------------------------------------------------

export interface StoryTarget {
  note_id: Id;
  lemma: string;
  /** The word really occurs in the story (checked by the server). */
  used: boolean;
  /** Its Turkish meaning in the story, from the model; null when none came. */
  gloss_tr: string | null;
}

export interface StoryQuestionInfo {
  q: string;
  options: string[];
  /** 0-based index of the correct option. */
  answer: number;
}

export interface StoryInfo {
  /** The study day the story belongs to (YYYY-MM-DD, domain/day.ts). */
  day: string;
  prompt_version: string;
  targets: StoryTarget[];
  questions: StoryQuestionInfo[];
  /** Other words over the user's difficulty, glossed before the text; usually empty. */
  glossed: { lemma: string; gloss_tr: string }[];
  /** Unknown share measured on this device when the story was saved (without the targets). */
  unknown_rate: number;
}

/** Plain-text body of the story: paragraphs separated by a blank line (the reader's format). */
export function storyBody(story: Pick<StoryContent, 'paragraphs'>): string {
  return story.paragraphs.map((p) => p.trim()).join('\n\n');
}

/**
 * The story's extras for texts.story. `overLimit`: the coverage was still over the user's
 * difficulty after the regeneration, so its hardest words that the model glossed are shown
 * glossed before the text.
 */
export function storyInfo(
  story: StoryContent,
  candidates: readonly StoryCandidate[],
  day: string,
  promptVersion: string,
  coverage: CoverageResult,
  overLimit: boolean,
): StoryInfo {
  const gloss = new Map(story.glosses.map((g) => [g.lemma, g.gloss_tr]));
  const used = new Set(story.used_lemmas);
  const targets = candidates.map((c) => ({
    note_id: c.note_id,
    lemma: c.lemma,
    used: used.has(c.lemma),
    gloss_tr: gloss.get(c.lemma) ?? null,
  }));
  const targetSet = new Set(candidates.map((c) => c.lemma));
  const glossed = overLimit
    ? coverage.unknownLemmas
        .filter((l) => !targetSet.has(l) && gloss.has(l))
        .slice(0, 8)
        .map((l) => ({ lemma: l, gloss_tr: gloss.get(l)! }))
    : [];
  return {
    day,
    prompt_version: promptVersion,
    targets,
    questions: story.questions.map((q) => ({ q: q.q, options: [...q.options], answer: q.answer })),
    glossed,
    unknown_rate: Math.round(coverage.unknownRate * 10_000) / 10_000,
  };
}

/** Note ids the opening of a story counts as encounters: its used target words. */
export function storyEncounterNotes(info: StoryInfo | null | undefined): Id[] {
  return info ? info.targets.filter((t) => t.used).map((t) => t.note_id) : [];
}
