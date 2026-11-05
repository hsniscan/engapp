/**
 * Familiar international words for Turkish speakers (v0.5.3 C5, decision 0073): microphone,
 * penicillin, catalogue… are known to a Turkish speaker (mikrofon, penisilin, katalog), so
 * their level for Turkish learners is one step easier than the list says. Logic and tests:
 * scripts/lib/tr-familiar.ts. Reproducible from pinned data only (no model call, no network
 * beyond the checksummed wordfreq wheel that build-levels.ts already uses).
 *
 *   node scripts/build-tr-familiar.ts candidates
 *       Prints every candidate (also the reviewed-out ones, marked) for a review pass.
 *   node scripts/build-tr-familiar.ts
 *       Writes data/levels/tr-familiar.tsv (candidates minus data/levels/tr-familiar-review.tsv)
 *       and the server migration supabase/migrations/20261106000300_tr_familiar_levels.sql.
 *       Then run `node scripts/build-levels.ts` so the client level file carries them.
 *   node scripts/build-tr-familiar.ts --check
 *       Fails when a committed output differs from a rebuild (used by the data test).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CEFR, type Cefr } from '../supabase/functions/_shared/cefr.ts';
import { fetchPinned, parseWordfreq, SOURCES, unzipMember } from './build-levels.ts';
import {
  applyReview,
  familiarMigration,
  familiarTsv,
  findFamiliar,
  isRejected,
  parseReview,
  type ListEntry,
} from './lib/tr-familiar.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FAMILIAR_FILE = 'data/levels/tr-familiar.tsv';
export const REVIEW_FILE = 'data/levels/tr-familiar-review.tsv';
export const MIGRATION_FILE = 'supabase/migrations/20261106000300_tr_familiar_levels.sql';
const TR_MEMBER = 'wordfreq/data/small_tr.msgpack.gz';

function readList(): ListEntry[] {
  return readFileSync(join(ROOT, 'data/levels/ref-word-levels.tsv'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [lemma_norm, pos, cefr, source] = l.split('\t');
      return { lemma_norm: lemma_norm!, pos: pos!, cefr: cefr as Cefr, source: source as ListEntry['source'] };
    })
    .filter((e) => (CEFR as readonly string[]).includes(e.cefr));
}

/** English lemmas of the hand-written false-friends table (first column). */
export function falseFriendLemmas(md: string): Set<string> {
  const out = new Set<string>();
  for (const line of md.split('\n')) {
    const m = /^\|\s*([^|]+?)\s*\|/.exec(line);
    if (!m || m[1] === 'İngilizce' || /^-+$/.test(m[1]!)) continue;
    for (const w of m[1]!.split(/[/,]/)) if (w.trim()) out.add(w.trim().toLowerCase());
  }
  return out;
}

export async function buildFamiliar() {
  const wheel = await fetchPinned(SOURCES.wordfreq.url, SOURCES.wordfreq.sha256);
  const turkish = parseWordfreq(unzipMember(wheel, TR_MEMBER));
  const english = parseWordfreq(unzipMember(wheel, SOURCES.wordfreq.member));
  const falseFriends = falseFriendLemmas(
    readFileSync(join(ROOT, 'data/reference/false-friends.en-tr.md'), 'utf8'),
  );
  const candidates = findFamiliar(readList(), { turkish, english, falseFriends });
  const reviewPath = join(ROOT, REVIEW_FILE);
  const review = parseReview(existsSync(reviewPath) ? readFileSync(reviewPath, 'utf8') : '');
  const kept = applyReview(candidates, review);
  return {
    candidates,
    review,
    kept,
    files: {
      [FAMILIAR_FILE]: familiarTsv(kept),
      [MIGRATION_FILE]: familiarMigration(kept),
    } as Record<string, string>,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { candidates, review, kept, files } = await buildFamiliar();
  if (process.argv[2] === 'candidates') {
    for (const c of candidates)
      console.log([isRejected(review, c) ? '-' : '+', c.lemma_norm, c.pos, c.cefr, c.tr, c.tr_zipf].join('\t'));
    console.error(`${candidates.length} candidates, ${kept.length} kept`);
  } else {
    const check = process.argv.includes('--check');
    let bad = 0;
    for (const [rel, content] of Object.entries(files)) {
      const file = join(ROOT, rel);
      if (check) {
        if (!existsSync(file) || readFileSync(file, 'utf8') !== content) {
          console.error(`out of date: ${rel}`);
          bad++;
        }
      } else writeFileSync(file, content);
    }
    console.log(JSON.stringify({ candidates: candidates.length, reviewed_out: candidates.length - kept.length, kept: kept.length }));
    if (bad) process.exit(1);
  }
}
