import { describe, expect, it } from 'vitest';
import { chunkText, cleanPdfText, hashChunk, joinHyphenatedLines, removeRepeatedHeaders, splitSentences } from './chunking';

describe('chunking', () => {
  it('splits sentences', () => {
    expect(splitSentences('Hello there. How are you? Fine!').map((s) => s.trim())).toEqual([
      'Hello there.',
      'How are you?',
      'Fine!',
    ]);
  });

  it('groups sentences into chunks without splitting any sentence', () => {
    const sentences = Array.from({ length: 300 }, (_, i) => `Sentence number ${i} is here and it has some words.`);
    const text = sentences.join(' ');
    const chunks = chunkText(text, 1000);
    expect(chunks.length).toBeGreaterThan(10);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    for (const s of sentences) expect(chunks.filter((c) => c.includes(s))).toHaveLength(1);
    expect(chunks.join(' ')).toBe(text);
  });

  it('keeps an over-long sentence whole', () => {
    const long = 'Long ' + 'word '.repeat(500).trim() + '.';
    const chunks = chunkText(`Short one. ${long} Another.`, 100);
    expect(chunks).toContain(long);
  });

  it('default size is about 6000 characters', () => {
    const text = 'This is a sentence. '.repeat(1000);
    const chunks = chunkText(text);
    expect(chunks[0]!.length).toBeLessThanOrEqual(6000);
    expect(chunks[0]!.length).toBeGreaterThan(5900);
  });

  it('hashes chunks with sha-256', async () => {
    const h = await hashChunk('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await hashChunk('café')).toBe(await hashChunk('café'));
  });
});

describe('pdf cleanup', () => {
  it('joins hyphenated line breaks', () => {
    expect(joinHyphenatedLines('an exam-\nple of well-\nknown')).toBe('an example of wellknown');
    expect(joinHyphenatedLines('state-of-the-art\nNext')).toBe('state-of-the-art\nNext');
  });

  it('drops header/footer lines repeated on more than half of the pages', () => {
    const body = (p: number): string =>
      Array.from({ length: 8 }, (_, i) => `${['Alpha', 'Beta', 'Gamma', 'Delta'][p - 1]} body line ${'x'.repeat(i)}`).join('\n');
    const pages = [1, 2, 3, 4].map((p) => `My Book Title\n${body(p)}\nPage ${p} of 4`);
    pages[3] = 'Unique last page.\nPage 4 of 4';
    const cleaned = removeRepeatedHeaders(pages);
    expect(cleaned[0]).toBe(body(1));
    expect(cleaned[3]).toBe('Unique last page.');
  });

  it('cleanPdfText produces flowing paragraphs', () => {
    const pages = ['Header\nThe quick brown fox jum-\nped over the\nlazy dog.\n\nNew para-\ngraph starts', 'Header\nhere and ends.'];
    expect(cleanPdfText(pages)).toBe('The quick brown fox jumped over the lazy dog.\n\nNew paragraph starts here and ends.');
  });
});
