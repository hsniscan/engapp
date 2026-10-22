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
