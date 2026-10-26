// ML Kit text recognition in the Android app (docs/decisions/0045-ocr.md). The app-local
// EngappTextRecognizer plugin (android/app/src/main/java/.../TextRecognizerPlugin.java) runs
// Text Recognition v2 with the bundled Latin model: offline, the photo stays on the phone.
// Loaded with import() only in the native app (src/native/platform.ts).
import { registerPlugin } from '@capacitor/core';
import type { OcrBlock, OcrResult } from '@/domain/ocr';
import type { PreparedImage, Recognizer } from '@/features/ocr/types';

interface NativeResult {
  width: number;
  height: number;
  blocks: OcrBlock[];
}

interface TextRecognizerPlugin {
  recognize(options: { base64: string }): Promise<NativeResult>;
}

const Native = registerPlugin<TextRecognizerPlugin>('EngappTextRecognizer');

/** JPEG of the prepared photo without the data: prefix. */
function toBase64(image: PreparedImage): string {
  const url = image.canvas.toDataURL('image/jpeg', 0.92);
  return url.slice(url.indexOf(',') + 1);
}

export const mlkitRecognizer: Recognizer = {
  engine: 'mlkit',
  async recognize(image, onProgress): Promise<OcrResult> {
    onProgress?.(null);
    const r = await Native.recognize({ base64: toBase64(image) });
    return { engine: 'mlkit', width: r.width, height: r.height, blocks: r.blocks ?? [] };
  },
};
