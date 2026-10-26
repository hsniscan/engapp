// The chosen photo → an upright, size-capped canvas for the recogniser (docs/decisions/0045).
// Runs on the device; the photo is never uploaded. createImageBitmap applies the EXIF rotation
// of camera photos (the default `imageOrientation: 'from-image'`), so the boxes the recogniser
// returns match what the user sees.
import { fitWithin, MAX_IMAGE_SIDE } from '@/domain/ocr';
import type { PreparedImage } from './types';

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The file could not be read as a picture (wrong type, broken file). */
export class NotAnImageError extends Error {}

export async function prepareImage(file: Blob, max = MAX_IMAGE_SIDE): Promise<PreparedImage> {
  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch (e) {
    throw new NotAnImageError(String(e));
  }
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    // A transparent PNG (a screenshot) on white, not black, reads better.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(decoded.source, 0, 0, width, height);
    return { canvas, width, height };
  } finally {
    decoded.close();
  }
}
