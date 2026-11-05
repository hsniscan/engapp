/**
 * Puts the level test's bank on the Turkish-learner levels (v0.5.3 C5, decision 0073): every
 * bank word moves to the level data/levels/client-levels.tsv gives it (list level, moved by the
 * level-tr-v1 correction or the familiar-word mark) and the band sizes are recounted from the
 * same file. Run after `node scripts/build-levels.ts`. Logic and tests:
 * scripts/lib/level-test-relevel.ts. No network, no model call.
 *
 *   node scripts/relevel-level-test.ts           rewrite data/level-test/bank.json
 *   node scripts/relevel-level-test.ts --check   fail if the committed bank is not up to date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevelTable } from '../supabase/functions/_shared/graded-coverage.ts';
import { relevelBank, type LevelTestBank } from './lib/level-test-relevel.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BANK = join(ROOT, 'data/level-test/bank.json');

export function listLemmas(refTsv: string): Set<string> {
  return new Set(
    refTsv
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('\t')[0]!),
  );
}

export function relevelCommitted() {
  const bank = JSON.parse(readFileSync(BANK, 'utf8')) as LevelTestBank;
  const table = parseLevelTable(readFileSync(join(ROOT, 'data/levels/client-levels.tsv'), 'utf8'));
  const lemmas = listLemmas(readFileSync(join(ROOT, 'data/levels/ref-word-levels.tsv'), 'utf8'));
  return { before: bank, ...relevelBank(bank, (l) => table.get(l), lemmas) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { before, bank, moved } = relevelCommitted();
  const out = `${JSON.stringify(bank)}\n`;
  console.log(JSON.stringify({ version: bank.version, moved: moved.length, band_sizes: bank.band_sizes }));
  for (const m of moved.slice(0, 50)) console.log(`  ${m.w} (${m.pos}) ${m.from} → ${m.to}`);
  if (process.argv.includes('--check')) {
    if (bank.version !== before.version || moved.length > 0) {
      console.error('out of date: data/level-test/bank.json (run node scripts/relevel-level-test.ts)');
      process.exit(1);
    }
  } else writeFileSync(BANK, out);
}
