/**
 * Builds the Anki fixture packages in tests/fixtures/anki/ (one per collection format) from
 * our own sample deck (src/features/anki/testing/buildApkg.ts); no third-party decks.
 *   node scripts/anki-fixtures.ts
 * The files are committed; run again only when the sample deck changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { buildApkg, sampleDeck } from '../src/features/anki/testing/buildApkg.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
const SQL = await initSqlJs({ wasmBinary: Uint8Array.from(wasm).buffer });
const out = join(root, 'tests/fixtures/anki');
mkdirSync(out, { recursive: true });

for (const format of ['anki2', 'anki21', 'anki21b'] as const) {
  const bytes = await buildApkg(sampleDeck(), format, {
    JSZip,
    SQL,
    zstdCompress: (b) => new Uint8Array(zstdCompressSync(b)),
  });
  const file = join(out, `sample-${format}.apkg`);
  writeFileSync(file, bytes);
  console.log(`${file} (${bytes.length} bytes)`);
}
