// Main-thread side of the .apkg reader: one worker per file, terminated afterwards so a large
// collection does not keep memory alive.
import type { AnkiCollection } from '@/domain/anki';
import type { ApkgErrorCode } from './readApkg';

/** reader_unavailable: the reader could not be downloaded (offline before the first import). */
export type AnkiReadError = ApkgErrorCode | 'reader_unavailable';

export interface ApkgWorkerRequest {
  bytes: ArrayBuffer;
}

export type ApkgWorkerResponse = { ok: true; collection: AnkiCollection } | { ok: false; code: AnkiReadError };

/** Largest .apkg accepted (the collection plus media; media are skipped). */
export const MAX_APKG_BYTES = 250 * 1024 * 1024;

export class AnkiReadFailure extends Error {
  readonly code: AnkiReadError;
  constructor(code: AnkiReadError) {
    super(code);
    this.name = 'AnkiReadFailure';
    this.code = code;
  }
}

/** Read an .apkg file in a Web Worker. @throws AnkiReadFailure */
export async function parseApkgFile(file: Blob): Promise<AnkiCollection> {
  if (file.size > MAX_APKG_BYTES) throw new AnkiReadFailure('too_big');
  const bytes = await file.arrayBuffer();
  const worker = new Worker(new URL('./apkg.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<AnkiCollection>((resolve, reject) => {
      worker.addEventListener('message', (e: MessageEvent<ApkgWorkerResponse>) => {
        if (e.data.ok) resolve(e.data.collection);
        else reject(new AnkiReadFailure(e.data.code));
      });
      worker.addEventListener('error', () => reject(new AnkiReadFailure('reader_unavailable')));
      worker.postMessage({ bytes } satisfies ApkgWorkerRequest, [bytes]);
    });
  } finally {
    worker.terminate();
  }
}
