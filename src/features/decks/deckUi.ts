// Constants and helpers shared by the Desteler screens (no components here, for fast refresh).
import type { DeckFilter } from '@/domain/deckFilter';
import type { CefrLevel } from '@/domain/types';

/**
 * Graphic colours (bars, ring, level ramp) for both themes. Non-text marks, so they live here
 * rather than in the contrast-checked text tokens; each mark also has a text equivalent.
 */
export const MARK = {
  /** Öğrenildi / known part. */
  learned: 'light-dark(#2a5a8c, #9dbde3)',
  /** Öğreniyor / in the cards. */
  studying: 'light-dark(#9dbde3, #4a77a8)',
  /** Empty track. */
  track: 'light-dark(#ede9e1, #34312d)',
  /** Track on an accent-soft or warn-soft card. */
  trackOnSoft: 'light-dark(#fdfcf9, #1a1917)',
  /** Fill of a part the user has not started. */
  faint: 'light-dark(#d7d1c6, #4a463f)',
} as const;

/** A1 → C2, dark to light (light theme) and light to dark (dark theme). */
export const LEVEL_MARK: Record<CefrLevel, string> = {
  A1: 'light-dark(#1f3f63, #dbe6f3)',
  A2: 'light-dark(#2a5a8c, #9dbde3)',
  B1: 'light-dark(#5b87b8, #6f9acb)',
  B2: 'light-dark(#9dbde3, #4a77a8)',
  C1: 'light-dark(#c9d9ec, #36597f)',
  C2: 'light-dark(#d7d1c6, #5a554d)',
};

export const nf = new Intl.NumberFormat('tr-TR');
export const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

/** Word frequency as 1–5 dots (Zipf: 5 ≈ the 1,000 most common words). */
export function freqDots(zipf: number | null): number {
  if (zipf === null) return 1;
  if (zipf >= 5) return 5;
  if (zipf >= 4.5) return 4;
  if (zipf >= 4) return 3;
  if (zipf >= 3.5) return 2;
  return 1;
}

/**
 * "Çalış" of a deck: today's word study of its words only (due and new cards, under the daily
 * limits). A practice round over the deck stays on the old address (practiceHref).
 */
export const deckStudyHref = (deckId: string) =>
  `/study?mode=word&deck=${encodeURIComponent(deckId)}`;

/** The single tag of a hand-picked or suggested deck, if the filter is just that. */
export function soleTag(f: DeckFilter | null): string | null {
  if (!f || f.tags?.length !== 1) return null;
  if (f.states?.length || f.levels?.length || f.topics?.length || f.addedWithinDays) return null;
  return f.tags[0]!;
}

export const DECK_TABS = ['mine', 'discover', 'bank', 'reading'] as const;
export type DeckTab = (typeof DECK_TABS)[number];

export function parseDeckTab(raw: string | null): DeckTab {
  return (DECK_TABS as readonly string[]).includes(raw ?? '') ? (raw as DeckTab) : 'mine';
}

export const deckTabHref = (tab: DeckTab) => (tab === 'mine' ? '/decks' : `/decks?tab=${tab}`);
