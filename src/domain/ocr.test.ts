import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cleanLine,
  fitWithin,
  isLowConfidence,
  isNoiseLine,
  joinLines,
  ocrQuality,
  ocrTitle,
  rebuildText,
  toReviewLines,
  type OcrBlock,
  type OcrResult,
  type ReviewLine,
} from './ocr';

/** A block of lines 20 px high, 8 px apart, starting at (x, y); `indent` per line in px. */
function block(
  x: number,
  y: number,
  texts: string[],
  opts: { indent?: number[]; width?: number[]; gapAfter?: Record<number, number> } = {},
): OcrBlock {
  let top = y;
  const lines = texts.map((text, i) => {
    const ind = opts.indent?.[i] ?? 0;
    const w = opts.width?.[i] ?? 600 - ind;
    const line = { text, box: { x: x + ind, y: top, w, h: 20 }, confidence: 0.95 };
    top += 28 + (opts.gapAfter?.[i] ?? 0);
    return line;
  });
  const right = Math.max(...lines.map((l) => l.box.x + l.box.w));
  return { box: { x, y, w: right - x, h: top - y }, lines };
}

const result = (blocks: OcrBlock[]): OcrResult => ({
  engine: 'mlkit',
  width: 1000,
  height: 1400,
  blocks,
});
const rebuild = (blocks: OcrBlock[]) => rebuildText(toReviewLines(result(blocks)));

describe('joinLines', () => {
  it('joins a word hyphenated at the end of a line', () => {
    expect(joinLines('a good exam-', 'ple of this')).toBe('a good example of this');
    expect(joinLines('the inter‐', 'national')).toBe('the international');
    expect(joinLines('soft­', 'ware')).toBe('software');
  });

  it('keeps the hyphen of a compound', () => {
    expect(joinLines('she was self-', 'aware')).toBe('she was self-aware');
    expect(joinLines('a well-', 'known fact')).toBe('a well-known fact');
    expect(joinLines('in 1990-', '95 it')).toBe('in 1990-95 it');
    expect(joinLines('the Anglo-', 'Saxon')).toBe('the Anglo-Saxon');
  });

  it('uses a word check when there is one', () => {
    const words = new Set(['data', 'base', 'database', 'lion', 'heart']);
    const isWord = (w: string) => words.has(w);
    expect(joinLines('a data-', 'base', { isWord })).toBe('a database');
    expect(joinLines('a lion-', 'heart', { isWord })).toBe('a lion-heart');
  });

  it('puts a space between ordinary lines, none after an em dash', () => {
    expect(joinLines('It was a dark', 'and stormy night')).toBe('It was a dark and stormy night');
    expect(joinLines('he said —', 'nothing')).toBe('he said — nothing');
    expect(joinLines('he said—', 'nothing')).toBe('he said—nothing');
    expect(joinLines('pages 3 -', '4')).toBe('pages 3 - 4');
  });
});

describe('cleanLine and noise', () => {
  it('spells out ligatures and collapses spaces', () => {
    expect(cleanLine('  the ﬁrst   ﬂight​ ')).toBe('the first flight');
  });

  it('marks page numbers and specks as noise, not words', () => {
    for (const s of ['12', '- 12 -', '— 7 —', 'xiv', 'iv', '|', '.', 'a'])
      expect(isNoiseLine(s)).toBe(true);
    for (const s of ['I am', 'civil', 'Chapter 12', 'mix', 'OK.', 'Hi!'])
      expect(isNoiseLine(s)).toBe(false);
  });

  it('starts noise lines unticked and drops empty ones', () => {
    const lines = toReviewLines(result([block(0, 0, ['Some text here', '  ', '17'])]));
    expect(lines.map((l) => [l.text, l.included])).toEqual([
      ['Some text here', true],
      ['17', false],
    ]);
    expect(lines[1]!.id).toBe('0-2');
  });
});

describe('rebuildText', () => {
  it('joins the lines of a paragraph and hyphenated words', () => {
    const text = rebuild([
      block(
        100,
        100,
        [
          'The quick brown fox jumps over the',
          'lazy dog and runs into the for-',
          'est behind the house.',
        ],
        {
          width: [600, 600, 300],
        },
      ),
    ]);
    expect(text).toBe(
      'The quick brown fox jumps over the lazy dog and runs into the forest behind the house.',
    );
  });

  it('starts a paragraph at a first-line indent', () => {
    const text = rebuild([
      block(
        100,
        100,
        [
          'First paragraph line one and',
          'it ends here.',
          'Second paragraph begins with',
          'an indent and goes on.',
        ],
        {
          indent: [0, 0, 40, 0],
          width: [600, 200, 560, 400],
        },
      ),
    ]);
    expect(text).toBe(
      'First paragraph line one and it ends here.\n\nSecond paragraph begins with an indent and goes on.',
    );
  });

  it('starts a paragraph after a larger vertical gap', () => {
    const text = rebuild([
      block(100, 100, ['A heading line', 'Body text that follows the', 'heading after a gap.'], {
        gapAfter: { 0: 30 },
        width: [600, 600, 600],
      }),
    ]);
    expect(text).toBe('A heading line\n\nBody text that follows the heading after a gap.');
  });

  it('keeps loosely spaced lines in one paragraph (gap judged against the block’s leading)', () => {
    const lines = toReviewLines(
      result([
        block(
          100,
          100,
          ['Double spaced lines are', 'still one paragraph when', 'the spacing is even.'],
          {
            gapAfter: { 0: 30, 1: 30 },
          },
        ),
      ]),
    );
    expect(rebuildText(lines)).toBe(
      'Double spaced lines are still one paragraph when the spacing is even.',
    );
  });

  it('starts a paragraph after a short line that ends a sentence (block style, no indent)', () => {
    const text = rebuild([
      block(
        100,
        100,
        [
          'This paragraph has no indent at',
          'all and ends early.',
          'The next one starts flush left',
          'too.',
        ],
        {
          width: [600, 250, 600, 60],
        },
      ),
    ]);
    expect(text).toBe(
      'This paragraph has no indent at all and ends early.\n\nThe next one starts flush left too.',
    );
  });

  it('keeps blocks apart, unless one continues the previous sentence', () => {
    const two = rebuild([
      block(100, 100, ['Left column ends here.']),
      block(700, 100, ['Right column starts.']),
    ]);
    expect(two).toBe('Left column ends here.\n\nRight column starts.');
    const cont = rebuild([
      block(100, 100, ['The sentence goes on to the']),
      block(700, 100, ['next column without a stop.']),
    ]);
    expect(cont).toBe('The sentence goes on to the next column without a stop.');
  });

  it('uses only included lines, with the user’s edits', () => {
    const lines = toReviewLines(
      result([block(100, 100, ['CHAPTER ONE', 'Teh first line of', 'the story.', '23'])]),
    );
    const edited: ReviewLine[] = lines.map((l) =>
      l.text === 'CHAPTER ONE'
        ? { ...l, included: false }
        : l.text.startsWith('Teh')
          ? { ...l, text: 'The first line of' }
          : l,
    );
    expect(rebuildText(edited)).toBe('The first line of the story.');
    expect(rebuildText(edited.map((l) => ({ ...l, included: false })))).toBe('');
  });

  it('never loses or invents a word (property)', () => {
    const word = fc.stringMatching(/^[a-z]{1,8}$/);
    fc.assert(
      fc.property(
        fc.array(fc.array(word, { minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 8 }),
        (rows) => {
          const lines = rows.map((ws) => ws.join(' '));
          const all = toReviewLines(result([block(0, 0, lines)])).map((l) => ({
            ...l,
            included: true,
          }));
          const text = rebuildText(all);
          expect(text.split(/\s+/).filter(Boolean)).toEqual(lines.join(' ').split(' '));
        },
      ),
    );
  });
});

describe('quality', () => {
  it('weights confidence by letters and flags a low page', () => {
    const q = ocrQuality([
      { text: 'a long and clear line of text', confidence: 0.95 },
      { text: 'x', confidence: 0.1 },
    ]);
    expect(q.empty).toBe(false);
    expect(q.low).toBe(false);
    expect(q.confidence).toBeGreaterThan(0.9);
    expect(ocrQuality([{ text: 'blurry words everywhere here', confidence: 0.5 }]).low).toBe(true);
    expect(ocrQuality([{ text: 'hi', confidence: 0.99 }]).empty).toBe(true);
    expect(ocrQuality([{ text: 'no confidence given at all', confidence: null }])).toMatchObject({
      confidence: null,
      low: false,
    });
  });

  it('marks a low-confidence line', () => {
    expect(isLowConfidence({ confidence: 0.4 })).toBe(true);
    expect(isLowConfidence({ confidence: 0.9 })).toBe(false);
    expect(isLowConfidence({ confidence: null })).toBe(false);
  });
});

describe('helpers', () => {
  it('fits an image within the longest side without upscaling', () => {
    expect(fitWithin(4000, 3000, 2400)).toEqual({ width: 2400, height: 1800 });
    expect(fitWithin(3000, 4000, 2400)).toEqual({ width: 1800, height: 2400 });
    expect(fitWithin(800, 600, 2400)).toEqual({ width: 800, height: 600 });
  });

  it('titles a text by its first words', () => {
    expect(ocrTitle('Short title\n\nBody')).toBe('Short title');
    expect(
      ocrTitle('A very long first line that goes on and on beyond the limit of the title'),
    ).toMatch(/…$/);
  });
});
