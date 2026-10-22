// Representative model answers for the contrast-v1 prompt (ai-contrast, v0.3 İP6), written by
// hand in the shape Gemini returns. Tests use these instead of live calls: the free Gemini
// quota is shared with production.

/** "affect" (etkilemek) / "effect" (etki). */
export const CONTRAST_AFFECT_EFFECT = {
  a_sentence_en: 'Lack of sleep can affect your mood.',
  a_sentence_tr: 'Uykusuzluk ruh halini etkileyebilir.',
  b_sentence_en: 'The new rule had a big effect on prices.',
  b_sentence_tr: 'Yeni kuralın fiyatlar üzerinde büyük bir etkisi oldu.',
  difference_tr: 'affect bir fiildir (etkilemek), effect ise bir isimdir (etki).',
};

/** Answers the server must refuse, one reason each (a = affect, b = effect). */
export const CONTRAST_INVALID: { reason: string; data: unknown }[] = [
  { reason: 'invalid_shape', data: { a_sentence_en: 'x' } },
  {
    reason: 'term_missing',
    data: { ...CONTRAST_AFFECT_EFFECT, a_sentence_en: 'Lack of sleep can change your mood.' },
  },
  {
    reason: 'both_terms',
    data: { ...CONTRAST_AFFECT_EFFECT, a_sentence_en: 'Stress can affect you, and the effect lasts.' },
  },
  { reason: 'sentence_length', data: { ...CONTRAST_AFFECT_EFFECT, b_sentence_en: 'An effect.' } },
  { reason: 'bad_sentence', data: { ...CONTRAST_AFFECT_EFFECT, b_sentence_en: '<b>effect</b> on prices was big' } },
  {
    reason: 'difference_terms',
    data: { ...CONTRAST_AFFECT_EFFECT, difference_tr: 'Birincisi fiildir, ikincisi ise bir isimdir.' },
  },
  {
    reason: 'not_turkish',
    data: { ...CONTRAST_AFFECT_EFFECT, difference_tr: 'affect is a verb and effect is the noun of it.' },
  },
  { reason: 'difference_length', data: { ...CONTRAST_AFFECT_EFFECT, difference_tr: 'fark yok' } },
];
