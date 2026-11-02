// How the reader draws a word (v0.5 İP1; Çam look v0.5.2, docs/design.md §4.13). Calm on
// purpose (plan risk "çok renkli ve yorucu"): known and learned words have no mark at all,
// likely-new words a soft pine wash with a dotted underline, words being learned a solid pine
// underline and words settling in a faint one. The marks are never the only cue: each marked
// word is described to screen readers ("yeni kelime"), the word sheet says the stage in words,
// and the colours can be switched off.
import type { WordMark } from '@/domain/readerView';

export const MARK_CLASS: Record<WordMark, string> = {
  new: 'bg-accent-soft text-accent-text underline decoration-accent-text decoration-dotted decoration-2 underline-offset-[5px]',
  learning: 'underline decoration-accent-text/60 decoration-2 underline-offset-[5px]',
  consolidating: 'underline decoration-accent-text/25 decoration-2 underline-offset-[5px]',
  plain: '',
};

/** The hidden description each marked word points at (aria-describedby). */
export const MARK_DESCRIPTION_ID = {
  new: 'reader-mark-new',
  learning: 'reader-mark-learning',
  consolidating: 'reader-mark-consolidating',
  target: 'reader-mark-target',
} as const;
