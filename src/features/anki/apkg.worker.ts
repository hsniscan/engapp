// Web Worker: unzips and reads an Anki package off the main thread. Only the plain rows come
// back (domain/anki.ts AnkiCollection). The three libraries live in this worker's chunk, so
// the app downloads them only when someone imports an Anki file; sql.js's wasm is cached on
// first use (vite.config.ts, docs/decisions/0019-anki-import.md).
import JSZip from 'jszip';
import { decompress } from 'fzstd';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { ApkgError, readApkg } from './readApkg';
import type { ApkgWorkerRequest, ApkgWorkerResponse } from './parseApkg';

const scope = globalThis as unknown as {
  addEventListener(type: 'message', fn: (e: MessageEvent<ApkgWorkerRequest>) => void): void;
  postMessage(msg: ApkgWorkerResponse): void;
};

scope.addEventListener('message', (e) => {
  void (async () => {
    let SQL;
    try {
      SQL = await initSqlJs({ locateFile: () => wasmUrl });
    } catch {
      scope.postMessage({ ok: false, code: 'reader_unavailable' });
      return;
    }
    try {
      const collection = await readApkg(new Uint8Array(e.data.bytes), { JSZip, zstd: (b) => decompress(b), SQL });
      scope.postMessage({ ok: true, collection });
    } catch (err) {
      scope.postMessage({ ok: false, code: err instanceof ApkgError ? err.code : 'unreadable' });
    }
  })();
});
