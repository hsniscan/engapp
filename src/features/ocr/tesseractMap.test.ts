import { describe, expect, it } from 'vitest';
import { fromTesseract, overallProgress } from './tesseractMap';

const bb = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

describe('fromTesseract', () => {
  it('turns paragraphs into blocks, boxes into x/y/w/h and confidence into 0..1', () => {
    const r = fromTesseract(
      {
        blocks: [
          {
            bbox: bb(0, 0, 500, 300),
            paragraphs: [
              {
                bbox: bb(10, 10, 490, 60),
                lines: [
                  { text: 'First line\n', confidence: 91.5, bbox: bb(10, 10, 490, 30) },
                  { text: '   \n', confidence: 10, bbox: bb(10, 32, 20, 40) },
                ],
              },
              {
                bbox: bb(10, 80, 490, 100),
                lines: [{ text: 'Second', confidence: 40, bbox: bb(10, 80, 200, 100) }],
              },
            ],
          },
        ],
      },
      500,
      300,
    );
    expect(r.engine).toBe('tesseract');
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0]!.lines).toEqual([
      { text: 'First line', box: { x: 10, y: 10, w: 480, h: 20 }, confidence: 0.915 },
    ]);
    expect(r.blocks[1]!.lines[0]!.confidence).toBe(0.4);
  });

  it('copes with no blocks', () => {
    expect(fromTesseract({ blocks: null }, 1, 1).blocks).toEqual([]);
  });
});

describe('overallProgress', () => {
  it('rises monotonically through loading and recognising', () => {
    const steps: [string, number][] = [
      ['loading tesseract core', 0],
      ['loading tesseract core', 1],
      ['initializing tesseract', 0.5],
      ['loading language traineddata', 1],
      ['initializing api', 1],
      ['recognizing text', 0.2],
      ['recognizing text', 1],
    ];
    const values = steps.map(([s, p]) => overallProgress(s, p));
    for (let i = 1; i < values.length; i++)
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
    expect(values.at(-1)).toBe(1);
    expect(overallProgress('something else', 0.5)).toBe(0);
  });
});
