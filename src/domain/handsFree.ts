// "Eller serbest" (v0.5 İP9, ADR 0051): a listening round for walking or driving. For each word:
// the English word is read, a short pause to recall it, then its Turkish meaning, then an
// example sentence. Practice only: it writes no FSRS state, no review_logs, no practice_logs
// and no encounters. Pure: the steps of the round; the screen plays them.

export interface HandsFreeItem {
  cardId: string;
  noteId: string;
  term: string;
  /** The Turkish meaning (the user's override first). */
  meaning: string;
  /** An English example sentence, a shared one first (its audio is pre-generated). */
  sentence: { text: string; tr: string | null } | null;
}

export type HandsFreeStep =
  | { kind: 'en'; text: string }
  | { kind: 'tr'; text: string }
  | { kind: 'sentence'; text: string }
  | { kind: 'pause'; ms: number };

/** Time to recall the meaning after the English word. */
export const RECALL_PAUSE_MS = 2500;
/** Between the meaning and the sentence. */
export const SHORT_PAUSE_MS = 700;
/** After the sentence, before the next word. */
export const NEXT_WORD_PAUSE_MS = 1500;
/** The round's size choices (same as the practice round). */
export const HANDS_FREE_SIZES = [10, 20] as const;

/** The hands-free round's URL: /practice?mode=audio&source=…&size=… (the practice sources). */
export function handsFreeHref(source: string, size: number): string {
  return `/practice?${new URLSearchParams({ mode: 'audio', source, size: String(size) }).toString()}`;
}

/** The steps of one word, in order. */
export function handsFreeSteps(item: HandsFreeItem): HandsFreeStep[] {
  const steps: HandsFreeStep[] = [
    { kind: 'en', text: item.term },
    { kind: 'pause', ms: RECALL_PAUSE_MS },
    { kind: 'tr', text: item.meaning },
  ];
  if (item.sentence?.text.trim()) {
    steps.push({ kind: 'pause', ms: SHORT_PAUSE_MS }, { kind: 'sentence', text: item.sentence.text });
  }
  steps.push({ kind: 'pause', ms: NEXT_WORD_PAUSE_MS });
  return steps;
}

/** What the screen shows during a step: the meaning from its step on, the sentence from its. */
export function revealedAt(steps: readonly HandsFreeStep[], stepIndex: number): { meaning: boolean; sentence: boolean } {
  const done = steps.slice(0, stepIndex + 1);
  return { meaning: done.some((s) => s.kind === 'tr'), sentence: done.some((s) => s.kind === 'sentence') };
}
