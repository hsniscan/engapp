import type { TFunction } from 'i18next';
import { type GroupRetention, NONE_KEY } from '@/domain/retention';

/** Display name of a retention group: "Söz öbeği", "B2", "Seyahat", a source title… */
export function groupLabel(
  t: TFunction,
  g: Pick<GroupRetention, 'dimension' | 'key'>,
  sourceTitles: Record<string, string>,
): string {
  if (g.key === NONE_KEY && g.dimension !== 'term_type' && g.dimension !== 'card_type')
    return t(`progress.groups.none.${g.dimension}`);
  switch (g.dimension) {
    case 'term_type':
      return t(`cards.termType.${g.key}` as 'cards.termType.word', { defaultValue: g.key });
    case 'card_type':
      return t(`cards.cardType.${g.key}` as 'cards.cardType.recognition', { defaultValue: g.key });
    case 'level':
      return g.key;
    case 'topic':
      return t(`topics.${g.key}` as 'topics.travel', { defaultValue: g.key });
    case 'source':
      return sourceTitles[g.key] ?? t('progress.groups.unknownSource');
    case 'pos':
      return t(`cards.pos.${g.key}` as 'cards.pos.noun', { defaultValue: g.key });
  }
}

/**
 * The group as "En zayıf noktan: …" names it: plural where the dimension has one
 * ("deyimsel fiiller (phrasal verb)", "söz öbekleri", "B2 kelimeler"), else the list label.
 */
export function weakestGroupLabel(
  t: TFunction,
  g: Pick<GroupRetention, 'dimension' | 'key'>,
  sourceTitles: Record<string, string>,
): string {
  const label = groupLabel(t, g, sourceTitles);
  if (g.key === NONE_KEY) return label;
  switch (g.dimension) {
    case 'term_type':
    case 'pos':
    case 'card_type':
      return t(
        `progress.groups.plural.${g.dimension}.${g.key}` as 'progress.groups.plural.pos.noun',
        {
          defaultValue: label,
        },
      );
    case 'level':
      return t('progress.groups.plural.level', { level: label });
    default:
      return label;
  }
}
