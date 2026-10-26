// How the reader draws a word (v0.5 İP1). Calm on purpose (plan risk "çok renkli ve yorucu"):
// known and learned words have no mark at all, words being learned a thin underline, and only
// likely-new words a soft wash. The marks are never the only cue: the word sheet says the
// stage in words, and the colours can be switched off.
import type { WordMark } from '@/domain/readerView';

export const MARK_CLASS: Record<WordMark, string> = {
  new: 'rounded-[3px] bg-[color-mix(in_oklab,var(--warn)_15%,transparent)] underline decoration-[color-mix(in_oklab,var(--warn)_70%,transparent)] decoration-[1.5px] underline-offset-[5px]',
  learning:
    'underline decoration-dotted decoration-accent-text decoration-[2px] underline-offset-[5px]',
  consolidating:
    'underline decoration-[color-mix(in_oklab,var(--accent-text)_40%,transparent)] decoration-[1.5px] underline-offset-[5px]',
  plain: '',
};
