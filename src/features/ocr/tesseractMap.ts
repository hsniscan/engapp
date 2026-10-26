// tesseract.js output → OcrResult, and its loading stages → one progress bar (decision 0045).
// Pure, so the mapping is unit-tested without loading the 4 MB engine.
import type { OcrBlock, OcrResult } from '@/domain/ocr';

interface TBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TLine {
  text: string;
  confidence: number;
  bbox: TBbox;
}
interface TParagraph {
  lines: TLine[];
  bbox: TBbox;
}
interface TBlock {
  paragraphs: TParagraph[];
  bbox: TBbox;
}
/** The part of tesseract.js's `Page` we read (`output: { blocks: true }`). */
export interface TesseractPage {
  blocks: TBlock[] | null;
}

const box = (b: TBbox) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });

/**
 * Tesseract's paragraphs become our blocks: its "block" is a whole text region (often the whole
 * page), its paragraph is what ML Kit calls a block. Confidence 0..100 → 0..1.
 */
export function fromTesseract(page: TesseractPage, width: number, height: number): OcrResult {
  const blocks: OcrBlock[] = [];
  for (const b of page.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      const lines = (p.lines ?? [])
        .map((l) => ({
          text: l.text.replace(/\s+$/, ''),
          box: box(l.bbox),
          confidence: Number.isFinite(l.confidence)
            ? Math.min(1, Math.max(0, l.confidence / 100))
            : null,
        }))
        .filter((l) => l.text.trim());
      if (lines.length) blocks.push({ box: box(p.bbox), lines });
    }
  }
  return { engine: 'tesseract', width, height, blocks };
}

/**
 * One bar for the whole job: loading the engine and the English model is the first 35 % (it is
 * a download the first time), reading the photo the rest.
 */
export function overallProgress(status: string, progress: number): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  if (status === 'recognizing text') return 0.35 + 0.65 * p;
  const stages = [
    'loading tesseract core',
    'initializing tesseract',
    'loading language traineddata',
    'initializing api',
  ];
  const i = stages.indexOf(status);
  if (i < 0) return 0;
  return ((i + p) / stages.length) * 0.35;
}
