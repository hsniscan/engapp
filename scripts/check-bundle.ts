/**
 * Start-up bundle check (decision 0053), run by CI after `pnpm build`:
 *
 *   node scripts/check-bundle.ts [dist]
 *
 * Reads dist/index.html, takes the entry script and every modulepreload (what a first visit
 * downloads before the app runs), and fails when
 *   - one of them holds the OCR engine (tesseract) or the reader / OCR screens, which must
 *     stay lazy route chunks, or
 *   - their gzip size passes the budget below.
 * Prints the size and the ten largest start-up files either way.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Start-up JS + CSS, gzip. Measured 2026-10-26 after V0.5 wave 1: ~475 KB. */
export const BUDGET_GZIP_KB = 525;

/** File names of chunks that must never load at start-up. */
const LAZY_ONLY_NAMES = /^(OcrPage|ocr|tesseract|Reader|ReaderPage|reader)[-.]/i;
/** Code markers of the OCR engine. */
const LAZY_ONLY_CODE = ['tesseract.js', 'tesseract-core', 'createWorker('];

export interface StartupFile {
  name: string;
  raw: number;
  gzip: number;
}

export function startupFiles(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!);
}

export function checkStartup(
  files: readonly { path: string; content: string }[],
  budgetKb = BUDGET_GZIP_KB,
): { gzipKb: number; problems: string[]; sizes: StartupFile[] } {
  const problems: string[] = [];
  const sizes: StartupFile[] = [];
  for (const f of files) {
    const name = f.path.replace(/^assets\//, '');
    if (LAZY_ONLY_NAMES.test(name)) problems.push(`${name} must not load at start-up`);
    for (const marker of LAZY_ONLY_CODE)
      if (f.content.includes(marker)) problems.push(`${name} contains "${marker}" (OCR engine)`);
    const buf = Buffer.from(f.content);
    sizes.push({ name, raw: buf.length, gzip: gzipSync(buf).length });
  }
  const gzipKb = Math.round(sizes.reduce((s, x) => s + x.gzip, 0) / 102.4) / 10;
  if (gzipKb > budgetKb)
    problems.push(`start-up bundle is ${gzipKb} KB gzip, over the ${budgetKb} KB budget`);
  return { gzipKb, problems, sizes: sizes.sort((a, b) => b.gzip - a.gzip) };
}

function main(): void {
  const dist = process.argv[2] ?? 'dist';
  const indexHtml = join(dist, 'index.html');
  if (!existsSync(indexHtml)) {
    console.error(`${indexHtml} not found: run pnpm build first`);
    process.exitCode = 2;
    return;
  }
  const paths = startupFiles(readFileSync(indexHtml, 'utf8'));
  const r = checkStartup(
    paths.map((path) => ({ path, content: readFileSync(join(dist, path), 'utf8') })),
  );
  console.log(`start-up: ${paths.length} files, ${r.gzipKb} KB gzip (budget ${BUDGET_GZIP_KB} KB)`);
  for (const s of r.sizes.slice(0, 10))
    console.log(`  ${s.name.padEnd(40)} ${(s.gzip / 1024).toFixed(1).padStart(7)} KB gzip`);
  for (const p of r.problems) console.log(`::error::${p}`);
  if (r.problems.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
