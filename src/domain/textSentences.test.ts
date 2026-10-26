import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  findTextSentences,
  formsPattern,
  MAX_TEXT_SENTENCES,
  pickRotating,
  sentenceKey,
  wordForms,
} from './textSentences';

describe('wordForms', () => {
  it('regular forms by word class', () => {
    expect(wordForms('cope', 'verb').sort()).toEqual(['cope', 'coped', 'copes', 'coping']);
    expect(wordForms('stop', 'verb')).toEqual(expect.arrayContaining(['stops', 'stopped', 'stopping']));
    expect(wordForms('carry', 'verb')).toEqual(expect.arrayContaining(['carries', 'carried', 'carrying']));
    expect(wordForms('box', 'noun').sort()).toEqual(['box', 'boxes']);
    expect(wordForms('city', 'noun').sort()).toEqual(['cities', 'city']);
    expect(wordForms('happy', 'adjective').sort()).toEqual(['happier', 'happiest', 'happy']);
  });

  it('irregular verbs and nouns, without wrong regular forms', () => {
    expect(wordForms('go', 'verb')).toEqual(expect.arrayContaining(['went', 'gone', 'goes']));
    expect(wordForms('be', 'verb')).not.toContain('bed');
    expect(wordForms('be', 'verb')).not.toContain('best');
    expect(wordForms('child', 'noun')).toContain('children');
    expect(wordForms('constructor')).toContain('constructor');
  });

  it('a noun never gets verb or comparison endings ("bank" is not "banker")', () => {
    expect(wordForms('bank', 'noun').sort()).toEqual(['bank', 'banks']);
  });

  it('phrases vary their first word; "to" is dropped', () => {
    expect(wordForms('give up')).toEqual(expect.arrayContaining(['give up', 'gave up', 'given up', 'gives up']));
    expect(wordForms('to cope', 'verb')).toContain('coped');
    expect(wordForms('  ')).toEqual([]);
  });

  it('the pattern matches whole words only, any case', () => {
    const re = formsPattern(wordForms('cope', 'verb'))!;
    expect(re.test('She Coped well.')).toBe(true);
    expect(re.test('a telescope')).toBe(false);
    expect(re.test("copes'")).toBe(true);
  });
});

describe('findTextSentences', () => {
  const body = [
    'We had a long day. Somehow we coped with the storm and the noise.',
    'Nothing else here mentions it, really, not at all.',
    '',
    'Short. She copes with stress at work every single day.',
    'A telescope is not the word we are looking for here.',
  ].join('\n');

  it('finds sentences with any form, with the span of the word', () => {
    const found = findTextSentences([{ id: 't1', body }], 'cope', { pos: 'verb' });
    expect(found.map((f) => f.text)).toEqual([
      'Somehow we coped with the storm and the noise.',
      'She copes with stress at work every single day.',
    ]);
    const f = found[0]!;
    expect(f.text.slice(f.span[0], f.span[1])).toBe('coped');
    expect(f).toMatchObject({ tr: null, textId: 't1' });
  });

  it('skips the card’s own sentence, duplicates, too short and too long sentences', () => {
    const own = 'Somehow we coped with the storm and the noise.';
    const long = `We coped ${'and coped '.repeat(40)}in the end.`;
    const texts = [
      { id: 'a', body: `${own} Ok coped. ${long}` },
      { id: 'b', body: own },
    ];
    expect(findTextSentences(texts, 'cope', { pos: 'verb', exclude: [own] })).toEqual([]);
  });

  it('takes the newest text first and stops at the maximum', () => {
    const texts = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, body: `In text ${i} the team coped with a hard task.` }));
    const found = findTextSentences(texts, 'cope', { pos: 'verb' });
    expect(found).toHaveLength(MAX_TEXT_SENTENCES);
    expect(found.map((f) => f.textId)).toEqual(['t0', 't1', 't2', 't3']);
  });

  it('a graded text brings its translation; an empty one stays null', () => {
    const found = findTextSentences(
      [{ id: 'g', sentences: [{ en: 'The children coped with the long winter.', tr: 'Çocuklar uzun kışla başa çıktı.' }, { en: 'They coped again the next year too.', tr: ' ' }] }],
      'cope',
      { pos: 'verb' },
    );
    expect(found.map((f) => f.tr)).toEqual(['Çocuklar uzun kışla başa çıktı.', null]);
  });

  it('is deterministic', () => {
    expect(findTextSentences([{ id: 't1', body }], 'cope')).toEqual(findTextSentences([{ id: 't1', body }], 'cope'));
  });
});

describe('pickRotating', () => {
  const key = (s: string) => sentenceKey(s);

  it('steps on every answer and is stable while shown', () => {
    const list = ['a', 'b', 'c'];
    expect([0, 1, 2, 3].map((r) => pickRotating(list, r, null, key))).toEqual(['a', 'b', 'c', 'a']);
    expect(pickRotating(list, 1, { reps: 1, key: key('c') }, key)).toBe('c');
  });

  it('never repeats the sentence of the previous answer when the list changed in between', () => {
    // Shown "b" at reps 1 with [a, b]; a new text added a sentence in front: [x, a, b].
    expect(pickRotating(['x', 'a', 'b'], 2, { reps: 1, key: key('b') }, key)).toBe('x');
    expect(pickRotating(['b', 'x'], 2, { reps: 1, key: key('b') }, key)).toBe('x');
  });

  it('one sentence is shown every time; an empty list gives null', () => {
    expect(pickRotating(['a'], 5, { reps: 4, key: key('a') }, key)).toBe('a');
    expect(pickRotating([], 1, null, key)).toBeNull();
  });

  it('property: with two or more sentences, consecutive showings always differ', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uniqueArray(fc.string({ minLength: 1, maxLength: 3 }), { minLength: 2, maxLength: 6 }), { minLength: 1, maxLength: 12 }),
        (lists) => {
          let last: { reps: number; key: string } | null = null;
          for (const [reps, list] of lists.entries()) {
            const keys = new Set(list.map(key));
            if (keys.size < list.length) return; // hash collision in tiny strings: skip
            const s: string = pickRotating(list, reps, last, key)!;
            if (last) expect(key(s)).not.toBe(last.key);
            // Re-rendering the same showing gives the same sentence.
            expect(pickRotating(list, reps, { reps, key: key(s) }, key)).toBe(s);
            last = { reps, key: key(s) };
          }
        },
      ),
    );
  });

  it('sentenceKey ignores case and spacing', () => {
    expect(sentenceKey('We  coped.')).toBe(sentenceKey('we coped.'));
    expect(sentenceKey('We coped.')).not.toBe(sentenceKey('We coped!'));
  });
});
