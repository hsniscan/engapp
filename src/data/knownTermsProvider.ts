// What the learner already knows, for smart extraction (v0.2 İP4). The words themselves live
// with İP3 (known_terms, `src/data/knownTerms.ts`: getKnownTermKeys / markKnown); smart
// extraction reads the keys and reports "Biliyorum" through this adapter. Both sides key a
// word by normalizeTerm (domain/normalize.ts), the same key as notes.term_norm.
//
// Privacy: the keys are only compared on the device (data/smartExtract.ts); they are never
// part of an AI request.
//
// İP4 was built before İP3 with a default that knew nothing; since the v0.2 merge the default
// is İP3's known_terms. Tests can still swap the provider.
import { getKnownTermKeys, markKnown } from './knownTerms';

/** Where a "known" mark from outside the level model can come from. */
export type KnownTermMarkSource = 'test' | 'preview' | 'manual';

export interface KnownTermsProvider {
  /** Normalised lemma keys (normalizeTerm) of words the learner marked known. */
  getKnownTermKeys(): Promise<Set<string>>;
  /** Remember a word as known (no card is made). */
  markKnown(term: string, source: KnownTermMarkSource): Promise<void>;
}

const DEFAULT: KnownTermsProvider = {
  getKnownTermKeys: () => getKnownTermKeys(),
  markKnown: async (term, source) => {
    await markKnown(term, source);
  },
};

let provider: KnownTermsProvider = DEFAULT;

/** The provider in use. */
export function knownTermsProvider(): KnownTermsProvider {
  return provider;
}

/** Replace the provider (tests; null restores the default, İP3's known_terms). */
export function setKnownTermsProvider(p: KnownTermsProvider | null): void {
  provider = p ?? DEFAULT;
}
