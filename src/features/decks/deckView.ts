// The suggested-deck view of the word bank (Keşfet's feed and its Desteler filter): each deck's
// words and the user's progress through them. No components here (fast refresh).
import { useMemo } from 'react';
import { CEFR } from '@/domain/level';
import {
  CONTENT_POS,
  deckProgress,
  deckWords,
  type DeckProgress,
  featuredSpec,
  forYouSpecs,
  multiPosLemmas,
  type OwnedIndex,
  PHRASE_KINDS,
  posLevelCounts,
  type SuggestedSpec,
  TOP_SIZES,
} from '@/domain/suggestedDecks';
import type { WordBankEntry } from '@/domain/wordBank';
import type { BankData } from './suggested';

export interface DeckCard {
  spec: SuggestedSpec;
  words: WordBankEntry[];
  progress: DeckProgress;
}

export const deckCard = (
  entries: readonly WordBankEntry[],
  idx: OwnedIndex,
  spec: SuggestedSpec,
  ff?: ReadonlySet<string>,
): DeckCard => {
  const words = deckWords(entries, spec, { falseFriends: ff });
  return { spec, words, progress: deckProgress(words, idx) };
};

/** The deck view of the word bank: featured, "Senin için", top sizes, levels, parts of speech. */
export function useDeckView(data: BankData | undefined) {
  return useMemo(() => {
    if (!data || data.entries.length === 0) return null;
    const { entries, idx, level } = data;
    const featured = featuredSpec(entries, idx, level);
    return {
      featured: featured ? deckCard(entries, idx, featured) : null,
      forYou: forYouSpecs(entries, idx, level, featured).map((x) => ({
        ...deckCard(entries, idx, x.spec),
        upLevel: x.upLevel,
      })),
      top: TOP_SIZES.map((size) => deckCard(entries, idx, { kind: 'top', size })),
      levels: CEFR.map((lv) => deckCard(entries, idx, { kind: 'level', level: lv })),
      pos: posLevelCounts(entries),
      ambiguous: multiPosLemmas(entries),
      levelPos: CONTENT_POS.map((pos) => deckCard(entries, idx, { kind: 'levelPos', level, pos })),
      // "Kalıplar" (decision 0074): only the kinds the bank has rows for, with their levels.
      phrases: PHRASE_KINDS.map((phrase) => ({
        all: deckCard(entries, idx, { kind: 'phrases', phrase }),
        levels: CEFR.map((lv) => deckCard(entries, idx, { kind: 'phrases', phrase, level: lv })).filter(
          (d) => d.words.length > 0,
        ),
      })).filter((p) => p.all.words.length > 0),
    };
  }, [data]);
}

