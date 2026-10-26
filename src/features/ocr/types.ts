// The seam between the photo flow and a text recogniser (docs/decisions/0045-ocr.md). The page
// only knows `Recognizer`; tests pass a fake one.
import type { OcrEngine, OcrResult } from '@/domain/ocr';

/** A photo scaled to MAX_IMAGE_SIDE and turned upright (EXIF), drawn on a canvas. */
export interface PreparedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/** 0..1 when the engine reports it; null for "working, no estimate". */
export type OcrProgress = (fraction: number | null) => void;

export interface Recognizer {
  engine: OcrEngine;
  recognize(image: PreparedImage, onProgress?: OcrProgress): Promise<OcrResult>;
}
