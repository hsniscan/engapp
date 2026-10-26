import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lemmaCounts, sentenceAt, tokenizeReaderText, wordCount } from './readerTokens';

const counted = (body: string) =>
  tokenizeReaderText(body)
    .tokens.filter((t) => t.counted)
    .map((t) => t.norm);
const sentences = (body: string) =>
  tokenizeReaderText(body).sentences.map((s) => body.slice(s.start, s.end));

describe('tokenizeReaderText', () => {
  it('keeps words with their offsets and drops punctuation', () => {
    const body = 'Hello, world! It’s a well-known fact.';
    const t = tokenizeReaderText(body);
    expect(t.tokens.map((x) => x.text)).toEqual([
      'Hello',
      'world',
      'It’s',
      'a',
      'well-known',
      'fact',
    ]);
    for (const tok of t.tokens) expect(body.slice(tok.start, tok.end)).toBe(tok.text);
    expect(t.tokens[2]!.norm).toBe("it's");
  });

  it('does not count numbers, stray letters, addresses, acronyms or names mid-sentence', () => {
    expect(counted('In 2024 we met Anna at www.example.com and NASA paid 3 dollars to x.')).toEqual(
      ['in', 'we', 'met', 'at', 'and', 'paid', 'dollars', 'to'],
    );
  });

  it('counts a capitalised word that opens a sentence, a quote or a clause', () => {
    expect(counted('The dog ran. She said: "Stop it." Then I left.')).toEqual([
      'the',
      'dog',
      'ran',
      'she',
      'said',
      'stop',
      'it',
      'then',
      'i',
      'left',
    ]);
  });

  it('treats a sentence-initial word as a name when the text only uses it as one', () => {
    const t = tokenizeReaderText('London is big. I like London a lot.');
    expect(t.tokens.filter((x) => x.norm === 'london').every((x) => x.proper && !x.counted)).toBe(
      true,
    );
    // "Big" written in lower case elsewhere stays a word.
    expect(counted('Big dogs bark. My dog is big.')).toContain('big');
  });

  it('splits sentences, but not after abbreviations or initials', () => {
    expect(sentences('Mr. Smith met J. K. Rowling. They talked! Did it work? Yes.')).toEqual([
      'Mr. Smith met J. K. Rowling.',
      'They talked!',
      'Did it work?',
      'Yes.',
    ]);
    expect(sentences('It cost 3.5 dollars. Fine.')).toEqual(['It cost 3.5 dollars.', 'Fine.']);
    expect(sentences('"Go home." She went.')).toEqual(['"Go home."', 'She went.']);
  });

  it('splits paragraphs on blank lines', () => {
    const body = 'One. Two.\n\n  Three.\n \nFour';
    const t = tokenizeReaderText(body);
    expect(t.paragraphs.map((p) => body.slice(p.start, p.end))).toEqual([
      'One. Two.',
      'Three.',
      'Four',
    ]);
    expect(t.sentences.map((s) => s.paragraph)).toEqual([0, 0, 1, 2]);
  });

  it('an empty or whitespace body has no tokens', () => {
    expect(tokenizeReaderText('')).toEqual({ tokens: [], sentences: [], paragraphs: [] });
    expect(tokenizeReaderText(' \n\n \t').tokens).toEqual([]);
  });

  it('property: tokens are ordered, inside their sentence, and sentences inside paragraphs', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 400 }),
        fc.array(fc.constantFrom('. ', '! ', '\n\n', ', ', ' A', ' 12 '), { maxLength: 20 }),
        (s, bits) => {
          const body = s + bits.join('the ');
          const t = tokenizeReaderText(body);
          let prev = -1;
          for (const tok of t.tokens) {
            expect(tok.start).toBeGreaterThan(prev);
            expect(body.slice(tok.start, tok.end)).toBe(tok.text);
            const sen = t.sentences[tok.sentence]!;
            expect(tok.start).toBeGreaterThanOrEqual(sen.start);
            expect(tok.end).toBeLessThanOrEqual(sen.end);
            prev = tok.end - 1;
          }
          for (const [i, sen] of t.sentences.entries()) {
            const p = t.paragraphs[sen.paragraph]!;
            expect(sen.start).toBeGreaterThanOrEqual(p.start);
            expect(sen.end).toBeLessThanOrEqual(p.end);
            expect(
              t.tokens.slice(sen.firstToken, sen.endToken).every((x) => x.sentence === i),
            ).toBe(true);
          }
          expect(t.tokens.every((x) => !(x.counted && /\d/.test(x.text)))).toBe(true);
        },
      ),
    );
  });

  it('tokenises 10 000 words quickly', () => {
    const body = Array.from(
      { length: 1000 },
      (_, i) => `The ${i % 7 ? 'cat' : 'Dog'} sat on the mat near Paris again.`,
    ).join(' ');
    const start = performance.now();
    const t = tokenizeReaderText(body);
    expect(performance.now() - start).toBeLessThan(500);
    expect(wordCount(t)).toBe(9000);
  });
});

describe('lemmaCounts and sentenceAt', () => {
  it('counts counted words per lemma', () => {
    const t = tokenizeReaderText('Cats run. A cat ran in 2020 with Bob.');
    const counts = lemmaCounts(t.tokens, (w) => ({ cats: 'cat', ran: 'run' })[w] ?? w);
    expect(Object.fromEntries(counts)).toEqual({ cat: 2, run: 2, a: 1, in: 1, with: 1 });
  });

  it('finds the sentence that holds an offset', () => {
    const body = 'One two. Three four. Five.';
    const t = tokenizeReaderText(body);
    expect(sentenceAt(t, 0)).toBe(0);
    expect(sentenceAt(t, body.indexOf('four'))).toBe(1);
    expect(sentenceAt(t, body.length + 50)).toBe(2);
    expect(sentenceAt(tokenizeReaderText(''), 10)).toBe(0);
  });
});

describe('given sentence ranges (library texts, decision 0054)', () => {
  it('keeps the given sentences even where the splitter would cut', () => {
    const body = 'Mr. Lee saw Dr. Who. It was fine.\n\nThen e.g. Bob left.';
    const ranges: [number, number][] = [
      [0, 20],
      [21, 33],
      [35, body.length],
    ];
    const t = tokenizeReaderText(body, { sentences: ranges });
    expect(t.sentences.map((s) => [s.start, s.end])).toEqual(ranges);
    expect(t.paragraphs.map((p) => [p.firstSentence, p.endSentence])).toEqual([
      [0, 2],
      [2, 3],
    ]);
    expect(t.tokens.find((x) => x.text === 'Bob')!.sentence).toBe(2);
  });
});
