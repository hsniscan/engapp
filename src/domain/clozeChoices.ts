// Answer choices for a cloze card (Boşluk doldurma, redesign): the term and three other words
// from the user's own collection. Pure and deterministic for one showing of a card.
import { normalizeAnswer } from './answerCheck';
import { seededShuffle } from './practice';

export interface ChoiceCandidate {
  term: string;
  pos: string | null;
  /** Turkish meaning, shown after a wrong pick ("recently = son zamanlarda"). */
  meaning: string | null;
}

export interface ClozeChoice extends ChoiceCandidate {
  correct: boolean;
}

export const CHOICE_COUNT = 4;

/**
 * Up to three distractors: same part of speech first, then words of a similar length; never the
 * term itself or another spelling of it, never two of the same word. Null when the collection
 * has too few other words: the card is then answered by typing.
 */
export function pickClozeChoices(
  answer: ChoiceCandidate,
  candidates: readonly ChoiceCandidate[],
  seed: string,
): ClozeChoice[] | null {
  const key = normalizeAnswer(answer.term);
  const seen = new Set([key]);
  const pool: ChoiceCandidate[] = [];
  for (const c of seededShuffle(candidates, seed)) {
    const k = normalizeAnswer(c.term);
    // A multi-word answer keeps multi-word distractors and the other way round.
    if (!k || seen.has(k) || k.includes(' ') !== key.includes(' ')) continue;
    seen.add(k);
    pool.push(c);
  }
  if (pool.length < CHOICE_COUNT - 1) return null;
  const len = [...key].length;
  const score = (c: ChoiceCandidate) =>
    (answer.pos && c.pos === answer.pos ? 0 : 10) + Math.min(9, Math.abs([...c.term].length - len));
  // Stable sort keeps the seeded order among equals.
  const picked = pool
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, CHOICE_COUNT - 1)
    .map(({ c }) => ({ ...c, correct: false }));
  return seededShuffle([{ ...answer, correct: true }, ...picked], `${seed}:order`);
}
