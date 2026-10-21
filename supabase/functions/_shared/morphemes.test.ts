import { describe, expect, it } from 'vitest';
import { MORPHEME_SYSTEM_PROMPT, morphemeUserMessage, validateMorphemeAnswer, type MorphemeJobItem } from './morphemes';

const items: MorphemeJobItem[] = [
  { id: 'spect', form: '-spect-', kind: 'root', origin: 'latin', gloss_en: 'look, see', examples: ['inspect', 'respect'] },
  { id: '-ness', form: '-ness', kind: 'suffix', origin: 'germanic', gloss_en: 'state', examples: ['kindness'] },
  { id: 're-', form: 're-', kind: 'prefix', origin: 'latin', gloss_en: 'again', examples: ['redo'] },
];

describe('morpheme-tr-v1', () => {
  it('sends reference data only', () => {
    expect(JSON.parse(morphemeUserMessage(items))).toEqual({ items });
    expect(MORPHEME_SYSTEM_PROMPT).toContain('never invent English words');
  });

  it('accepts clean Turkish answers and trims a trailing full stop', () => {
    const { accepted, rejected } = validateMorphemeAnswer(items, {
      items: [
        { id: 'spect', meaning_tr: 'bakmak, görmek.', note_tr: 'inspect (denetlemek) = içine bakmak.' },
        { id: '-ness', meaning_tr: 'durum, nitelik', note_tr: '' },
        { id: 're-', meaning_tr: 'yeniden', note_tr: 'redo (yeniden yapmak).' },
      ],
    });
    expect(rejected).toEqual([]);
    expect(accepted.get('spect')).toEqual({ meaning_tr: 'bakmak, görmek', note_tr: 'inspect (denetlemek) = içine bakmak.' });
    expect(accepted.get('-ness')).toEqual({ meaning_tr: 'durum, nitelik', note_tr: null });
  });

  it('rejects long, odd or missing answers and ignores unknown or repeated ids', () => {
    const { accepted, rejected } = validateMorphemeAnswer(items, {
      items: [
        { id: 'spect', meaning_tr: 'bir şeye dikkatle uzun uzun bakmak ve görmek', note_tr: '' },
        { id: '-ness', meaning_tr: '<b>durum</b>', note_tr: '' },
        { id: 'other', meaning_tr: 'x', note_tr: '' },
        { id: 're-', meaning_tr: 'yeniden', note_tr: '' },
        { id: 're-', meaning_tr: 'tekrar', note_tr: '' },
      ],
    });
    expect([...accepted.keys()]).toEqual(['re-']);
    expect(accepted.get('re-')?.meaning_tr).toBe('yeniden');
    expect(rejected).toEqual([
      { id: 'spect', reason: 'meaning_tr missing or too long' },
      { id: '-ness', reason: 'unexpected characters' },
    ]);
    expect(validateMorphemeAnswer(items, null).rejected.map((r) => r.reason)).toEqual(Array(3).fill('missing in answer'));
  });
});
