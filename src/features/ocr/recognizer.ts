// Which recogniser this build uses (docs/decisions/0045-ocr.md): ML Kit in the Android app,
// tesseract.js on the web. Both are lazy chunks: nothing OCR-related loads until the photo flow
// has a photo.
import { isNativeApp } from '@/native/platform';
import type { Recognizer } from './types';

export async function defaultRecognizer(): Promise<Recognizer> {
  if (isNativeApp()) return (await import('@/native/ocr')).mlkitRecognizer;
  return (await import('./tesseract')).tesseractRecognizer;
}
