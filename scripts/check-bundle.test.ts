// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkStartup, startupFiles } from './check-bundle.ts';

describe('check-bundle', () => {
  it('reads the entry and the modulepreloads from index.html', () => {
    const html =
      '<script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script>' +
      '<link rel="modulepreload" crossorigin href="/assets/react-BBBBBBBB.js">' +
      '<link rel="stylesheet" crossorigin href="/assets/index-CCCCCCCC.css">' +
      '<link rel="icon" href="/favicon.svg">';
    expect(startupFiles(html)).toEqual([
      'assets/index-AAAAAAAA.js',
      'assets/react-BBBBBBBB.js',
      'assets/index-CCCCCCCC.css',
    ]);
  });

  it('passes a small start-up bundle', () => {
    const r = checkStartup([{ path: 'assets/index-AAAAAAAA.js', content: 'console.log(1)' }]);
    expect(r.problems).toEqual([]);
  });

  it('fails when the OCR engine or the reader is in the start-up bundle', () => {
    const r = checkStartup([
      { path: 'assets/index-AAAAAAAA.js', content: 'import("tesseract.js")' },
      { path: 'assets/OcrPage-BBBBBBBB.js', content: '' },
      { path: 'assets/ReaderPage-CCCCCCCC.js', content: '' },
    ]);
    expect(r.problems).toEqual([
      'index-AAAAAAAA.js contains "tesseract.js" (OCR engine)',
      'OcrPage-BBBBBBBB.js must not load at start-up',
      'ReaderPage-CCCCCCCC.js must not load at start-up',
    ]);
  });

  it('fails over the budget', () => {
    const noise = randomBytes(30_000).toString('base64'); // does not compress
    const r = checkStartup([{ path: 'assets/index-AAAAAAAA.js', content: noise }], 10);
    expect(r.problems[0]).toMatch(/over the 10 KB budget/);
  });
});
