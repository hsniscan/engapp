// What the learner already knows, for smart extraction (v0.2 İP4). The words themselves live
// with İP3 (known_terms, `src/data/knownTerms.ts`: getKnownTermKeys / markKnown). Smart
// extraction only reads the keys and reports "Biliyorum" through this adapter, so it builds
// and runs before that table exists: the default knows nothing and remembers nothing beyond
// the preview row itself.
//
// Privacy: the keys are only compared on the device (data/smartExtract.ts); they are never
// part of an AI request.
//
// Wire-up after İP3 is merged (docs/decisions/0018):
//   import { getKnownTermKeys, markKnown } from './knownTerms';
//   const DEFAULT: KnownTermsProvider = { getKnownTermKeys, markKnown };

/** Where a "known" mark came from (İP3's known_terms.source). */
export type KnownTermSource = 'test' | 'preview' | 'manual' | 'auto';

export interface KnownTermsProvider {
  /** Normalised lemma keys (normalizeTerm) of words the learner marked known. */
  getKnownTermKeys(): Promise<Set<string>>;
  /** Remember a word as known (no card is made). */
  markKnown(term: string, source: KnownTermSource): Promise<void>;
}

const DEFAULT: KnownTermsProvider = {
  getKnownTermKeys: () => Promise.resolve(new Set<string>()),
  markKnown: () => Promise.resolve(),
};

let provider: KnownTermsProvider = DEFAULT;

/** The provider in use. */
export function knownTermsProvider(): KnownTermsProvider {
  return provider;
}

/** Replace the provider (tests; null restores the default). */
export function setKnownTermsProvider(p: KnownTermsProvider | null): void {
  provider = p ?? DEFAULT;
}
