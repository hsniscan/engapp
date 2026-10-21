// Data actions of the connected features (sync engine, account linking, AI import, lexicon).
export * from './sync';
export * from './account';
export * from './import';
export { markCandidateKnown } from './smartExtract';
export {
  knownTermsProvider,
  setKnownTermsProvider,
  type KnownTermsProvider,
} from './knownTermsProvider';
export * from './lexicon';
