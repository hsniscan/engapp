// Constants and helpers shared by the Kelimelerim screens (no components here, for fast refresh).
// Colours come only from the design tokens (stage scale, docs/design.md); none are defined here.
import type { DeckFilter } from '@/domain/deckFilter';
import { openAddSheet } from '@/features/add/addSheetStore';
import type { CefrLevel } from '@/domain/types';
import { stageColor, type UiStage } from '@/ui';

export const nf = new Intl.NumberFormat('tr-TR');
export const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

/**
 * "Çalış" of a deck: today's word study of its words only (due and new cards, under the daily
 * limits). A practice round over the deck stays on the old address (practiceHref).
 */
export const deckStudyHref = (deckId: string) =>
  `/study?mode=word&deck=${encodeURIComponent(deckId)}`;

/** The single tag of a hand-picked or suggested deck, if the filter is just that. */
export function soleTag(f: DeckFilter | null): string | null {
  if (!f || f.tags?.length !== 1) return null;
  if (f.states?.length || f.stages?.length || f.levels?.length || f.topics?.length || f.addedWithinDays) return null;
  return f.tags[0]!;
}

/** Kelimelerim's segments (v0.5.1): the old discover / reading segments are in Keşfet. */
export const DECK_TABS = ['mine', 'bank'] as const;
export type DeckTab = (typeof DECK_TABS)[number];

export function parseDeckTab(raw: string | null): DeckTab {
  return (DECK_TABS as readonly string[]).includes(raw ?? '') ? (raw as DeckTab) : 'mine';
}

export const deckTabHref = (tab: DeckTab) => (tab === 'mine' ? '/decks' : `/decks?tab=${tab}`);

/** Keşfet with its suggested decks (the old Desteler › Keşfet segment). */
export const DISCOVER_DECKS_HREF = '/kesfet?f=desteler';

/**
 * Opens the (+) sheet at its "İçe aktar" group. The sheet takes the group as an optional
 * argument (v0.5.1 Add rework); a sheet without groups ignores it and opens as usual.
 */
export const openImportSheet = () => openAddSheet('import');


/** CEFR levels on the stage ramp: A1 the deepest swatch, C1/C2 the lightest. */
const LEVEL_STAGE: Record<CefrLevel, UiStage> = {
  A1: 'mastered',
  A2: 'learned',
  B1: 'consolidating',
  B2: 'learning',
  C1: 'new',
  C2: 'new',
};

/** Swatch colour of a CEFR level (a non-text mark; the level name is always written next to it). */
export const levelColor = (level: CefrLevel) => stageColor[LEVEL_STAGE[level]];


