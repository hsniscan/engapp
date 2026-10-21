import type { TFunction } from 'i18next';
import type { DeckFilter } from '@/domain/deckFilter';

/** One line describing a deck's filter: "Öğreniliyor, Zorlandıklarım · #iş · son 7 günde eklenen". */
export function describeDeckFilter(t: TFunction, f: DeckFilter | null): string {
  if (!f) return t('decks.needsUpdate');
  const parts: string[] = [];
  if (f.states?.length) parts.push(f.states.map((s) => t(`decks.state.${s}`)).join(', '));
  if (f.tags?.length) {
    const tags = f.tags.map((x) => `#${x}`).join(', ');
    parts.push(f.tagMode === 'all' ? t('decks.tagsAll', { tags }) : t('decks.tagsAny', { tags }));
  }
  if (f.levels?.length) parts.push(t('decks.levels', { levels: f.levels.join(', ') }));
  if (f.topics?.length) parts.push(t('decks.topics', { count: f.topics.length }));
  if (f.addedWithinDays) parts.push(t('decks.addedWithin', { count: f.addedWithinDays }));
  return parts.length ? parts.join(' · ') : t('decks.allWords');
}
