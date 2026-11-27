import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { NONE_KEY } from '@/domain/retention';
import { groupLabel, weakestGroupLabel } from './groupLabel';

const t = i18n.t.bind(i18n);

describe('weakestGroupLabel', () => {
  it('names the weakest group in the plural with at most one pair of brackets', () => {
    expect(weakestGroupLabel(t, { dimension: 'pos', key: 'phrasal verb' }, {})).toBe(
      'deyimsel fiiller (phrasal verb)',
    );
    expect(weakestGroupLabel(t, { dimension: 'term_type', key: 'phrase' }, {})).toBe(
      'söz öbekleri',
    );
    expect(weakestGroupLabel(t, { dimension: 'level', key: 'B2' }, {})).toBe('B2 kelimeler');
    expect(
      t('progress.groups.weakest', { group: 'deyimsel fiiller (phrasal verb)', rate: '%89' }),
    ).toBe('En zayıf noktan: deyimsel fiiller (phrasal verb), %89');
  });

  it('falls back to the list label', () => {
    expect(weakestGroupLabel(t, { dimension: 'source', key: 's1' }, { s1: 'BBC' })).toBe('BBC');
    expect(weakestGroupLabel(t, { dimension: 'pos', key: NONE_KEY }, {})).toBe(
      groupLabel(t, { dimension: 'pos', key: NONE_KEY }, {}),
    );
  });

  it('keeps the two dimensions apart in Turkish', () => {
    expect(t('progress.groups.dimensions.term_type')).not.toBe(t('progress.groups.dimensions.pos'));
    expect(t('progress.groups.dimensions.term_type')).toBe('Kelime / öbek / kalıp');
  });
});
