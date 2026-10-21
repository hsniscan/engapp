/*
 * ────────────────────────────────────────────────────────────────────────────────
 *  SEAM for "AI ile doldur" (owned by the AI agent; see docs/plan-v0.1.md, ai-enrich).
 * ────────────────────────────────────────────────────────────────────────────────
 * The manual add form (ManualAddForm.tsx) calls this hook with the typed term and renders
 * whatever it returns:
 *   - `available: false` hides the whole AI block (guest mode, no backend, or not wired yet).
 *   - `fill()` is the "AI ile doldur" button: look in lexicon_cache / the shared lexicon
 *     first and only call ai-enrich when the lexicon has nothing.
 *   - `senses` are listed (lexicon senses first); the user ticks one or more and each
 *     becomes its own sense row with `lexicon_sense_id` set.
 *   - `searchMore()` is "Başka anlam ara" (ai-enrich with more: true).
 * Replace the stub body below; keep the return type so the form keeps compiling.
 */

export interface LexiconSuggestion {
  lexicon_sense_id: string;
  lexicon_term_id: string | null;
  pos: string | null;
  gloss_en: string | null;
  meaning_tr: string;
  ipa: string | null;
  /** 'lexicon' = already in the shared dictionary (no AI call); 'ai' = just generated. */
  origin: 'lexicon' | 'ai';
}

export interface LexiconLookup {
  /** False hides the AI block entirely. */
  available: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
  senses: LexiconSuggestion[];
  /** Human-readable error (already translated) when status is 'error'. */
  error: string | null;
  /** "AI ile doldur": lexicon first, AI only when the lexicon has nothing. */
  fill: () => void;
  /** "Başka anlam ara": ask ai-enrich for senses the lexicon does not have yet. */
  searchMore: () => void;
  canSearchMore: boolean;
}

const STUB: LexiconLookup = {
  available: false,
  status: 'idle',
  senses: [],
  error: null,
  fill: () => {},
  searchMore: () => {},
  canSearchMore: false,
};

/** Lexicon/AI suggestions for a typed term. Stub: returns no senses until the AI agent wires it. */
export function useLexiconLookup(term: string): LexiconLookup {
  void term;
  return STUB;
}
