// What the user knows, per lemma (v0.5 contract, decision 0043). STUB: the reader package
// (İP1) replaces the body with the real model (word stages, known_terms, the level model);
// the signature stays so the library (İP5) and the story (İP8) can build against it now.
export interface Knowledge {
  /** Dictionary form of a running word ("went" → "go"); lower case. */
  lemmatize(word: string): string;
  /** Probability 0..1 that the user knows the lemma. */
  pKnown(lemma: string): number;
}

export async function loadKnowledge(): Promise<Knowledge> {
  return {
    lemmatize: (word) => word.toLowerCase(),
    pKnown: () => 0.5,
  };
}
