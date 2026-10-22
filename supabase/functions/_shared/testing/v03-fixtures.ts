// Representative model answers for the v0.3 İP2 prompts (mnemonic-v1, extract-v5), written
// by hand in the shape the prompts ask for (decision 0020). No test calls the real API: the
// free Gemini quota is shared with production, so these stand in for recordings until the
// weekly golden check records real answers.

import { GOOD_EXTRACT } from './gemini-fixtures.ts';

/** "reluctant" (isteksiz): one sound and one image mnemonic. */
export const MNEMONIC_RELUCTANT = {
  mnemonics: [
    {
      type: 'sound',
      text_tr: 'Rölantide kalan motor gibi isteksiz: reluctant biri harekete geçmek istemez.',
      why: 'reluctant ile rölanti aynı seslerle başlar.',
    },
    {
      type: 'image',
      text_tr: 'Yataktan çıkmak istemeyen bir kediyi düşün; reluctant onun yüzündeki isteksiz ifadedir.',
      why: 'Gözünde canlanan isteksiz kedi anlamı hatırlatır.',
    },
  ],
};

/** "Başka öner" for reluctant: one new story, one repeat of an earlier suggestion. */
export const MNEMONIC_RELUCTANT_MORE = {
  mnemonics: [
    {
      type: 'story',
      text_tr: 'Ali yağmurda koşuya çıkmaya pek reluctant, yani isteksiz; ayakkabısını yavaş yavaş bağlıyor.',
      why: 'Kısa bir sahne isteksizliği gösterir.',
    },
    {
      type: 'sound',
      text_tr: 'Rölantide kalan motor gibi isteksiz: reluctant biri harekete geçmek istemez!',
      why: 'Aynı ses benzerliği.',
    },
  ],
};

/** The model found no good association ("bu kelime için iyi bir çağrışım yok"). */
export const MNEMONIC_NONE = { mnemonics: [] };

/** Every item breaks one server rule. */
export const MNEMONIC_INVALID = {
  mnemonics: [
    { type: 'joke', text_tr: 'Reluctant isteksiz demektir, bir şaka gibi düşün.', why: '' },
    { type: 'story', text_tr: 'The engine is idle, so the reluctant man waits for the bus.', why: 'English' },
    { type: 'story', text_tr: 'Motor rölantide kalınca adam da isteksiz bekliyor.', why: 'Kelime yok.' },
    { type: 'image', text_tr: 'Kısa.', why: '' },
    { type: 'image', text_tr: `${'Uzun bir hikâye reluctant ile başlar ve çok uzun sürer, '.repeat(5)}sonu gelmez.`, why: '' },
    { type: 'story', text_tr: 'Visit https://example.com for reluctant ipuçları ve daha fazlası.', why: '' },
    { text_tr: 'Türü eksik reluctant anımsatıcısı burada.', why: '' },
  ],
};

/**
 * extract-v5 answer for gemini-fixtures CHUNK: GOOD_EXTRACT plus topics and false_friend_tr.
 * "bank" (river) ~ "banka" is a real trap for this sense; "turn down" gets a made-up look-alike
 * that does not sound like it; "give up" gets a translation, not a look-alike.
 */
export const EXTRACT_V5 = {
  topics: ['Daily life', 'business', 'science'],
  candidates: [
    { ...GOOD_EXTRACT.candidates[0]!, false_friend_tr: { tr_word: 'bırakmak', tr_meaning_tr: 'terk etmek', strength: 'full', note_tr: null } },
    {
      ...GOOD_EXTRACT.candidates[1]!,
      false_friend_tr: {
        tr_word: 'Banka',
        tr_meaning_tr: 'para kurumu',
        strength: 'partial',
        note_tr: 'Bu anlamda "bank" kıyı demektir, banka değil.',
      },
    },
    { ...GOOD_EXTRACT.candidates[2]!, false_friend_tr: { tr_word: 'dönemeç', tr_meaning_tr: 'viraj', strength: 'full', note_tr: null } },
  ],
};
