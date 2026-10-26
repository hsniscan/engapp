// The typed-answer check of the study cards (v0.5 İP9, ADR 0051): the pure check
// (domain/answerCheck.ts), plus a dictionary lookup when the answer is not the term itself, so
// another word for the same meaning counts as right.
import type { CardView } from '@/data';
import { findSynonyms } from '@/data/synonyms';
import { type AnswerCheck, checkAnswer } from '@/domain/answerCheck';
import { meaningOf } from './study';

/**
 * Checks `typed` against `answer` (the term, or the form the sentence uses). Resolves quickly
 * and never rejects: a failed lookup leaves the plain verdict.
 */
export async function checkTypedAnswer(
  typed: string,
  view: Pick<CardView, 'note' | 'sense'>,
  answer: string = view.note.term,
): Promise<AnswerCheck> {
  const plain = checkAnswer(typed, answer);
  if (plain.verdict !== 'wrong' && plain.verdict !== 'close') return plain;
  const sense = view.sense;
  const synonyms = await findSynonyms(typed, {
    term: view.note.term,
    pos: sense?.pos ?? null,
    meaning: sense ? meaningOf(sense) : null,
  });
  return synonyms.length ? checkAnswer(typed, answer, { synonyms }) : plain;
}
