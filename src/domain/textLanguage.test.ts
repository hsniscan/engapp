import { describe, expect, it } from 'vitest';
import { guessTextLanguage, looksTurkishTerm } from './textLanguage';

describe('guessTextLanguage', () => {
  it('a Turkish paragraph is Turkish (review 2026-11-26 #8)', () => {
    expect(
      guessTextLanguage(
        'Bugün sabah erkenden kalktım ve parka yürüyüşe gittim. Hava çok güzeldi, ' +
          'ama biraz soğuktu. Sonra bir kafede kahve içtim ve kitabımı okudum.',
      ),
    ).toBe('tr');
  });

  it('Turkish typed without Turkish letters is still Turkish', () => {
    expect(
      guessTextLanguage(
        'Bu metin cok guzel ve ben bunu okumak icin biraz zaman ayirdim ama hic bitmedi.',
      ),
    ).toBe('tr');
  });

  it('an English text is English, also with Turkish names and capitals', () => {
    expect(
      guessTextLanguage(
        'I moved to İstanbul last year. It is a big city, and I love the ferries on the ' +
          'Bosphorus. My friend Çağlar showed me the old market in Kadıköy.',
      ),
    ).toBe('en');
    expect(
      guessTextLanguage(
        'IT WAS THE BEST OF TIMES, IT WAS THE WORST OF TIMES, IT WAS THE AGE OF WISDOM.',
      ),
    ).toBe('en');
  });

  it('a list of English words, a short text and a mixed text are let through', () => {
    expect(guessTextLanguage('abandon abate abide ability abroad absence absolute absorb')).toBe(
      'en',
    );
    expect(guessTextLanguage('Çok güzel bir gün')).toBe('en');
    expect(
      guessTextLanguage(
        'The word "vazgeçmek" means to give up. You can say: Ben bu işten vazgeçtim, which means I gave up on this job.',
      ),
    ).toBe('en');
  });

  it('a text in another script or another Latin language is not English', () => {
    expect(
      guessTextLanguage('Сегодня утром я рано встал и пошёл гулять в парк с моей собакой.'),
    ).toBe('other');
    expect(
      guessTextLanguage(
        'Über den Wolken muss die Freiheit wohl grenzenlos sein. Alle Ängste, alle Sorgen, sagt man, blieben darunter verborgen.',
      ),
    ).toBe('other');
  });
});

describe('looksTurkishTerm (ekle.md #9)', () => {
  it.each(['çalışmak', 'ÇOK', 'şemsiye', 'İstanbul ğüşıöç', 'ısrar etmek', 'gönül'])(
    '%j → true',
    (w) => expect(looksTurkishTerm(w)).toBe(true),
  );
  it.each(['give up', 'postpone', 'naive', 'café', 'kitap'])('%j → false', (w) =>
    expect(looksTurkishTerm(w)).toBe(false),
  );
});
