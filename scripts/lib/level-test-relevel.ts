// The level test's bank on the Turkish-learner levels (v0.5.3 C5, decision 0073). The bank
// (data/level-test/bank.json, decision 0017) was built on the plain list levels; the
// Turkish-learner corrections (level-tr-v1, exported from the server) and the familiar words
// (tr-familiar.tsv) live in the client level file. This moves every bank word to the level
// that file gives it and recounts the band sizes the same way, so the level test, guests and
// the word bank agree. Pure and idempotent; the CLI is scripts/relevel-level-test.ts.

import { createHash } from 'node:crypto';
import { CEFR, type Cefr } from '../../supabase/functions/_shared/cefr.ts';
import { listLevel } from '../../supabase/functions/_shared/level.ts';
import type { RefLookup } from '../../supabase/functions/_shared/level.ts';

/** The bank's shape (src/domain/levelTest.ts LevelTestBank; repeated here for the scripts). */
export interface BankWord {
  w: string;
  pos: string;
  tr: string;
  d: [string, string, string];
}
export interface LevelTestBank {
  version: string;
  band_sizes: Record<Cefr, number>;
  levels: Record<Cefr, BankWord[]>;
  pseudo: string[];
  [key: string]: unknown;
}

export interface RelevelResult {
  bank: LevelTestBank;
  moved: { w: string; pos: string; from: Cefr; to: Cefr }[];
}

/** Lemmas per level in the client file (each lemma at its easiest, corrected list level). */
export function bandSizesOf(lookup: RefLookup, lemmas: Iterable<string>): Record<Cefr, number> {
  const sizes = Object.fromEntries(CEFR.map((c) => [c, 0])) as Record<Cefr, number>;
  for (const lemma of lemmas) {
    const l = listLevel(lookup(lemma)?.refs, null);
    if (l) sizes[l.cefr]++;
  }
  return sizes;
}

/** Base version of a bank ("bank-2026-10-1" of "bank-2026-10-1.tr-ab12cd"). */
export const baseVersion = (v: string) => v.split('.tr-')[0]!;

export function relevelBank(bank: LevelTestBank, lookup: RefLookup, listLemmas: Iterable<string>): RelevelResult {
  const levels = Object.fromEntries(CEFR.map((c) => [c, [] as BankWord[]])) as Record<Cefr, BankWord[]>;
  const moved: RelevelResult['moved'] = [];
  const incoming: { to: Cefr; word: BankWord }[] = [];
  for (const from of CEFR) {
    for (const word of bank.levels[from] ?? []) {
      const to = listLevel(lookup(word.w)?.refs, word.pos)?.cefr ?? from;
      if (to === from) levels[from].push(word);
      else {
        moved.push({ w: word.w, pos: word.pos, from, to });
        incoming.push({ to, word });
      }
    }
  }
  // Moved words go after the words already at that level, in a stable order.
  incoming.sort((a, b) => (a.word.w < b.word.w ? -1 : a.word.w > b.word.w ? 1 : 0));
  for (const { to, word } of incoming) levels[to].push(word);
  const band_sizes = bandSizesOf(lookup, listLemmas);
  const same =
    moved.length === 0 && CEFR.every((c) => band_sizes[c] === bank.band_sizes[c]);
  const tag = createHash('sha256')
    .update(JSON.stringify({ levels: CEFR.map((c) => levels[c].map((w) => w.w)), band_sizes }))
    .digest('hex')
    .slice(0, 6);
  const version = same ? bank.version : `${baseVersion(bank.version)}.tr-${tag}`;
  return { bank: { ...bank, version, band_sizes, levels }, moved };
}
