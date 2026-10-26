// Text from a photo on the web (docs/decisions/0045-ocr.md): tesseract.js (Apache-2.0) with the
// English LSTM model only. This chunk loads when the user has picked a photo on the web, never
// in the Android app (ML Kit there). Every file comes from our own origin (`/ocr/<version>/`,
// copied from node_modules at build time by the `engapp-ocr-assets` Vite plugin), never from a
// CDN; the service worker caches them on first use, so later photos work offline. The photo
// itself is read in a Web Worker on the device and never uploaded.
import { version } from 'tesseract.js/package.json';
import type { OcrResult } from '@/domain/ocr';
import { fromTesseract, overallProgress, type TesseractPage } from './tesseractMap';
import type { Recognizer } from './types';

/** Same path the Vite plugin writes to (vite.config.ts). */
export const OCR_ASSET_BASE = `/ocr/${version}/`;

/** OEM.LSTM_ONLY: the neural engine only; the legacy model is not shipped. */
const LSTM_ONLY = 1;

export const tesseractRecognizer: Recognizer = {
  engine: 'tesseract',
  async recognize(image, onProgress): Promise<OcrResult> {
    onProgress?.(0);
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng', LSTM_ONLY, {
      workerPath: `${OCR_ASSET_BASE}worker.min.js`,
      corePath: OCR_ASSET_BASE,
      langPath: OCR_ASSET_BASE,
      workerBlobURL: false,
      // The service worker caches the files; no second copy in IndexedDB.
      cacheMethod: 'none',
      logger: (m) => onProgress?.(overallProgress(m.status, m.progress)),
    });
    try {
      const { data } = await worker.recognize(image.canvas, {}, { blocks: true, text: false });
      onProgress?.(1);
      return fromTesseract(data as unknown as TesseractPage, image.width, image.height);
    } finally {
      void worker.terminate();
    }
  },
};
